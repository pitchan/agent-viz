// start, status et stop parlent à de vrais processus sur de vrais ports : chaque
// test charge une copie de lifecycle.ts à côté d'un faux server.js, son port par
// défaut remplacé par un port de test, pour ne jamais sonder ni arrêter un démon réel.
import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = path.resolve(import.meta.dirname, '..', '..', 'src', 'server', 'lifecycle.ts');
const TEMOIN = 'lance.pid';

// `lifecycle` vient d'un `await import()` d'un chemin construit à l'exécution :
// son type n'est pas résolu statiquement, d'où le `any`.
type Montage = { lifecycle: any; dossier: string };

// Chaque faux server.js dépose son pid dans TEMOIN dès son lancement : le test
// sait ainsi s'il a été lancé, et le faux serveur sort seul quand son dossier disparaît.
const DEPOSE_TEMOIN = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  `fs.writeFileSync(path.join(import.meta.dirname, '${TEMOIN}'), String(process.pid));`,
].join('\n');

// Un faux serveur qui reste vivant sort de lui-même quand son témoin disparaît :
// nettoie efface le dossier et ne signale jamais un pid, que Windows peut avoir
// réattribué à un autre processus.
const SURVEILLE_TEMOIN =
  `setInterval(() => { if (!fs.existsSync(path.join(import.meta.dirname, '${TEMOIN}'))) process.exit(0); }, 50);`;

const SERVEUR_QUI_ECOUTE = [
  DEPOSE_TEMOIN,
  SURVEILLE_TEMOIN,
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
  SURVEILLE_TEMOIN,
].join('\n');

// Les serveurs restent ouverts jusqu'au dernier : deux ports demandés ensemble
// sont forcément distincts.
// Toujours appelée avec 2 : le retour se type en tuple de deux ports plutôt
// qu'un tableau, pour que la destructuration `[port, portParDefaut]` des tests
// rende des `number`, pas des `number | undefined` (noUncheckedIndexedAccess).
async function portsLibres(nombre: number): Promise<[number, number]> {
  const serveurs = [];
  for (let i = 0; i < nombre; i++) {
    const serveur = net.createServer();
    await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', resolve));
    serveurs.push(serveur);
  }
  const ports = serveurs.map(s => (s.address() as AddressInfo).port);
  await Promise.all(serveurs.map(s => new Promise<void>(resolve => s.close(() => resolve()))));
  return ports as [number, number];
}

async function demonFactice(port: number) {
  const requetes: string[] = [];
  const serveur = http.createServer((req, res) => {
    requetes.push(`${req.method} ${req.url}`);
    res.end('ok');
  });
  await new Promise<void>(resolve => serveur.listen(port, '127.0.0.1', resolve));
  const ferme = () => new Promise<void>(resolve => {
    serveur.close(() => resolve());
    serveur.closeAllConnections();
  });
  return { requetes, ferme };
}

// PID_FILE et LOG_FILE se calculent au chargement depuis os.tmpdir() : le
// dossier temporaire est redirigé le temps de l'import, pour que chaque copie
// ait les siens.
async function chargeLifecycle(
  { portParDefaut, serveur = SERVEUR_QUI_SORT }: { portParDefaut: number; serveur?: string },
) {
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

function pidLance({ dossier }: Montage) {
  try { return Number(fs.readFileSync(path.join(dossier, TEMOIN), 'utf8')); } catch { return null; }
}

function nettoie(montage: Montage) {
  fs.rmSync(montage.dossier, { recursive: true, force: true });
}

test('status : rien sur le port demandé et pas de fichier de pid, le démon est dit arrêté', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  try {
    // Act
    const etat = await montage.lifecycle.status({ port });

    // Assert
    expect(etat.running).toBe(false);
    expect(etat.stale).toBe(undefined);
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
    expect({ running, pid, port: etat.port, viaPidFile }).toEqual({ running: true, pid: null, port, viaPidFile: false });
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
    expect(resultat).toEqual({ alreadyRunning: true, pid: null, port });
    expect(pidLance(montage), 'le faux server.js ne devait pas être lancé').toBe(null);
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
    const erreur = await montage.lifecycle.start({ port, foreground: true }).then(() => null, (e: any) => e);

    // Assert
    expect(erreur, 'start aurait dû lever').toBeTruthy();
    expect(erreur.message.includes(`already running on port ${port} (`), erreur.message).toBeTruthy();
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
    expect(resultat).toEqual({ alreadyRunning: false, pid: pidLance(montage), port });
    const fichierPid = fs.readFileSync(montage.lifecycle.PID_FILE, 'utf8');
    expect(fichierPid.startsWith(`${resultat.pid}\n${port}\n`), JSON.stringify(fichierPid)).toBeTruthy();
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
    expect(resultat.stopped).toBe(true);
    expect(resultat.port).toBe(port);
    expect(fs.existsSync(montage.lifecycle.PID_FILE), 'le fichier de pid devait être retiré').toBe(false);
  } finally {
    nettoie(montage);
  }
});

// Sous Windows, un dossier ne se renomme pas tant qu'un fichier qu'il contient
// reste ouvert : la suppression, elle, réussit malgré un descripteur ouvert.
test('après start puis stop, le processus qui a lancé le démon ne tient plus le journal : son dossier se renomme du premier coup', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut, serveur: SERVEUR_QUI_ECOUTE });
  const dossierJournal = path.dirname(montage.lifecycle.LOG_FILE);
  const renomme = `${dossierJournal}-renomme`;
  try {
    await montage.lifecycle.start({ port });
    await montage.lifecycle.stop();

    // Act
    let erreur: NodeJS.ErrnoException | null = null;
    try { fs.renameSync(dossierJournal, renomme); } catch (e) { erreur = e as NodeJS.ErrnoException; }

    // Assert
    expect(erreur, `renommage refusé : ${erreur?.code} sur ${erreur?.path}`).toBe(null);
    expect(fs.existsSync(path.join(renomme, path.basename(montage.lifecycle.LOG_FILE))), 'le journal devait suivre son dossier').toBe(true);
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
    const erreur = await montage.lifecycle.start({ port }).then(() => null, (e: any) => e);

    // Assert
    const duree = Date.now() - debut;
    expect(erreur, 'start aurait dû lever').toBeTruthy();
    expect(duree < 3000, `rejet attendu avant 3 000 ms, obtenu en ${duree} ms`).toBeTruthy();
    expect(erreur.message.includes('exited during startup'), erreur.message).toBeTruthy();
    expect(erreur.message.includes('SONDE_MORT'), erreur.message).toBeTruthy();
    expect(!erreur.message.includes('within 3s'), erreur.message).toBeTruthy();
    expect(fs.existsSync(montage.lifecycle.PID_FILE), 'aucun fichier de pid ne devait être écrit').toBe(false);
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
    const erreur = await montage.lifecycle.start({ port }).then(() => null, (e: any) => e);

    // Assert
    expect(erreur, 'start aurait dû lever').toBeTruthy();
    expect(erreur.message.includes('did not answer within 3s'), erreur.message).toBeTruthy();
  } finally {
    nettoie(montage);
  }
});

test('stop sans fichier de pid vise le port demandé et y envoie POST /shutdown : le serveur qui ne sort pas n\'est pas dit arrêté', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  try {
    // Act
    const resultat = await montage.lifecycle.stop({ port });

    // Assert
    expect(resultat).toEqual({ stopped: false, port, why: 'still-answering' });
    expect(demon.requetes.includes('POST /shutdown'), JSON.stringify(demon.requetes)).toBeTruthy();
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
    expect(resultat).toEqual({ stopped: false, port, why: 'nothing-listening' });
  } finally {
    nettoie(montage);
  }
});

test('stop ne signale jamais le pid du fichier : pid vivant mais port muet, rien n\'est tué et le fichier est retiré', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const intrus = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(montage.lifecycle.PID_FILE, `${intrus.pid}\n${port}\n2026-01-01T00:00:00.000Z\n`);
  try {
    // Act
    const resultat = await montage.lifecycle.stop();

    // Assert
    expect(resultat).toEqual({ stopped: false, port, why: 'nothing-listening' });
    expect({ exitCode: intrus.exitCode, signalCode: intrus.signalCode }, 'le processus dont le pid figure dans le fichier ne devait pas être tué').toEqual({ exitCode: null, signalCode: null });
    expect(fs.existsSync(montage.lifecycle.PID_FILE), 'le fichier de pid périmé devait être retiré').toBe(false);
  } finally {
    intrus.kill();
    nettoie(montage);
  }
});

test('stop sur un port où un serveur étranger répond sans sortir : rien n\'est tué, le fichier de pid reste', async () => {
  // Arrange
  const [port, portParDefaut] = await portsLibres(2);
  const montage = await chargeLifecycle({ portParDefaut });
  const demon = await demonFactice(port);
  const intrus = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
  fs.writeFileSync(montage.lifecycle.PID_FILE, `${intrus.pid}\n${port}\n2026-01-01T00:00:00.000Z\n`);
  try {
    // Act
    const resultat = await montage.lifecycle.stop();

    // Assert
    expect(resultat).toEqual({ stopped: false, port, why: 'still-answering' });
    expect(demon.requetes.includes('POST /shutdown'), JSON.stringify(demon.requetes)).toBeTruthy();
    expect({ exitCode: intrus.exitCode, signalCode: intrus.signalCode }).toEqual({ exitCode: null, signalCode: null });
    expect(fs.existsSync(montage.lifecycle.PID_FILE), 'rien n\'a été arrêté : le fichier de pid reste').toBe(true);
  } finally {
    intrus.kill();
    await demon.ferme();
    nettoie(montage);
  }
});
