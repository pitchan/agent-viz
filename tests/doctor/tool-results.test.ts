import { describe, expect, test } from 'vitest';
import { familyOf, recognizeCommand } from '../../src/engine/doctor/aggregators/recognizers.js';
import { ToolResultsAggregator } from '../../src/engine/doctor/aggregators/tool-results.js';

describe('recognizeCommand', () => {
  test('reconnaît les reporters ciblés par le futur gate', () => {
    expect(recognizeCommand('npx vitest run tests/foo.test.ts')).toBe('vitest');
    expect(recognizeCommand('yarn jest --coverage')).toBe('jest');
    expect(recognizeCommand('npx tsc --noEmit')).toBe('tsc');
    expect(recognizeCommand('eslint src/ --fix')).toBe('eslint');
    expect(recognizeCommand('ng build --configuration production')).toBe('ng');
    expect(recognizeCommand('git log --oneline -n 20')).toBe('git-log');
    expect(recognizeCommand('git diff HEAD~1')).toBe('git-diff');
    expect(recognizeCommand('git status')).toBe('git-status');
    expect(recognizeCommand('python -m pytest tests/')).toBe('pytest');
    expect(recognizeCommand('npm install')).toBe('npm');
  });

  test('le spécifique gagne sur le générique, l’inconnu rend null', () => {
    expect(recognizeCommand('npm exec vitest run')).toBe('vitest');
    expect(recognizeCommand('cargo build --release')).toBeNull();
  });
});

describe('familyOf', () => {
  test('Bash : premier token + sous-commande pour git/npm/npx/yarn/pnpm, args supprimés', () => {
    expect(familyOf('Bash', { command: 'git log --oneline -n 20' })).toBe('git log');
    expect(familyOf('Bash', { command: 'npx vitest run tests/a.test.ts' })).toBe('npx vitest');
    expect(familyOf('Bash', { command: 'npm run build' })).toBe('npm run');
    expect(familyOf('Bash', { command: 'ls -la src/' })).toBe('ls');
  });

  test('préfixe « cd X && » ignoré pour la famille', () => {
    expect(familyOf('Bash', { command: 'cd "/f/proj" && npm test' })).toBe('npm test');
  });

  test('outils non-Bash : la famille est le nom de l’outil', () => {
    expect(familyOf('Read', { file_path: 'C:\\x.ts' })).toBe('Read');
    expect(familyOf('mcp__codesight__query', {})).toBe('mcp__codesight__query');
  });

  test('input sans command → nom de l’outil', () => {
    expect(familyOf('Bash', {})).toBe('Bash');
  });
});

describe('ToolResultsAggregator', () => {
  function feed(agg: ToolResultsAggregator, id: string, command: string, bytes: number): void {
    agg.registerToolUse({ id, name: 'Bash', input: { command } });
    agg.addToolResult({ kind: 'tool_result', toolUseId: id, bytes, isError: false, contentHash: null });
  }

  test('buckets de taille : <2 Ko / 2–30 Ko / >30 Ko', () => {
    const agg = new ToolResultsAggregator();
    feed(agg, 't1', 'ls', 100);
    feed(agg, 't2', 'npx vitest run', 5000);
    feed(agg, 't3', 'npx vitest run', 40000);
    const r = agg.result();
    expect(r.bySize.small).toEqual({ count: 1, bytes: 100 });
    expect(r.bySize.band).toEqual({ count: 1, bytes: 5000 });
    expect(r.bySize.large).toEqual({ count: 1, bytes: 40000 });
    expect(r.totalResults).toBe(3);
    expect(r.totalBytes).toBe(45100);
  });

  test('ventilation par outil et par recognizer (octets dans la bande 2–30 Ko à part)', () => {
    const agg = new ToolResultsAggregator();
    feed(agg, 't1', 'npx vitest run', 5000);
    feed(agg, 't2', 'npx vitest run', 40000);
    agg.registerToolUse({ id: 't3', name: 'Read', input: { file_path: 'x' } });
    agg.addToolResult({ kind: 'tool_result', toolUseId: 't3', bytes: 3000, isError: false, contentHash: null });
    const r = agg.result();
    expect(r.byTool['Bash']).toEqual({ count: 2, bytes: 45000 });
    expect(r.byTool['Read']).toEqual({ count: 1, bytes: 3000 });
    expect(r.byRecognizer['vitest']).toEqual({ count: 2, bytes: 45000, bandBytes: 5000 });
  });

  test('famille répétée ≥3 fois = répétitive ; non reconnue et ≥2 Ko de moyenne = candidat filtre', () => {
    const agg = new ToolResultsAggregator();
    // famille reconnue répétée : PAS candidate
    feed(agg, 'v1', 'npx vitest run a', 5000);
    feed(agg, 'v2', 'npx vitest run b', 5000);
    feed(agg, 'v3', 'npx vitest run c', 5000);
    // famille inconnue répétée et grosse : candidate
    feed(agg, 'c1', 'cargo test --lib', 8000);
    feed(agg, 'c2', 'cargo test --bin x', 8000);
    feed(agg, 'c3', 'cargo test --doc', 8000);
    // famille inconnue répétée mais petite : pas candidate
    feed(agg, 's1', 'ls -la', 200);
    feed(agg, 's2', 'ls src', 200);
    feed(agg, 's3', 'ls dist', 200);
    // famille inconnue grosse mais pas répétée : pas candidate
    feed(agg, 'u1', 'du -sh .', 9000);
    const r = agg.result();
    expect(r.repetitiveBytes).toBe(3 * 5000 + 3 * 8000 + 3 * 200);
    expect(r.candidateFilters).toEqual([{ family: 'cargo test', count: 3, bytes: 24000 }]);
  });

  test('tool_result sans tool_use apparié → outil (inconnu), compté quand même', () => {
    const agg = new ToolResultsAggregator();
    agg.addToolResult({ kind: 'tool_result', toolUseId: 'orphelin', bytes: 500, isError: false, contentHash: null });
    const r = agg.result();
    expect(r.byTool['(inconnu)']).toEqual({ count: 1, bytes: 500 });
  });
});
