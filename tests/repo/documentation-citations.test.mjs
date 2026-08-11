// C7 (audit de qualité de code, docs/audit-qualite-code.md) : trois fichiers
// citaient le relevé de calibration de l'Observatoire par un chemin relatif
// vers `netgain/docs/`, un dossier qui n'a jamais existé dans ce dépôt. Un
// lecteur suit la citation, ne trouve rien, et n'a aucun repli.
//
// Ce filet n'est PAS un test unitaire (il lit le vrai disque, cf. `tests/CLAUDE.md`
// § 4) : c'est une vérification d'hygiène du dépôt, d'où `tests/repo/`.
//
// La règle qu'il tient : DANS UN COMMENTAIRE, un chemin relatif vers un document
// Markdown est une adresse — elle doit résoudre ici. Les documents qui vivent
// ailleurs (dépôt privé de la thèse) se citent par `docs/sources-externes.md`,
// qui les recense et dit, pour chacun, ce qui en tient lieu DANS ce dépôt.
//
// Trois restrictions, chacune pour une raison mesurée (sonde du 2026-08-11) :
//   1. commentaires seulement — dans le CODE, un nom de fichier Markdown est un
//      nom de fichier lu à l'exécution (`path.join(claudeDir, 'CLAUDE.md')`) ou
//      un chemin de bouchon de test, pas une citation ;
//   2. tokens contenant une barre oblique — `CLAUDE.md` nu ne désigne pas une
//      adresse mais une famille de fichiers (21 sites, tous licites) ;
//   3. chemins absolus et URL exclus — ce ne sont pas des chemins de ce dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// Généré (`netgain/dist/` est rebâti depuis `netgain/src/`), tiers, ou données
// de test figées : rien de tout cela ne porte une citation à maintenir.
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'fixtures', 'resultats']);
const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.html', '.css']);

function sourceFiles(dir = ROOT, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), acc);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

// La part commentée d'une ligne : ligne de bloc (`*`, `/*`, `<!--`, `#`) prise
// entière, sinon ce qui suit un `//` qui n'est pas celui d'une URL (`://`).
function commentPart(line) {
  const trimmed = line.trim();
  if (/^(\*|\/\*|<!--|#)/.test(trimmed)) return trimmed;
  const at = line.indexOf('//');
  if (at > 0 && line[at - 1] === ':') return '';
  return at === -1 ? '' : line.slice(at + 2);
}

const MARKDOWN_PATH = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.md\b/g;

function citations() {
  const found = [];
  for (const abs of sourceFiles()) {
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const comment = commentPart(line);
      for (const m of comment.matchAll(MARKDOWN_PATH)) {
        const before = comment[m.index - 1];
        if (before === '/' || before === ':') continue; // chemin absolu ou URL
        found.push({ file: rel, line: i + 1, cite: m[0] });
      }
    });
  }
  return found;
}

test('aucune citation de document ne pointe vers un chemin absent du dépôt', () => {
  // Arrange
  const cites = citations();

  // Act
  const dead = cites.filter(c => !existsSync(path.join(ROOT, c.cite)));

  // Assert
  assert.deepEqual(dead.map(c => `${c.file}:${c.line} → ${c.cite}`), [],
    'un document cité par un chemin relatif doit exister ici ; s\'il vit dans le dépôt privé, ' +
    'le citer via docs/sources-externes.md');
});

test('la sonde voit bien les citations qu\'elle est censée surveiller', () => {
  // Arrange — contrôle de l'instrument : un filet qui ne trouve RIEN passerait
  // aussi, et ne prouverait rien. Ces deux citations sont vivantes et le
  // resteront (l'audit et son cahier des charges sont dans ce dépôt).
  const cites = citations();

  // Act
  const vues = cites.filter(c => c.cite === 'docs/audit-qualite-code.md');

  // Assert
  assert.ok(vues.length >= 10, `attendu ≥ 10 citations de l'audit, vu ${vues.length}`);
});
