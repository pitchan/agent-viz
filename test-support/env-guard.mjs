// Garde d'environnement du harnais. Elle tourne AVANT tout module de test :
// - vitest : premiere entree de `setupFiles`, executee dans chaque worker
//   avant que le fichier de test (et ses require/import de portee de module)
//   ne charge ;
// - node --test : via `--import`, executee dans le processus principal puis
//   heritee (env) par chaque processus fils de test.
//
// Son role n'est PAS de remplacer les detournements que les tests posent
// eux-memes (watchdog-*.test, claude-dir-cli.test, install-hooks-entrypoint) :
// eux tournent APRES et gardent le dernier mot. Son role est d'etre le
// PLANCHER : si un point d'entree de production perd un jour sa garde
// (mutation, migration), l'ecriture part dans un bac jetable, jamais dans le
// vrai ~/.claude ni ~/.agent-viz.
//
// Mesure (doc/39, decision prevention-harnais, § 4) : sous
// Windows `os.homedir()` suit USERPROFILE seul ; HOME seule ne detourne rien.
// `os.tmpdir()` et `os.homedir()` relisent l'environnement a chaque appel.
// AGENT_VIZ_PORT=59999 est un port ou aucun demon n'ecoute : un runHook()
// accidentel parle dans le vide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Idempotente : les fils de `node --test` re-executent ce module (execArgv
// herite) mais heritent aussi de l'environnement deja detourne — le marqueur
// evite un bac par fils, tout le monde partage celui du processus principal.
if (!process.env.AGENT_VIZ_BAC_HARNAIS) {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-harnais-'));
  process.env.AGENT_VIZ_BAC_HARNAIS = bac;
  process.env.USERPROFILE = bac;
  process.env.HOME = bac;
  process.env.TEMP = bac;
  process.env.TMP = bac;
}
process.env.AGENT_VIZ_PORT = '59999';
