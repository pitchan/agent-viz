import { describe, expect, test } from 'vitest';
import type { ToolUseRef } from '../../src/core/events.js';
import { detectAgentGesture } from '../../src/doctor/aggregators/agent-gestures.js';

function tu(name: string, input: unknown): ToolUseRef {
  return { id: 'tu-1', name, input };
}

describe('detectAgentGesture — gestes de graphe de l’agent, précision avant rappel', () => {
  describe('grepImport (outil Grep)', () => {
    test('le geste canonique du réel : « qui importe GristServer » sur tout le dépôt', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: `from ['\\"].*lib/GristServer['\\"]`, glob: '**/*.ts' }))).toBe(
        'grepImport',
      );
    });

    test('même motif limité à UN fichier → null (« qu’importe CE fichier », lecture locale innocente)', () => {
      expect(
        detectAgentGesture(tu('Grep', { pattern: 'import.*validate|from.*[Cc]hecker', path: 'app/server/lib/DocApi.ts' })),
      ).toBeNull();
    });

    test('path répertoire (sans extension finale) → le geste reste un geste', () => {
      expect(
        detectAgentGesture(tu('Grep', { pattern: `from ['"].*GristServer`, path: 'D:\\bench-public\\grist-core\\app\\server' })),
      ).toBe('grepImport');
    });

    test('recherche d’identifiants contenant « require » en préfixe → null (faux ami du réel)', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: 'addRequestUser|requireLogin|withDoc' }))).toBeNull();
    });

    test('« important » ne contient pas le MOT import → null', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: 'important' }))).toBeNull();
    });

    test('échappements regex littéraux (\\bimport\\b) → normalisés puis détectés', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: 'import\\b.*from' }))).toBe('grepImport');
      expect(detectAgentGesture(tu('Grep', { pattern: '\\bimport\\b' }))).toBe('grepImport');
    });

    test('require\\( (CJS) → geste', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: `require\\(['"]` }))).toBe('grepImport');
    });

    test('motif sans forme d’import → null ; motif absent → null ; input non-objet → null', () => {
      expect(detectAgentGesture(tu('Grep', { pattern: 'ConfigModule' }))).toBeNull();
      expect(detectAgentGesture(tu('Grep', {}))).toBeNull();
      expect(detectAgentGesture(tu('Grep', 'motif-brut'))).toBeNull();
    });
  });

  describe('bashImport (outil Bash)', () => {
    test('rg avec forme d’import → geste', () => {
      expect(detectAgentGesture(tu('Bash', { command: `rg "from '@/lib/foo'" src/` }))).toBe('bashImport');
    });

    test('git grep import → geste', () => {
      expect(detectAgentGesture(tu('Bash', { command: 'git grep -n "import .* from" -- "*.ts"' }))).toBe('bashImport');
    });

    test('commande sans verbe de recherche → null, même si « import » apparaît', () => {
      expect(detectAgentGesture(tu('Bash', { command: 'npm install foo # import map' }))).toBeNull();
    });

    test('grep sans forme d’import → null (faux ami du réel)', () => {
      expect(detectAgentGesture(tu('Bash', { command: 'grep -rn "ConfigModule" src/' }))).toBeNull();
    });

    test('command absent → null', () => {
      expect(detectAgentGesture(tu('Bash', {}))).toBeNull();
    });
  });

  describe('spawnGraphPrompt (outils Agent/Task — mission de graphe déléguée)', () => {
    test('mission « qui importe X » → geste, via le détecteur livré du router', () => {
      expect(
        detectAgentGesture(tu('Agent', { description: 'trouver les importeurs', prompt: 'qui importe GristServer ?' })),
      ).toBe('spawnGraphPrompt');
    });

    test('le signal peut être dans la description seule', () => {
      expect(detectAgentGesture(tu('Task', { description: 'blast radius de auth.ts', prompt: 'analyse le fichier' }))).toBe(
        'spawnGraphPrompt',
      );
    });

    test('mission sans signal de graphe → null', () => {
      expect(detectAgentGesture(tu('Agent', { description: 'corriger un bug', prompt: "répare l'affichage du tableau" }))).toBeNull();
    });

    test('TaskCreate n’est PAS un spawn de sous-agent → null', () => {
      expect(detectAgentGesture(tu('TaskCreate', { prompt: 'qui importe GristServer ?' }))).toBeNull();
    });

    test('prompt et description absents → null', () => {
      expect(detectAgentGesture(tu('Agent', { subagent_type: 'Explore' }))).toBeNull();
    });
  });

  test('outil quelconque (Read, Edit…) → null', () => {
    expect(detectAgentGesture(tu('Read', { file_path: 'src/imports.ts' }))).toBeNull();
    expect(detectAgentGesture(tu('Edit', { file_path: 'a.ts', old_string: 'import x', new_string: 'import y' }))).toBeNull();
  });
});
