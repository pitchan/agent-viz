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
// balayage separe, qui lit les fichiers EN ENTIER, les passe au service et ne
// diffuse RIEN. L'idempotence du journal fait que le relire dix fois n'ecrit
// rien de plus.

const fsp = require('fs').promises;
const path = require('path');

async function catchUpFromDisk(service, dir) {
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
    let text;
    try { text = await fsp.readFile(path.join(dir, name), 'utf8'); } catch { continue; }
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
