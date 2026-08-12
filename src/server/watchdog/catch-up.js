'use strict';
// catch-up.js — le rattrapage au demarrage.
//
// Les watchers d'evenements posent leur curseur a la FIN du fichier
// (event-reader.watchSession) : rien de ce qui est deja sur le disque ne
// repasse par eux. C'est delibere — rouvrir le serveur ne doit pas rejouer
// toute l'activite sur le canevas.
//
// Le chien de garde, lui, a besoin de ce passe : c'est meme tout son interet,
// une panne survenue serveur eteint doit se retrouver au journal. D'ou ce
// balayage separe, qui lit les fichiers depuis leur DEBUT, les passe au service
// et ne diffuse RIEN. L'idempotence du journal fait que le relire dix fois
// n'ecrit rien de plus.
//
// Depuis leur debut, et jusqu'ou ? Jusqu'a l'octet ou le chemin vif prend la
// main, quand il y en a un — voir `limiteVive` plus bas. Les deux chemins
// tournent en meme temps : les watchers sont armes avant ce balayage, ils
// livrent pendant qu'il tourne, et tout ce qui serait lu par les deux serait
// COMPTE deux fois par le detecteur. Le journal dedoublonne l'alerte, pas les
// compteurs qui la produisent.

const fsp = require('fs').promises;
const path = require('path');
const { decodeJsonlLine } = require('../jsonl');

// `limiteVive` rend, pour un fichier, l'octet a partir duquel le chemin vif
// prend la main — ou null quand aucun watcher ne le couvre, auquel cas le
// fichier entier est l'affaire du balayage. Elle est INJECTEE, et pas
// importee : la connaitre voudrait dire dependre du lecteur d'evenements, qui
// depend deja de ce module. Le cycle serait la ; l'injection le rend
// impossible, et ce fichier continue de ne connaitre que le service et le
// dossier.
//
// Sans elle — appelant qui l'oublie, ou fichier sans watcher — on lit tout,
// comme avant. C'est le comportement le plus sur : relire de trop ne perd
// jamais un fait, et le journal dedoublonne l'alerte.
async function catchUpFromDisk(service, dir, limiteVive) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    // Meme partage qu'a la lecture du journal (journal.js, `load`). ENOENT est
    // le silence legitime : aucune session n'a encore ete enregistree, il n'y a
    // rien a rattraper. Tout le reste — EACCES, ENOTDIR, un verrou d'antivirus
    // ou de sauvegarde sous Windows — veut dire que le passe EXISTE et qu'on ne
    // l'a pas lu. Se taire rendrait 0 exactement comme un dossier vide : le
    // rattrapage ne ferait pas son travail, et rien dans le produit ne le
    // dirait. C'est la promesse du chien de garde — une panne survenue serveur
    // eteint se retrouve au journal — qui tomberait sans symptome.
    if (err.code !== 'ENOENT') {
      console.error('[watchdog] dossier d evenements illisible, rien n a ete rattrape :', err.message);
    }
    return 0;
  }
  let fed = 0;
  for (const name of names) {
    // `_hook-errors.log` et les `.summary.json` ne sont pas des flux
    // d'evenements ; le prefixe `_` est la convention du dossier.
    if (!name.endsWith('.jsonl') || name.startsWith('_')) continue;
    const chemin = path.join(dir, name);
    // La limite est prise AVANT la lecture, et c'est ce qui rend le partage
    // sur. Prise apres, le chemin vif aurait pu avancer pendant la lecture et
    // l'on rendrait des octets qu'il a deja livres — un trou. Prise avant, s'il
    // avance pendant la lecture, il livre exactement ce qui est au-dessus de la
    // limite et nous exactement ce qui est en dessous.
    const limite = typeof limiteVive === 'function' ? limiteVive(chemin) : null;
    let octets;
    try {
      octets = await fsp.readFile(chemin);
    } catch (err) {
      // Meme partage que pour le dossier, dix lignes plus haut. ENOENT est
      // legitime : le menage a pu purger la session entre le listage et la
      // lecture. Tout le reste veut dire qu'un flux d'evenements EXISTE et
      // qu'on ne l'a pas lu — donc que les pannes qu'il contient ne seront pas
      // consignees. Le fichier suivant est lu quand meme.
      if (err.code !== 'ENOENT') {
        console.error(`[watchdog] flux d evenements illisible, ${name} n a pas ete rattrape :`, err.message);
      }
      continue;
    }
    // Decoupe en OCTETS, pas en caracteres : la limite est une position dans le
    // fichier. `subarray` borne d'elle-meme si le fichier a retreci entre-temps.
    const text = (limite === null ? octets : octets.subarray(0, limite)).toString('utf8');
    for (const line of text.split('\n')) {
      // C2 : le verdict sur une ligne vient de la primitive commune du moteur,
      // il n'est plus reimplemente ici — la garde sur la ligne blanche non plus,
      // qui faisait double emploi avec le `null` que la primitive rend deja.
      // Consequence assumee : une ligne prefixee d'un BOM est desormais decodee
      // au lieu d'etre perdue en silence, ici comme sur le chemin vif.
      //
      // Un echec de decodage reste MUET, et c'est une exception deliberee a la
      // regle « casser bruyamment ». `limite` est toujours une TAILLE de fichier
      // relevee a un instant donne (event-reader.liveHandoffOffset), jamais une
      // position calculee sur une fin de ligne : rien dans le contrat ne garantit
      // qu'elle tombe entre deux lignes. Quand elle tombe au milieu de l'une
      // d'elles, la queue du lot est un fragment que le decodage refuse — verifie
      // par execution — alors que rien n'est alle de travers. Une trace ici
      // parlerait donc d'une coupure que le contrat autorise et qui n'est pas une
      // corruption. A quelle FREQUENCE elle survient n'est pas etabli : cela
      // depend de l'atomicite de l'ajout d'une ligne par l'ecrivain, qui n'a pas
      // ete prouvee. C'est un silence, pas un oubli : il n'y avait aucune trace
      // avant cette migration, aucune n'est perdue.
      const verdict = decodeJsonlLine(line);
      if (!verdict || !verdict.ok) continue;
      const evt = verdict.value;
      // Ce qui n'est pas un objet n'est pas un evenement. `null` est du JSON
      // VALIDE — la primitive rend { ok:true, value:null } — et `processEvent`
      // levait dessus (verifie en executant le vrai service : « Cannot read
      // properties of null (reading '_ts') »). L'exception etait rattrapee au
      // demarrage, donc le serveur tenait ; mais la boucle s'arretait, et TOUT
      // ce qui suivait — le reste du fichier ET les fichiers d'apres — n'etait
      // jamais relu. Une ligne de bruit faisait perdre le passe entier.
      if (typeof evt !== 'object' || evt === null || Array.isArray(evt)) continue;
      service.onEvent(evt);
      fed++;
    }
  }
  return fed;
}

module.exports = { catchUpFromDisk };
