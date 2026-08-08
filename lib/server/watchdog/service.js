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
    ack(id, createdAt) { watchdog.acknowledge(id); journal.appendAck(id, createdAt, now()); },
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
  };
}

module.exports = { createWatchdogService, WATCHDOG_MODULE };
