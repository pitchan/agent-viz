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
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      service.onEvent(evt);
      fed++;
    }
  }
  return fed;
}

module.exports = { catchUpFromDisk };
