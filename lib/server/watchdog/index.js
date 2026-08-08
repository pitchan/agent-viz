'use strict';
// index.js — le cablage du chien de garde cote serveur.
//
// Une seule instance, atteignable par ses deux appelants : event-reader (qui
// lui pousse les evenements) et les routes (qui lisent le journal). Le service
// est asynchrone a creer — il charge un module ESM — donc tant qu'il n'est pas
// pret `getWatchdogService()` rend null et l'appelant passe son chemin : un
// evenement manque au tout debut du demarrage est rattrape par catch-up.
//
// C'est ici, et nulle part ailleurs, que le detecteur et le journal se
// rencontrent. Donc c'est ici que leur horloge doit etre la MEME : le service
// ne peut pas reparer l'ecart apres coup, parce que le journal a deja relu son
// fichier quand il lui arrive. Voir `now` ci-dessous.

const os = require('os');
const path = require('path');
const { createJournal } = require('./journal');
const { createWatchdogService } = require('./service');
const { catchUpFromDisk } = require('./catch-up');

const EVENTS_DIR = path.join(os.tmpdir(), 'agent-events');

let _service = null;
let _catchingUp = false;

// `journalPath` : ou vit le fichier du journal. Absent, le journal choisit son
// chemin par defaut (`~/.agent-viz/alerts.jsonl`), qui est ce que le serveur
// veut. L'option existe pour que ce module soit essayable sans ecrire dans le
// vrai `~` de l'utilisateur — sans elle, la seule branche que la production
// emprunte serait la seule qu'aucun test ne peut emprunter.
//
// `now` va au service ET au journal qu'on cree. Deux horloges qui se croisent
// ici ne donnent pas un decalage, elles donnent une perte de memoire : le
// journal perime a la relecture tout ce qui est vieux pour SON horloge, `seen`
// repart vide, et le rattrapage suivant reconsigne tout ce qu'il avait deja
// consigne. Le doublon ne se voit meme pas depuis `list()`, qui lit la memoire
// vive — il ne se voit que dans le fichier.
async function initWatchdog({ journal, journalPath, now = Date.now, ...rest } = {}) {
  if (_service) return _service;
  _service = await createWatchdogService({
    // `rest` d'abord : ce qui suit fait autorite. `isCatchingUp` en
    // particulier n'est pas surchargeable — c'est `runCatchUp` qui leve et
    // baisse ce drapeau, et un appelant qui le remplacerait rendrait le
    // balayage de demarrage muet sans que rien ne le dise.
    ...rest,
    journal: journal ?? createJournal({ filePath: journalPath, now }),
    now,
    isCatchingUp: () => _catchingUp,
  });
  return _service;
}

function getWatchdogService() { return _service; }
function setCatchingUp(v) { _catchingUp = !!v; }

// Le balayage de demarrage, drapeau compris : pendant qu'il tourne, `stuck`
// doit se taire, et il doit se retaire meme si la lecture echoue.
async function runCatchUp(dir = EVENTS_DIR) {
  if (!_service) return 0;
  setCatchingUp(true);
  try { return await catchUpFromDisk(_service, dir); }
  finally { setCatchingUp(false); }
}

module.exports = { initWatchdog, getWatchdogService, setCatchingUp, runCatchUp, EVENTS_DIR };
