'use strict';
// service.js — le chien de garde cote serveur.
//
// Possede l'instance du detecteur et decide de ce qui merite d'etre consigne.
// Ne connait ni fichier (c'est journal.js), ni HTTP (ce sont les routes), ni
// dossier d'evenements (c'est catch-up.js).
//
// Le module de detection est un module ESM servi au navigateur. Il est charge
// par import() sur une URL de fichier — meme patron que
// lib/server/observatory/engine.js. Le paquet est CommonJS : `public/` designe
// desormais du code servi au navigateur ET charge par le serveur, ce qui evite
// d'en tenir deux copies.

const path = require('path');
const { pathToFileURL } = require('url');

const WATCHDOG_MODULE = pathToFileURL(
  path.join(__dirname, '..', '..', '..', 'public', 'viz-watchdog.mjs'),
).href;

async function createWatchdogService({
  journal,
  now = () => Date.now(),
  isCatchingUp = () => false,
  loadModule = () => import(WATCHDOG_MODULE),
}) {
  const { createWatchdog } = await loadModule();

  // Cote serveur, canObserve repond « suis-je en train de relire du passe ? ».
  // Pendant un rattrapage l'horloge murale n'est pas l'heure des evenements :
  // `stuck` conclurait d'un silence qui n'existe que dans le fichier. Meme
  // invariant que cote navigateur — l'absence d'evenement n'est une preuve que
  // si l'on aurait du en recevoir — par une autre porte.
  const watchdog = createWatchdog({ now, canObserve: () => !isCatchingUp() });

  // Consigner d'abord, rendre ensuite : ce que l'appelant diffusera est deja
  // dans le journal. Et `append` rend false sur un fait deja connu, ce qui
  // rend le rejeu silencieux sans que le detecteur ait a le savoir.
  const record = alerts => alerts.filter(a => journal.append(a));

  return {
    onEvent(evt) { return record(watchdog.processEvent(evt).newAlerts); },
    tick() { return record(watchdog.tick().newAlerts); },
    // Consigner d'abord, agir ensuite — la meme regle que `record`, et pour la
    // meme raison. Le journal REFUSE un acquittement dont la cle est hors
    // contrat, et un parametre de route sait en produire un. Eteindre quand
    // meme l'alerte dans le detecteur la ferait revenir NON acquittee au
    // redemarrage : l'utilisateur aurait vu son geste pris en compte, et le
    // disque n'en saurait rien. Tant que ce n'est pas ecrit, ce n'est pas fait.
    //
    // Et cette information ne s'arrete pas ici : le service la RAPPORTE. Il est
    // seul a la connaitre — le journal la lui dit, le detecteur ne la voit
    // pas — et la jeter ferait repondre 200 a la route sur un acquittement que
    // le journal vient de refuser. L'utilisateur verrait son geste pris en
    // compte, et l'alerte reviendrait non acquittee au redemarrage suivant.
    ack(id, createdAt) {
      const retenu = journal.appendAck(id, createdAt, now());
      if (retenu) watchdog.acknowledge(id);
      return retenu;
    },
    // `now` en DERNIER, donc il gagne : l'horloge du service fait autorite sur
    // tout ce que le service rend. Sans quoi la fenetre de `list` se mesurerait
    // sur l'horloge du journal pendant que la detection se mesure sur celle-ci,
    // et l'on pourrait consigner une alerte qu'on ne saurait pas relire.
    //
    // Ce que ce recouvrement ne repare PAS, et ne peut pas reparer : la
    // relecture du fichier a l'ouverture du journal, faite avant que le service
    // existe. C'est pourquoi celui qui construit les deux doit leur donner la
    // meme horloge — voir `initWatchdog` dans index.js, qui est le seul endroit
    // du produit ou les deux se rencontrent.
    list(opts = {}) { return journal.readAll({ ...opts, now: now() }); },
    // Ce que `list` ne peut PAS dire. Le journal est la memoire : il rend ce
    // qui a ete consigne, sans aucune notion de vivacite. Or une alerte
    // `standing` decrit un ETAT et non un moment, donc elle n'a pas de
    // peremption — servie depuis le seul journal, une session bloquee hier
    // ressortirait vive pour toujours. Le detecteur, lui, sait laquelle l'est
    // ENCORE, et le service est le seul endroit ou les deux se parlent.
    //
    // Les identifiants seuls, pas les alertes : l'alerte complete, c'est `list`
    // qui la donne, avec son `acknowledged` recalcule depuis le journal — qui
    // fait autorite. Rendre ici une seconde copie de la meme alerte, portant un
    // `acknowledged` fige a false, ferait deux verites pour un seul fait.
    activeIds() { return watchdog.getActiveAlerts().map(a => a.id); },
  };
}

module.exports = { createWatchdogService, WATCHDOG_MODULE };
