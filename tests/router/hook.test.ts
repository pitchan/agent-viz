import { describe, expect, test } from 'vitest';
import { NUDGE_LINE } from '../../src/engine/router/detector.js';
import { buildHookResponse } from '../../src/engine/router/hook.js';

/**
 * Enveloppe du hook UserPromptSubmit (contrat vérifié doc officielle 2026-07-12) :
 * - injection = exit 0 + JSON { hookSpecificOutput: { hookEventName, additionalContext } }
 * - silence   = exit 0 + stdout VIDE (0 octet = 0 token)
 * - le hook tire sur CHAQUE prompt (pas de matcher) → fail-open obligatoire :
 *   toute entrée invalide = silence, jamais une exception (un hook qui crashe
 *   ou bloque ferait perdre plus que tout ce que la carte peut faire gagner).
 */

const stdinFor = (prompt: unknown): string =>
  JSON.stringify({
    session_id: 'abc123',
    transcript_path: 'C:\\tmp\\t.jsonl',
    cwd: 'C:\\repo',
    hook_event_name: 'UserPromptSubmit',
    prompt,
  });

describe('buildHookResponse — enveloppe UserPromptSubmit', () => {
  test('signal de graphe → JSON hookSpecificOutput avec la NUDGE_LINE', () => {
    const out = buildHookResponse(stdinFor('Donne-moi le blast radius de src/app/auth/auth.store.ts'));
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(parsed.hookSpecificOutput.additionalContext).toBe(NUDGE_LINE);
  });

  test('question énumérable (S11) → chaîne vide, exactement 0 octet', () => {
    const out = buildHookResponse(
      stdinFor("Fais l'inventaire de la surface d'API HTTP du backend : combien d'endpoints exposes au TOTAL ?"),
    );
    expect(out).toBe('');
  });

  test('prompt ordinaire → silence', () => {
    expect(buildHookResponse(stdinFor('Corrige le bug du formulaire de login.'))).toBe('');
  });

  test('stdin non-JSON → silence (fail-open), pas d’exception', () => {
    expect(buildHookResponse('pas du json {')).toBe('');
  });

  test('JSON sans champ prompt → silence', () => {
    expect(buildHookResponse(JSON.stringify({ hook_event_name: 'UserPromptSubmit' }))).toBe('');
  });

  test('prompt non-string → silence', () => {
    expect(buildHookResponse(stdinFor(42))).toBe('');
    expect(buildHookResponse(stdinFor(null))).toBe('');
  });

  test('stdin vide → silence', () => {
    expect(buildHookResponse('')).toBe('');
  });

  // Un writer Windows (PowerShell 5.1, .NET UTF8Encoding par défaut) préfixe un BOM U+FEFF ;
  // JSON.parse le rejette → sans tolérance, le fail-open désactiverait le router EN SILENCE
  // sur tout un harnais. Découvert en pré-vol J6 (2026-07-13) : pipe PS → hook = 100 % silent.
  test('stdin avec BOM UTF-8 → décision IDENTIQUE (pas un silence fail-open)', () => {
    const out = buildHookResponse('﻿' + stdinFor('Donne-moi le blast radius de src/app/auth/auth.store.ts'));
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toBe(NUDGE_LINE);
  });

  test('stdin avec BOM + fin de ligne CRLF → décision identique', () => {
    const out = buildHookResponse('﻿' + stdinFor('qui dépend de ce module ?') + '\r\n');
    expect(out).not.toBe('');
  });
});
