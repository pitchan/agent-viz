import { detectGraphSignal, NUDGE_LINE } from './detector.js';

/**
 * Hook UserPromptSubmit (spec §2.3) — l'enveloppe autour du détecteur.
 * Pas de matcher possible sur cet événement : le hook tire sur CHAQUE prompt,
 * donc fail-open absolu — toute entrée invalide = silence (stdout vide, exit 0),
 * jamais une exception ni un exit 2 (on ne bloque JAMAIS un prompt).
 */
export function buildHookResponse(stdinRaw: string): string {
  let prompt: unknown;
  try {
    // BOM U+FEFF toléré : un writer Windows (.NET UTF8Encoding) le préfixe, JSON.parse le
    // rejette — sans strip, le fail-open désactiverait le router EN SILENCE sur ce harnais.
    prompt = (JSON.parse(stdinRaw.replace(/^﻿/, '')) as { prompt?: unknown }).prompt;
  } catch {
    return '';
  }
  if (typeof prompt !== 'string') return '';
  if (detectGraphSignal(prompt) === null) return '';
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: NUDGE_LINE },
  });
}

/** Entrée CLI `netgain router-hook` : stdin → stdout, exit 0 quoi qu'il arrive. */
export async function runRouterHookCli(): Promise<number> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const out = buildHookResponse(Buffer.concat(chunks).toString('utf8'));
    if (out !== '') process.stdout.write(out);
  } catch {
    // fail-open : le statu quo (aucune injection) est toujours un résultat valide.
  }
  return 0;
}
