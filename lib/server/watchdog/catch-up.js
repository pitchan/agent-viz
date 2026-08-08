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
  try { names = await fsp.readdir(dir); } catch { return 0; }
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
