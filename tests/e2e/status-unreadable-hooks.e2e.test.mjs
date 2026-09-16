// `agent-viz status` sur un projet dont le fichier de hooks est illisible. Le
// vrai binaire tourne sur le vrai dist/, avec home, dossier temporaire et projet
// jetables, et un port qu'aucun démon n'écoute pour que l'état soit constant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/agent-viz.js', import.meta.url));
// Port hors de la plage que le produit essaie tout seul : le sondage échoue, et
// `status` décrit un démon arrêté au lieu de dépendre de la machine. Il passe
// par l'environnement parce que `status` n'accepte pas d'option `--port`.
const PORT_MUET = '39917';

function bacJetable() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-status-'));
  const projet = path.join(racine, 'projet');
  fs.mkdirSync(path.join(projet, '.git'), { recursive: true });
  return { racine, projet };
}

function lanceStatus(projet, racine) {
  return spawnSync(process.execPath, [BIN, 'status'], {
    cwd: projet,
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env, PORT: PORT_MUET,
      USERPROFILE: racine, HOME: racine, TEMP: racine, TMP: racine,
    },
  });
}

const CAS = [
  {
    nom: 'Claude Code',
    fichier: projet => path.join(projet, '.claude', 'settings.json'),
    tronque: '{ "hooks": { "Stop": [ ',
  },
  {
    nom: 'Copilot CLI',
    fichier: projet => path.join(projet, '.github', 'hooks', 'agent-viz.json'),
    tronque: '{ "version": 1, "hooks": { "Stop": [',
  },
];

for (const cas of CAS) {
  test(`status survit a un fichier de hooks ${cas.nom} illisible et le nomme`, () => {
    // Arrange
    const { racine, projet } = bacJetable();
    const fichier = cas.fichier(projet);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, cas.tronque);

    // Act
    const r = lanceStatus(projet, racine);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `status ne doit pas mourir sur un fichier illisible :\n${sortie}`);
    assert.ok(!sortie.includes('    at '),
      `aucune pile d'appels ne doit atteindre l'utilisateur :\n${sortie}`);
    assert.ok(sortie.includes('unreadable'),
      `le fichier illisible doit etre signale, pas passe sous silence :\n${sortie}`);
    assert.ok(sortie.includes(cas.nom),
      `l'agent concerne doit etre nomme :\n${sortie}`);
    fs.rmSync(racine, { recursive: true, force: true });
  });
}

test('status reste muet sur les hooks quand aucun fichier n\'existe', () => {
  // Arrange
  const { racine, projet } = bacJetable();

  // Act
  const r = lanceStatus(projet, racine);

  // Assert
  const sortie = `${r.stdout}${r.stderr}`;
  assert.ok(!sortie.includes('unreadable'),
    `un projet sans fichier de hooks ne doit rien signaler :\n${sortie}`);
  fs.rmSync(racine, { recursive: true, force: true });
});
