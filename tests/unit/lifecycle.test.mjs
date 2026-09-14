// start, status et stop parlent à de vrais processus sur de vrais ports : chaque
// test charge une copie de lifecycle.ts à côté d'un faux server.js, son port par
// défaut remplacé par un port de test, pour ne jamais sonder ni arrêter un démon réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = path.resolve(import.meta.dirname, '..', '..', 'src', 'server', 'lifecycle.ts');
const TEMOIN = 'lance.pid';

// Chaque faux server.js dépose son pid dans TEMOIN dès son lancement : le test
// sait ainsi s'il a été lancé, et quel processus tuer.
const DEPOSE_TEMOIN = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  `fs.writeFileSync(path.join(import.meta.dirname, '${TEMOIN}'), String(process.pid));`,
].join('\n');

const SERVEUR_QUI_ECOUTE = [
  DEPOSE_TEMOIN,
  "import http from 'node:http';",
  'http.createServer((req, res) => {',
  "  if (req.method === 'POST' && req.url === '/shutdown') { res.end('bye', () => process.exit(0)); return; }",
  "  res.end('ok');",
  "}).listen(Number(process.env.PORT), '127.0.0.1');",
].join('\n');

const SERVEUR_QUI_SORT = DEPOSE_TEMOIN;

const SERVEUR_QUI_MEURT = [
  DEPOSE_TEMOIN,
  "console.error('SONDE_MORT');",
  'process.exit(3);',
].join('\n');

const SERVEUR_MUET = [
  DEPOSE_TEMOIN,
  'setInterval(() => {}, 60000);',
].join('\n');

// Les serveurs restent ouverts jusqu'au dernier : deux ports demandés ensemble
// sont forcément distincts.
async function portsLibres(nombre) {
  const serveurs = [];
  for (let i = 0; i < nombre; i++) {
    const serveur = net.createServer();
    await new Promise(resolve => serveur.listen(0, '127.0.0.1', resolve));
    serveurs.push(serveur);
  }
  const ports = serveurs.map(s => s.address().port);
  await Promise.all(serveurs.map(s => new Promise(resolve => s.close(resolve))));
  return ports;
}

async function demonFactice(port) {
  const requetes = [];
  const serveur = http.createServer((req, res) => {
    requetes.push(`${req.method} ${req.url}`);
    res.end('ok');
  });
  await new Promise(resolve => serveur.listen(port, '127.0.0.1', resolve));
  const ferme = () => new Promise(resolve => {
    serveur.close(resolve);
    serveur.closeAllConnections();
  });
  return { requetes, ferme };
}

// PID_FILE et LOG_FILE se calculent au chargement depuis os.tmpdir() : le
// dossier temporaire est redirigé le temps de l'import, pour que chaque copie
// ait les siens.
async function chargeLifecycle({ portParDefaut, serveur = SERVEUR_QUI_SORT }) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-lifecycle-'));
  const source = fs.readFileSync(SOURCE, 'utf8');
  const copie = source.replaceAll(/\b3333\b/g, String(portParDefaut));
  if (copie === source) throw new Error('aucun 3333 dans lifecycle.ts : le montage ne remplace plus le port par défaut');
  fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.writeFileSync(path.join(dossier, 'lifecycle.ts'), copie);
  fs.writeFileSync(path.join(dossier, 'server.js'), serveur);
  const tmp = path.join(dossier, 'tmp');
  fs.mkdirSync(tmp);
  const avant = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  Object.assign(process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
  let lifecycle;
  try {
    lifecycle = await import(pathToFileURL(path.join(dossier, 'lifecycle.ts')).href);
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  }
  if (path.dirname(lifecycle.PID_FILE) !== tmp) throw new Error(`PID_FILE hors du dossier du test : ${lifecycle.PID_FILE}`);
  return { lifecycle, dossier };
}

function pidLance({ dossier }) {
  try { return Number(fs.readFileSync(path.join(dossier, TEMOIN), 'utf8')); } catch { return null; }
}

// Le processus de test garde ouverts les descripteurs du journal que
// spawnDetached lui a fait ouvrir : sous Windows le dossier peut refuser de
// partir, et le bac du harnais le purgera avec le reste.
function nettoie(montage) {
  const pid = pidLance(montage);
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  try { fs.rmSync(montage.dossier, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
}

test('status : rien sur le port demandé et pas de fichier de pid, le démon est dit arrêté', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  try {
    // Act
    const etat = await montage.lifecycle.status({ port });

    // Assert
    assert.equal(etat.running, false);
    assert.equal(etat.stale, undefined);
  } finally {
    nettoie(montage);
  }
});

test('status sonde le port demandé : un serveur qui y répond est dit en marche, sans pid', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  try {
    // Act
    const etat = await montage.lifecycle.status({ port });

    // Assert
    const { running, pid, viaPidFile } = etat;
    assert.deepEqual({ running, pid, port: etat.port, viaPidFile }, { running: true, pid: null, port, viaPidFile: false });
  } finally {
    await demon.ferme();
    nettoie(montage);
  }
});

test('start sur un port demandé déjà occupé : rend alreadyRunning sans lancer le serveur', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  try {
    // Act
    const resultat = await montage.lifecycle.start({ port });

    // Assert
    assert.deepEqual(resultat, { alreadyRunning: true, pid: null, port });
    assert.equal(pidLance(montage), null, 'le faux server.js ne devait pas être lancé');
  } finally {
    await demon.ferme();
    nettoie(montage);
  }
});

test('start --foreground sur un port demandé déjà occupé : lève en nommant ce port', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  try {
    // Act
    const erreur = await montage.lifecycle.start({ port, foreground: true }).then(() => null, e => e);

    // Assert
    assert.ok(erreur, 'start aurait dû lever');
    assert.ok(erreur.message.includes(`already running on port ${port} (`), erreur.message);
  } finally {
    await demon.ferme();
    nettoie(montage);
  }
});

test('start sonde le port demandé et non le port par défaut : un démon sur le port par défaut ne bloque pas le lancement', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut, serveur: SERVEUR_QUI_ECOUTE });
  const demonParDefaut = await demonFactice(portParDefaut);
  try {
    // Act
    const resultat = await montage.lifecycle.start({ port });

    // Assert
    assert.deepEqual(resultat, { alreadyRunning: false, pid: pidLance(montage), port });
    const fichierPid = fs.readFileSync(montage.lifecycle.PID_FILE, 'utf8');
    assert.ok(fichierPid.startsWith(`${resultat.pid}\n${port}\n`), JSON.stringify(fichierPid));
  } finally {
    await demonParDefaut.ferme();
    nettoie(montage);
  }
});

test('stop sans argument vise le port du fichier de pid et le retire', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut, serveur: SERVEUR_QUI_ECOUTE });
  try {
    await montage.lifecycle.start({ port });

    // Act
    const resultat = await montage.lifecycle.stop();

    // Assert
    assert.equal(resultat.stopped, true);
    assert.equal(resultat.port, port);
    assert.equal(fs.existsSync(montage.lifecycle.PID_FILE), false, 'le fichier de pid devait être retiré');
  } finally {
    nettoie(montage);
  }
});

test('start dont le serveur meurt au démarrage : rejette tout de suite en le disant, avec la fin du journal', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut, serveur: SERVEUR_QUI_MEURT });
  try {
    const debut = Date.now();

    // Act
    const erreur = await montage.lifecycle.start({ port }).then(() => null, e => e);

    // Assert
    const duree = Date.now() - debut;
    assert.ok(erreur, 'start aurait dû lever');
    assert.ok(duree < 3000, `rejet attendu avant 3 000 ms, obtenu en ${duree} ms`);
    assert.ok(erreur.message.includes('exited during startup'), erreur.message);
    assert.ok(erreur.message.includes('SONDE_MORT'), erreur.message);
    assert.ok(!erreur.message.includes('within 3s'), erreur.message);
    assert.equal(fs.existsSync(montage.lifecycle.PID_FILE), false, 'aucun fichier de pid ne devait être écrit');
  } finally {
    nettoie(montage);
  }
});

test('start dont le serveur vit sans écouter : rejette au bout de 3 s en disant qu\'il n\'a pas répondu', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut, serveur: SERVEUR_MUET });
  try {
    // Act
    const erreur = await montage.lifecycle.start({ port }).then(() => null, e => e);

    // Assert
    assert.ok(erreur, 'start aurait dû lever');
    assert.ok(erreur.message.includes('did not answer within 3s'), erreur.message);
  } finally {
    nettoie(montage);
  }
});

test('stop sans fichier de pid vise le port demandé et y envoie POST /shutdown', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  try {
    // Act
    const resultat = await montage.lifecycle.stop({ port });

    // Assert
    assert.deepEqual(resultat, { stopped: true, port, viaShutdown: true });
    assert.ok(demon.requetes.includes('POST /shutdown'), JSON.stringify(demon.requetes));
  } finally {
    await demon.ferme();
    nettoie(montage);
  }
});

test('stop sans fichier de pid ni serveur sur le port demandé : rien n\'est arrêté', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  try {
    // Act
    const resultat = await montage.lifecycle.stop({ port });

    // Assert
    assert.deepEqual(resultat, { stopped: false, port, viaShutdown: false });
  } finally {
    nettoie(montage);
  }
});
