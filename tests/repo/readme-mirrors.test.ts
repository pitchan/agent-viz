// Le README recopie deux données du code : les événements que capture le hook de
// Claude Code, et le nombre de copies gardées par fichier de hooks. Ce test les
// verrouille contre leur source, qui fait foi.
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_CONFIG } from '../../src/server/install-hooks/config.ts';
import { BACKUPS_KEPT } from '../../src/server/install-hooks/backup.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
// Fins de ligne ramenées à `\n` : sous Windows, git extrait le README en CRLF.
const readme = () => readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

// Une section de niveau 2, sous-sections comprises, jusqu'au titre de niveau 2 suivant.
function section(texte: string, titre: string) {
  const debut = texte.indexOf(`## ${titre}\n`);
  const fin = texte.indexOf('\n## ', debut + 1);
  return debut === -1 ? '' : texte.slice(debut, fin === -1 ? undefined : fin);
}

test('le README « Captured events » nomme exactement les événements du hook de Claude Code', () => {
  // Arrange
  const attendus = [...AGENT_CONFIG.claude.events].sort();
  const texte = section(readme(), 'Captured events');
  // Act
  const premierePhrase = (texte.split('\n').find((ligne: string) => ligne.startsWith('`')) ?? '').split('. ')[0]!;
  const nommes = [...premierePhrase.matchAll(/`([A-Za-z]+)`/g)].map(m => m[1]).sort();
  // Assert
  expect(nommes, texte).toEqual(attendus);
});

test('le README marque « Claude Code only » chaque événement que Copilot ne capture pas', () => {
  // Arrange
  const copilot = new Set(AGENT_CONFIG.copilot.events);
  const propresAClaude = AGENT_CONFIG.claude.events.filter(ev => !copilot.has(ev));
  // Act
  const texte = section(readme(), 'Captured events');
  // Assert
  expect(propresAClaude.length > 0, 'aucun événement propre à Claude Code : le test ne vérifie plus rien').toBeTruthy();
  for (const ev of propresAClaude) {
    expect(texte.includes(`\`${ev}\` (Claude Code only)`), `« \`${ev}\` (Claude Code only) » attendu :\n${texte}`).toBeTruthy();
  }
});

test('le README « Hook management » annonce le nombre de copies que garde le module', () => {
  // Arrange
  const attendu = `The last ${BACKUPS_KEPT} copies of each file are kept.`;
  // Act
  const texte = section(readme(), 'Hook management');
  // Assert
  expect(texte.includes(attendu), `« ${attendu} » attendu dans « Hook management » :\n${texte}`).toBeTruthy();
});
