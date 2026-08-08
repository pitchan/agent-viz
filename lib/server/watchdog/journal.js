'use strict';
// journal.js — la memoire des pannes : un fichier en ajout seul.
//
// Possede `~/.agent-viz/alerts.jsonl` et rien d'autre : ne connait ni
// detecteur, ni HTTP. Deux sortes de lignes — `alert` (une panne consignee) et
// `ack` (elle a ete vue). Rien n'est jamais reecrit : un acquittement est une
// ligne de plus, pas une modification. C'est ce qui rend le fichier sur a
// relire apres un arret brutal.
//
// L'alerte est ecrite telle qu'elle vient et relue telle quelle : de sa forme,
// ce fichier ne connait que `id` et `createdAt`, qui font sa cle. Tout le
// reste — cwd, standing, occurrences — traverse sans etre regarde.
//
// Idempotence par la cle (id, createdAt). `createdAt` est l'heure de
// l'EVENEMENT declencheur, jamais celle de l'ecriture : elle est donc stable
// au rejeu, et relire dix fois le meme fichier n'ecrit rien de plus.
//
// Pourquoi pas `os.tmpdir()`, ou vivent les evenements : c'est le seul dossier
// que le systeme s'autorise a vider, et le menage y purge deja les sessions.
// Une memoire qui doit survivre d'une session a l'autre n'y a pas sa place.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PATH = path.join(os.homedir(), '.agent-viz', 'alerts.jsonl');

// Un separateur est indispensable : colles bout a bout, ('a1', 2) et ('a', 12)
// donnent la meme chaine 'a12'. NUL est choisi parce qu'il ne peut apparaitre
// ni dans un id ni dans un nombre — la cle est donc sans ambiguite quelle que
// soit la ponctuation des ids, qui en portent deja (loop:s1:Bash).
const keyOf = (id, createdAt) => `${id}\u0000${createdAt}`;

function createJournal({ filePath = DEFAULT_PATH } = {}) {
  const seen = new Set();   // cles (id, createdAt) deja consignees
  const acks = new Map();   // cle -> horodatage d'acquittement
  const alerts = [];        // dans l'ordre d'ecriture
  let writable = true;

  function ingest(line) {
    let rec;
    // Une ligne illisible est sautee, jamais fatale : un fichier tronque par
    // un arret brutal ne doit pas empecher le serveur de demarrer.
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.kind === 'alert' && rec.alert && rec.alert.id != null) {
      const k = keyOf(rec.alert.id, rec.alert.createdAt);
      if (seen.has(k)) return;
      seen.add(k);
      alerts.push(rec.alert);
    } else if (rec.kind === 'ack' && rec.id != null) {
      acks.set(keyOf(rec.id, rec.createdAt), rec.at);
    }
  }

  function load() {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { return; }
    for (const line of text.split('\n')) if (line.trim()) ingest(line);
  }

  function write(record) {
    if (!writable) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
    } catch (err) {
      // Perdre la memoire ne doit pas faire perdre l'alerte : on le dit une
      // fois, et la detection comme la diffusion continuent.
      writable = false;
      console.error('[watchdog] journal indisponible, les pannes ne seront plus consignees :', err.message);
    }
  }

  load();

  return {
    // Rend true si le fait etait inedit. L'appelant s'en sert pour ne
    // diffuser que ce qui vient d'etre consigne — y compris quand le disque a
    // refuse : ne pas ecrire l'alerte n'est pas une raison de la taire.
    append(alert) {
      const k = keyOf(alert.id, alert.createdAt);
      if (seen.has(k)) return false;
      seen.add(k);
      alerts.push(alert);
      write({ kind: 'alert', alert });
      return true;
    },
    appendAck(id, createdAt, at) {
      acks.set(keyOf(id, createdAt), at);
      write({ kind: 'ack', id, createdAt, at });
    },
    // La fenetre se mesure sur l'heure de l'evenement. Pas de borne haute :
    // une horloge de machine en avance rendrait `createdAt` posterieur a
    // `now`, et jeter ce fait perdrait justement la panne qu'on cherche. Il
    // remonte en tete, ce qui se voit.
    readAll({ sinceDays = 30, now = Date.now() } = {}) {
      const floor = now - sinceDays * 86_400_000;
      return alerts
        .filter(a => a.createdAt >= floor)
        .map((a) => {
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
