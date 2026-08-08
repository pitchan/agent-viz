'use strict';
// journal.js — la memoire des pannes : un fichier en ajout seul.
//
// Possede `~/.agent-viz/alerts.jsonl` et rien d'autre : ne connait ni
// detecteur, ni HTTP. Deux sortes de lignes — `alert` (une panne consignee) et
// `ack` (elle a ete vue). Une ligne deja ecrite n'est jamais modifiee : un
// acquittement est une ligne de plus. C'est ce qui rend le fichier sur a
// relire apres un arret brutal.
//
// L'alerte est ecrite telle qu'elle vient et relue telle quelle : de sa forme,
// ce fichier ne connait que `id` et `createdAt`, qui font sa cle. Tout le
// reste — cwd, standing, occurrences — traverse sans etre regarde. Un seul
// champ merite d'etre signale a ceux qui liront ces lignes : `acknowledged`,
// que le detecteur pose a false, est FIGE sur le disque et devient donc
// menteur des le premier acquittement. C'est `readAll` qui le recalcule depuis
// les lignes `ack`, et lui seul fait autorite.
//
// Idempotence par la cle (id, createdAt). `createdAt` est l'heure de
// l'EVENEMENT declencheur, jamais celle de l'ecriture : elle est donc stable
// au rejeu, et relire dix fois le meme fichier n'ecrit rien de plus.
//
// CONTRAT DES HORODATAGES — `createdAt` et `at` sont des MILLISECONDES EPOCH :
// un nombre, ou la chaine de chiffres qui le represente, et rien d'autre. Ni
// ISO 8601, ni objet `Date`, ni format local. Ce n'est pas une paresse : lire
// du texte de date obligerait a accepter les formats locaux, dont
// l'interpretation depend du moteur — '14/11/2023' est novembre ici et avril
// ailleurs — et on echangerait une perte visible contre une donnee fausse
// silencieuse. Hors contrat, un `createdAt` est REFUSE (il fait la cle, le
// serveur ne peut pas l'inventer) et un `at` est REMPLACE par l'horloge du
// serveur — auquel cas la ligne le dit, par `atFrom: 'server'`, pour que le
// disque ne conflate jamais ce que le serveur a mesure avec ce qu'on lui a
// rapporte.
//
// Pourquoi pas `os.tmpdir()`, ou vivent les evenements : c'est le seul dossier
// que le systeme s'autorise a vider, et le menage y purge deja les sessions.
// Une memoire qui doit survivre d'une session a l'autre n'y a pas sa place.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PATH = path.join(os.homedir(), '.agent-viz', 'alerts.jsonl');

const JOUR_MS = 86_400_000;

// Retention : 90 jours, la fenetre la plus large que le produit offre
// (WINDOW_DAYS = [7, 30, 90] dans observatory/service.js). Au-dela, la ligne
// ne sert plus rien que l'interface puisse montrer — mais sans borne elle
// serait relue et parsee a chaque demarrage, gardee en RAM a vie, et balayee
// par chaque `readAll`, que le panneau appelle a chaque rafraichissement.
//
// Pourquoi jeter la cle avec la ligne ne peut pas rouvrir un doublon : les
// fichiers d'evenements vivent dans os.tmpdir() et le menage les purge bien
// avant 90 jours. Passe ce delai, plus aucune source ne peut re-fournir ces
// alertes, donc plus rien ne peut venir se comparer a la cle disparue.
const RETENTION_DAYS = 90;

// Apres un refus d'ecriture, nombre d'ecritures sautees avant un nouvel essai.
// Reessayer a chaque fois ferait autant de tentatives que d'alertes sur un
// disque plein ; ne jamais reessayer eteindrait la memoire jusqu'au prochain
// redemarrage — et avec elle l'ecriture des acquittements, si bien que les
// alertes acquittees par l'utilisateur reviendraient toutes au demarrage
// suivant. Une panne transitoire (antivirus ou sauvegarde qui tient le
// fichier, disque plein cinq minutes) doit pouvoir se resorber toute seule.
const RETRY_EVERY = 20;

// Un separateur est indispensable : colles bout a bout, ('a1', 2) et ('a', 12)
// donnent la meme chaine 'a12'. NUL est choisi parce qu'il ne peut apparaitre
// ni dans un id ni dans un nombre — la cle est donc sans ambiguite quelle que
// soit la ponctuation des ids, qui en portent deja (loop:s1:Bash).
const keyOf = (id, createdAt) => `${id}\u0000${createdAt}`;

// Sans les deux moities de la cle, il n'y a pas de fait consignable.
const estClef = (id, createdAt) => id != null && Number.isFinite(createdAt);

// Applique le contrat des horodatages (voir l'en-tete) : millisecondes epoch,
// nombre ou chaine de chiffres. Rend null quand ce n'en est pas un.
//
// La conversion est restreinte aux chaines qui portent autre chose que du
// blanc, parce que `Number('')`, `Number('   ')` et `Number(null)` valent tous
// 0 : sans ca, une valeur absente ou un `?createdAt=%20` deviendraient un
// horodatage a l'epoque Unix au lieu d'un refus franc.
const enHorodatage = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

function createJournal({ filePath = DEFAULT_PATH, now = Date.now } = {}) {
  const seen = new Set();   // cles (id, createdAt) deja consignees
  const acks = new Map();   // cle -> horodatage d'acquittement
  const alerts = [];        // dans l'ordre d'ecriture
  let refus = 0;            // ecritures restant a sauter apres un refus disque
  let plainte = false;      // la panne d'ecriture en cours a-t-elle ete dite ?

  function ingest(rec) {
    if (rec.kind === 'alert' && rec.alert && estClef(rec.alert.id, rec.alert.createdAt)) {
      const k = keyOf(rec.alert.id, rec.alert.createdAt);
      if (seen.has(k)) return;
      seen.add(k);
      alerts.push(rec.alert);
    } else if (rec.kind === 'ack' && estClef(rec.id, rec.createdAt)) {
      acks.set(keyOf(rec.id, rec.createdAt), rec.at);
    }
  }

  // Fichier temporaire puis renommage, jamais de reecriture en place : si le
  // processus meurt au milieu, l'ancien journal est encore entier. Un journal
  // a moitie ecrit serait pire qu'un journal trop long.
  function compacter(lignes) {
    const tmpPath = `${filePath}.compact`;
    try {
      fs.writeFileSync(tmpPath, lignes.length ? lignes.join('\n') + '\n' : '');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* rien a nettoyer */ }
      console.error('[watchdog] compaction du journal impossible, il continue de grandir :', err.message);
    }
  }

  function load() {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      // ENOENT est le silence legitime : c'est un premier demarrage. Tout le
      // reste — EACCES, EBUSY (antivirus ou sauvegarde qui tient le fichier
      // sous Windows), EISDIR — veut dire qu'une memoire EXISTE et qu'on ne
      // l'a pas lue. Se taire ferait repartir `seen` vide, et le rattrapage
      // rendrait alors `true` sur tout l'historique : tout rediffuse d'un
      // coup, un doublon par alerte dans le fichier. L'idempotence au
      // redemarrage tomberait sans un mot.
      if (err.code !== 'ENOENT') {
        console.error('[watchdog] journal illisible, la memoire des pannes repart vide :', err.message);
      }
      return;
    }
    const plancher = now() - RETENTION_DAYS * JOUR_MS;
    const gardees = [];
    let perimees = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      // Une ligne illisible est sautee, jamais fatale : un fichier tronque par
      // un arret brutal ne doit pas empecher le serveur de demarrer. Elle ne
      // declenche pas a elle seule une reecriture — on ne reecrit que pour la
      // peremption — mais elle disparaitra a la prochaine compaction.
      try { rec = JSON.parse(line); } catch { continue; }
      const ts = rec.kind === 'alert' && rec.alert ? rec.alert.createdAt : rec.createdAt;
      if (!(ts >= plancher)) { perimees += 1; continue; }
      gardees.push(line);
      ingest(rec);
    }
    // La compaction a lieu ici, avant le premier `append` : l'ajout seul reste
    // intact, aucune ligne n'est jamais reecrite pour etre changee.
    //
    // Mais on ne compacte pas quand il ne resterait RIEN. `readAll` refuse
    // deja de jeter une alerte datee du futur parce que l'horloge peut mentir ;
    // `load` ne peut pas se fier a cette meme horloge pour reecrire le fichier
    // de facon irreversible. Pile morte, machine restauree depuis un
    // instantane, saut NTP au demarrage : un seul demarrage suffirait a vider
    // la seule chose que le produit ne sait pas reconstruire — alertes ET
    // acquittements. L'effacement TOTAL est la signature de l'accident, pas
    // d'un journal qui vieillit.
    //
    // Ce que cette garde achete, exactement, et pas plus : UN demarrage, et
    // seulement tant que rien n'est consigne entre deux. Des qu'une alerte est
    // ajoutee sous l'horloge folle, `gardees` cesse d'etre vide et le
    // demarrage suivant compacte pour de bon — les lignes d'avant,
    // acquittements compris, sont alors perdues. Mesure :
    //
    //   demarrage fou 1 : 3 lignes    (la garde tient)
    //   + 1 append      : 4 lignes
    //   demarrage fou 2 : 1 ligne     (tout le reste est detruit)
    //
    // C'est le meme mecanisme qui fait que le cas se resout quand le journal
    // est reellement perime a 100 % : on ne peut pas avoir l'un sans l'autre.
    // La garde achete du temps pour que l'horloge revienne, elle ne rend pas
    // le journal indestructible.
    //
    // La memoire, elle, reste bornee dans tous les cas — le filtre ci-dessus
    // ne depend pas de la reecriture.
    //
    // Residu assume : un saut d'horloge PARTIEL — assez pour perimer une
    // tranche, pas assez pour tout perimer — emporte encore cette tranche.
    if (perimees > 0 && gardees.length > 0) compacter(gardees);
  }

  function write(record) {
    // On saute les ecritures pendant le delai plutot que de retenter a chaque
    // fois ; passe le delai, on retente une fois.
    if (refus > 0) { refus -= 1; return; }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
      plainte = false;   // le disque repond : la prochaine panne aura droit a sa plainte
    } catch (err) {
      refus = RETRY_EVERY;
      // Perdre la memoire ne doit pas faire perdre l'alerte : on le dit une
      // fois par panne, et la detection comme la diffusion continuent.
      if (!plainte) {
        plainte = true;
        console.error('[watchdog] journal indisponible, les pannes ne sont plus consignees :', err.message);
      }
    }
  }

  load();

  return {
    // Rend true si le fait etait inedit. L'appelant s'en sert pour ne
    // diffuser que ce qui vient d'etre consigne — y compris quand le disque a
    // refuse : ne pas ecrire l'alerte n'est pas une raison de la taire, le
    // fait reste en memoire et n'y sera compte qu'une fois.
    append(alert) {
      // Sans cle, le fait ne peut etre ni deduplique ni relu : l'ecrire le
      // rendrait invisible a `readAll` tout en le faisant rediffuser a chaque
      // rattrapage, pour toujours. On refuse, et on le dit — c'est un defaut
      // de l'appelant, pas un accident de disque.
      if (!estClef(alert.id, alert.createdAt)) {
        console.error('[watchdog] alerte sans (id, createdAt), non consignee :', alert.id);
        return false;
      }
      const k = keyOf(alert.id, alert.createdAt);
      if (seen.has(k)) return false;
      seen.add(k);
      alerts.push(alert);
      write({ kind: 'alert', alert });
      return true;
    },
    // Symetrique d'`append`, et pour la meme raison. `keyOf` fabrique une
    // chaine : un `createdAt` arrive en chaine donnerait une cle qui
    // correspond en memoire vive, s'ecrirait sur le disque... et que `ingest`
    // refuserait a la relecture, si bien que l'alerte acquittee reviendrait au
    // redemarrage. Ce n'est pas une hypothese : le point d'acquittement du
    // produit est une route HTTP, et un parametre de requete arrive en chaine
    // meme quand il porte un nombre — d'ou la conversion. Elle ne va pas plus
    // loin que le contrat de l'en-tete : une chaine de CHIFFRES est un
    // horodatage, une date ecrite en ISO 8601 ou en format local n'en est pas
    // un. La conversion evite le refus illegitime, la garde attrape le reste.
    //
    // Rend true si l'acquittement a ete RETENU, false s'il a ete refuse.
    // Symetrique d'`append`, et sur le meme partage : un refus du DISQUE ne
    // compte pas comme un refus. Non pas parce que la ligne repartirait plus
    // tard — elle ne repart pas, `write` abandonne l'enregistrement et il
    // n'existe aucune file de reprise — mais parce que rendre false laisserait
    // le panneau allume sur une alerte que l'utilisateur vient d'eteindre : il
    // recliquerait, sans fin, sur un disque qui ne repond pas. Le prix est
    // assume et il est nomme : cet acquittement-la sera perdu au redemarrage.
    // Seule une cle inutilisable est un refus — celle-la, meme un disque en
    // pleine forme ne la retrouverait pas, et l'appelant doit pouvoir ne rien
    // conclure d'un acquittement qui n'a pas eu lieu.
    appendAck(id, createdAt, at) {
      const quand = enHorodatage(createdAt);
      if (!estClef(id, quand)) {
        console.error('[watchdog] acquittement sans (id, createdAt), non consigne :', id);
        return false;
      }
      // `at` ne fait pas partie de la cle : il ne dit jamais QUELLE alerte est
      // acquittee, seulement QUAND. Un `at` inutilisable ne peut donc pas
      // corrompre le journal — mais refuser l'acquittement pour autant
      // perdrait une action reelle de l'utilisateur, et le panneau resterait
      // allume sur une alerte qu'il vient d'eteindre ; il recliquerait, une
      // ligne de plus, sans fin. On se defausse donc sur l'horloge du serveur,
      // qui n'est pas une invention : c'est son observation directe du moment
      // ou l'acquittement lui arrive. Le journal ne dit toujours que du vrai,
      // avec sa propre mesure au lieu d'une valeur qu'il ne sait pas lire. Et
      // il le dit, pour qu'un appelant casse ne reste pas invisible.
      //
      // Et quand le repli joue, la ligne le DIT. `now()` est une observation
      // juste, mais l'ecrire au meme endroit et sous la meme forme que ce
      // qu'un acquitteur aurait rapporte conflaterait deux choses
      // differentes — « mesure du serveur en dernier recours » et « rapporte
      // par l'acquitteur » — et ne rien conflater est la raison d'etre d'un
      // journal. L'absence du champ vaut donc « c'est l'appelant qui l'a
      // fourni ». `readAll` l'ignore : c'est la trace qui compte.
      let vu = enHorodatage(at);
      const ligne = { kind: 'ack', id, createdAt: quand, at: vu };
      if (vu === null) {
        console.error('[watchdog] acquittement sans horodatage utilisable, horloge du serveur retenue :', id);
        vu = now();
        ligne.at = vu;
        ligne.atFrom = 'server';
      }
      acks.set(keyOf(id, quand), vu);
      write(ligne);
      return true;
    },
    // La fenetre se mesure sur l'heure de l'evenement. Pas de borne haute :
    // `createdAt` vient du hook, pas du serveur, et jeter un fait parce qu'il
    // est date du futur perdrait justement la panne qu'on cherche a consigner.
    // Le prix est assume et il n'est pas nul. Quelques minutes d'avance :
    // l'alerte remonte en tete, ce qui se voit et se comprend. Un an d'avance :
    // elle ne sortira JAMAIS de la fenetre ni de la retention, et restera
    // epinglee en tete du panneau a vie, sans qu'aucun acquittement ne la
    // fasse taire ailleurs que dans son propre statut. Entre perdre une panne
    // reelle et garder une panne mal datee, on garde — mais c'est un choix.
    readAll({ sinceDays = 30, now: maintenant = now() } = {}) {
      const plancher = maintenant - sinceDays * JOUR_MS;
      return alerts
        .filter(a => a.createdAt >= plancher)
        .map((a) => {
          // L'ordre de l'etalement compte : le `acknowledged` du disque est
          // fige a false, celui-ci est recalcule et doit gagner.
          const ackAt = acks.get(keyOf(a.id, a.createdAt));
          return { ...a, acknowledged: ackAt !== undefined, ackAt: ackAt ?? null };
        })
        .sort((x, y) => y.createdAt - x.createdAt);
    },
    // Une copie : l'appelant peut la garder ou la trier sans que la memoire du
    // journal en souffre.
    seenKeys() { return new Set(seen); },
  };
}

module.exports = { createJournal, DEFAULT_PATH, keyOf };
