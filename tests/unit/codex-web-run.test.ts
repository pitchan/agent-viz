// Charges reprises d'une session Codex réelle, identifiants et chemins anonymisés. Codex remet
// au hook `webrun` pour l'outil que sa transcription appelle `tools.web__run` (groupe `web`,
// outil `run`) : une recherche, l'ouverture d'une page ou une recherche dans une page.
import { expect, test } from 'vitest';
import { NORMALIZERS } from '../../src/server/hook-normalize.ts';
import { toolSubject } from '../../src/engine/core/tool-subject.ts';
import type { ToolCallEvent } from '../../src/engine/core/tool-subject.ts';

function outil(toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: '01a182c6-0000-7000-8000-000000000001',
    turn_id: '01a182cb-0000-7000-8000-000000000002',
    transcript_path: 'C:/codex/sessions/rollout-session.jsonl',
    cwd: 'C:/projet',
    hook_event_name: 'PreToolUse',
    model: 'gpt-6.1-sol',
    permission_mode: 'bypassPermissions',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'exec-00000000-0000-4000-8000-000000000003',
  };
}

const RECHERCHE = {
  search_query: [
    { q: 'site.apolloresearch.ai oversight perceived monitoring scheming evaluation models 2025' },
    { q: 'site.arxiv.org Apollo Research monitoring oversight covert behavior evaluation awareness scheming' },
  ],
  response_length: 'long',
};
const OUVERTURE = { open: [{ ref_id: 'https://arxiv.org/html/2609.36139v1', lineno: 179 }], response_length: 'short' };
const DANS_LA_PAGE = {
  find: [{ ref_id: 'turn11view0', pattern: '97' }, { ref_id: 'turn11view0', pattern: 'Qwen' }],
  response_length: 'short',
};

function sujet(toolInput: Record<string, unknown>): string {
  return toolSubject(NORMALIZERS.codex(outil('webrun', toolInput), undefined) as ToolCallEvent);
}

test('l\'outil web de Codex porte son groupe et son nom, séparés', () => {
  // Arrange
  const brut = outil('webrun', RECHERCHE);
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt).toEqual({ ...brut, tool_name: 'web.run' });
});

test('une recherche web de Codex montre sa première requête', () => {
  expect(sujet(RECHERCHE)).toBe('site.apolloresearch.ai oversight perceived monitoring scheming evaluation models 2025');
});

test('l\'ouverture d\'une page par Codex montre son adresse', () => {
  expect(sujet(OUVERTURE)).toBe('https://arxiv.org/html/2609.36139v1');
});

test('une recherche dans une page par Codex montre le premier motif cherché', () => {
  expect(sujet(DANS_LA_PAGE)).toBe('97');
});

test('un outil Codex nommé exactement comme le groupe des sous-agents garde son nom', () => {
  expect(NORMALIZERS.codex(outil('collaboration', {}), undefined).tool_name).toBe('collaboration');
});

test('un outil Codex nommé exactement comme le groupe web garde son nom', () => {
  expect(NORMALIZERS.codex(outil('web', {}), undefined).tool_name).toBe('web');
});
