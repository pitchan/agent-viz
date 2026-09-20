// Unit tests for src/engine/core/tool-subject.ts — the shared "what does this tool
// call act on?" rule.
//
// Two consumers need the same rule but not the same length: the feed shows a
// short label, the watchdog alert must show the command in full. So the module
// returns the untruncated subject and each consumer slices it itself.

import { expect, test } from 'vitest';
import { toolSubject } from '../../src/engine/core/tool-subject.ts';
import type { ToolCallEvent } from '../../src/engine/core/tool-subject.ts';

test('Bash: returns the full command, untruncated', () => {
  const long = 'npm run build -- --workspace=netgain --silent && node scripts/verify.js --strict';
  expect(toolSubject({ tool_name: 'Bash', tool_input: { command: long } })).toBe(long);
});

// PowerShell carries its command in the same field as Bash. Without its entry in
// the table, a retryStorm episode on PowerShell displays with no command at all —
// the one fact the reader needs.
test('PowerShell: returns the full command, untruncated', () => {
  const long = 'Get-Content "F:/DEV/rejeu-r7/sans/backend/log.txt" -Tail 50; if ($?) { npm run replay }';
  expect(toolSubject({ tool_name: 'PowerShell', tool_input: { command: long } })).toBe(long);
});

test('Read/Write/Edit: returns the basename of the path', () => {
  for (const tool of ['Read', 'Write', 'Edit']) {
    expect(toolSubject({ tool_name: tool, tool_input: { file_path: 'F:\\DEV\\agent-viz\\lib\\hook.js' } }), `${tool} should reduce a Windows path to its basename`).toBe('hook.js');
    expect(toolSubject({ tool_name: tool, tool_input: { file_path: '/home/v/agent-viz/lib/hook.js' } }), `${tool} should reduce a POSIX path to its basename`).toBe('hook.js');
  }
});

test('Grep/Glob: returns the pattern', () => {
  expect(toolSubject({ tool_name: 'Grep', tool_input: { pattern: 'agent_id' } })).toBe('agent_id');
  expect(toolSubject({ tool_name: 'Glob', tool_input: { pattern: '**/*.mjs' } })).toBe('**/*.mjs');
});

test('Agent: returns the description; Skill: returns the skill name', () => {
  expect(toolSubject({ tool_name: 'Agent', tool_input: { description: 'Audit the CSS' } })).toBe('Audit the CSS');
  expect(toolSubject({ tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } })).toBe('superpowers:brainstorming');
});

test('unknown tool → empty string', () => {
  expect(toolSubject({ tool_name: 'SomeFutureTool', tool_input: { whatever: 1 } } as unknown as ToolCallEvent)).toBe('');
});

test('missing tool_input → empty string', () => {
  expect(toolSubject({ tool_name: 'Bash' })).toBe('');
});

test('known tool with the identifying field missing → empty string', () => {
  expect(toolSubject({ tool_name: 'Bash', tool_input: { description: 'no command here' } })).toBe('');
});

// tool_input vient d'un hook, pas de ce module : file_path peut arriver hors
// chaine. Verrouille la coercition `String()` de basename() — un typage seul
// ne peut pas la tenir, un JSON de hook n'est pas contraint par TypeScript.
test('Read: un file_path hors chaîne ne fait pas lever', () => {
  expect(toolSubject({ tool_name: 'Read', tool_input: { file_path: 42 } } as unknown as ToolCallEvent)).toBe('42');
});
