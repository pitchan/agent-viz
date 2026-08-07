// Unit tests for public/viz-tool-subject.mjs — the shared "what does this tool
// call act on?" rule.
//
// Two consumers need the same rule but not the same length: the feed shows a
// short label, the watchdog alert must show the command in full. So the module
// returns the untruncated subject and each consumer slices it itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolSubject } from '../../public/viz-tool-subject.mjs';

test('Bash: returns the full command, untruncated', () => {
  const long = 'npm run build -- --workspace=netgain --silent && node scripts/verify.js --strict';
  assert.equal(toolSubject({ tool_name: 'Bash', tool_input: { command: long } }), long);
});

test('Read/Write/Edit: returns the basename of the path', () => {
  for (const tool of ['Read', 'Write', 'Edit']) {
    assert.equal(
      toolSubject({ tool_name: tool, tool_input: { file_path: 'F:\\DEV\\agent-viz\\lib\\hook.js' } }),
      'hook.js',
      `${tool} should reduce a Windows path to its basename`,
    );
    assert.equal(
      toolSubject({ tool_name: tool, tool_input: { file_path: '/home/v/agent-viz/lib/hook.js' } }),
      'hook.js',
      `${tool} should reduce a POSIX path to its basename`,
    );
  }
});

test('Grep/Glob: returns the pattern', () => {
  assert.equal(toolSubject({ tool_name: 'Grep', tool_input: { pattern: 'agent_id' } }), 'agent_id');
  assert.equal(toolSubject({ tool_name: 'Glob', tool_input: { pattern: '**/*.mjs' } }), '**/*.mjs');
});

test('Agent: returns the description; Skill: returns the skill name', () => {
  assert.equal(toolSubject({ tool_name: 'Agent', tool_input: { description: 'Audit the CSS' } }), 'Audit the CSS');
  assert.equal(toolSubject({ tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } }), 'superpowers:brainstorming');
});

test('unknown tool → empty string', () => {
  assert.equal(toolSubject({ tool_name: 'SomeFutureTool', tool_input: { whatever: 1 } }), '');
});

test('missing tool_input → empty string', () => {
  assert.equal(toolSubject({ tool_name: 'Bash' }), '');
});

test('known tool with the identifying field missing → empty string', () => {
  assert.equal(toolSubject({ tool_name: 'Bash', tool_input: { description: 'no command here' } }), '');
});
