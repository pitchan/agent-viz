import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { extractLineMeta, normalizeEvent } from '../../src/engine/core/events.ts';

describe('normalizeEvent', () => {
  test('ligne assistant complète → événement assistant (usage, toolUses, texte)', () => {
    const raw = {
      type: 'assistant',
      isSidechain: false,
      timestamp: '2026-07-09T10:00:00.000Z',
      message: {
        id: 'msg_01AB',
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npx vitest run' } },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 2000,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
        },
      },
    };
    expect(normalizeEvent(raw)).toEqual([
      {
        kind: 'assistant',
        msgId: 'msg_01AB',
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 2000,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 },
        },
        usageVerdict: 'sain',
        toolUses: [{ id: 'toolu_1', name: 'Bash', input: { command: 'npx vitest run' } }],
        textChars: 5,
        timestamp: '2026-07-09T10:00:00.000Z',
        isSidechain: false,
      },
    ]);
  });

  test('ligne assistant minimale → champs null, jamais de throw', () => {
    const raw = { type: 'assistant', message: { role: 'assistant', content: [] } };
    expect(normalizeEvent(raw)).toEqual([
      {
        kind: 'assistant',
        msgId: null,
        model: null,
        usage: null,
        usageVerdict: 'absent',
        toolUses: [],
        textChars: 0,
        isSidechain: false,
      },
    ]);
  });

  test('ligne assistant à usage non objet → usage null, verdict malformé : il ne se confond pas avec l’absence', () => {
    // Arrange
    const raw = { type: 'assistant', message: { id: 'msg_04', role: 'assistant', content: [], usage: 'x' } };

    // Act
    const [evt] = normalizeEvent(raw);

    // Assert
    expect(evt).toMatchObject({ kind: 'assistant', usage: null, usageVerdict: 'malforme' });
  });

  test('ligne assistant à compte en chaîne → usage conservé tel quel, verdict malformé', () => {
    // Arrange
    const usage = { input_tokens: '100', output_tokens: 5 };
    const raw = { type: 'assistant', message: { id: 'msg_05', role: 'assistant', content: [], usage } };

    // Act
    const [evt] = normalizeEvent(raw);

    // Assert
    expect(evt).toMatchObject({ kind: 'assistant', usage, usageVerdict: 'malforme' });
  });

  test('ligne assistant sidechain porte agentId', () => {
    const raw = {
      type: 'assistant',
      isSidechain: true,
      agentId: 'a23dd33e',
      message: { id: 'msg_02', role: 'assistant', content: [] },
    };
    const [evt] = normalizeEvent(raw);
    expect(evt).toMatchObject({ kind: 'assistant', msgId: 'msg_02', isSidechain: true, agentId: 'a23dd33e' });
  });

  test('ligne assistant à diagnostics.cache_miss_reason → cacheMissReason (le type brut)', () => {
    const raw = {
      type: 'assistant',
      message: {
        id: 'msg_03',
        role: 'assistant',
        content: [],
        diagnostics: { cache_miss_reason: { type: 'tools_changed', cache_missed_input_tokens: 165887 } },
      },
    };
    const [evt] = normalizeEvent(raw);
    expect(evt).toMatchObject({ kind: 'assistant', msgId: 'msg_03', cacheMissReason: 'tools_changed' });
  });

  test('tool_result à contenu string → octets UTF-8', () => {
    const raw = {
      type: 'user',
      timestamp: '2026-07-09T10:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'été', is_error: false }],
      },
    };
    expect(normalizeEvent(raw)).toEqual([
      {
        kind: 'tool_result',
        toolUseId: 'toolu_1',
        bytes: 5,
        isError: false,
        contentHash: createHash('sha1').update('été', 'utf8').digest('hex'),
        timestamp: '2026-07-09T10:00:01.000Z',
      },
    ]);
  });

  test('tool_result à contenu array de blocks text → octets sommés, is_error propagé', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            is_error: true,
            content: [
              { type: 'text', text: 'abc' },
              { type: 'text', text: 'de' },
            ],
          },
        ],
      },
    };
    expect(normalizeEvent(raw)).toEqual([
      {
        kind: 'tool_result',
        toolUseId: 'toolu_2',
        bytes: 5,
        isError: true,
        contentHash: createHash('sha1').update('abcde', 'utf8').digest('hex'),
      },
    ]);
  });

  test('tool_result porte l’empreinte sha1 du contenu (string comme array de blocks)', () => {
    const sha1 = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex');
    const [fromString] = normalizeEvent({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'été' }] },
    });
    expect(fromString).toMatchObject({ kind: 'tool_result', contentHash: sha1('été') });
    const [fromBlocks] = normalizeEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't2',
            content: [
              { type: 'text', text: 'ét' },
              { type: 'text', text: 'é' },
            ],
          },
        ],
      },
    });
    // Même texte concaténé → même empreinte : la propriété dont dépend le dédoublonnage.
    expect(fromBlocks).toMatchObject({ kind: 'tool_result', contentHash: sha1('été') });
  });

  test('tool_result à contenu vide → empreinte null, jamais devinée', () => {
    const [evt] = normalizeEvent({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: '' }] },
    });
    expect(evt).toMatchObject({ kind: 'tool_result', contentHash: null });
  });

  test('deux tool_results dans la même ligne user → deux événements', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'bb' },
        ],
      },
    };
    const events = normalizeEvent(raw);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_1', bytes: 1 });
    expect(events[1]).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_2', bytes: 2 });
  });

  test('prompt user string → user_prompt', () => {
    const raw = {
      type: 'user',
      timestamp: '2026-07-09T09:00:00.000Z',
      message: { role: 'user', content: 'Analyse le document 09' },
    };
    expect(normalizeEvent(raw)).toEqual([
      { kind: 'user_prompt', text: 'Analyse le document 09', shape: 'string', timestamp: '2026-07-09T09:00:00.000Z' },
    ]);
  });

  test('prompt user en array de blocks text → texte concaténé', () => {
    const raw = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'ligne 1' },
          { type: 'text', text: 'ligne 2' },
        ],
      },
    };
    expect(normalizeEvent(raw)).toEqual([{ kind: 'user_prompt', text: 'ligne 1\nligne 2', shape: 'blocks' }]);
  });

  test('la forme du prompt est conservée : chaîne brute → shape "string"', () => {
    const events = normalizeEvent({ type: 'user', message: { role: 'user', content: 'lance le bench' } });
    expect(events).toEqual([{ kind: 'user_prompt', text: 'lance le bench', shape: 'string' }]);
  });

  test('la forme du prompt est conservée : blocs → shape "blocks"', () => {
    const events = normalizeEvent({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'corrige le test' }] },
    });
    expect(events).toEqual([{ kind: 'user_prompt', text: 'corrige le test', shape: 'blocks' }]);
  });

  test('promptSource et origin.kind de la ligne sont exposés sur user_prompt', () => {
    const events = normalizeEvent({
      type: 'user',
      message: { role: 'user', content: 'fais X' },
      promptSource: 'typed',
      origin: { kind: 'human' },
    });
    expect(events).toEqual([{ kind: 'user_prompt', text: 'fais X', shape: 'string', promptSource: 'typed', originKind: 'human' }]);
  });

  test('sans ces champs sur la ligne, user_prompt ne les porte pas (toEqual stable)', () => {
    const events = normalizeEvent({ type: 'user', message: { role: 'user', content: 'fais X' } });
    expect(events).toEqual([{ kind: 'user_prompt', text: 'fais X', shape: 'string' }]);
  });

  test('ligne user isMeta → meta, pas un prompt', () => {
    const raw = { type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: ...' } };
    expect(normalizeEvent(raw)).toEqual([{ kind: 'meta' }]);
  });

  test('compact_boundary → événement compact', () => {
    const raw = {
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { trigger: 'auto', preTokens: 365785 },
    };
    expect(normalizeEvent(raw)).toEqual([{ kind: 'compact', trigger: 'auto', preTokens: 365785 }]);
  });

  test('type inconnu → other avec le type, jamais de throw', () => {
    expect(normalizeEvent({ type: 'queue-operation', operation: 'dequeue' })).toEqual([
      { kind: 'other', topLevelType: 'queue-operation' },
    ]);
    expect(normalizeEvent(42)).toEqual([{ kind: 'other', topLevelType: 'invalid' }]);
    expect(normalizeEvent({})).toEqual([{ kind: 'other', topLevelType: 'unknown' }]);
  });
});

describe('extractLineMeta', () => {
  test('remonte cwd, version, gitBranch quand présents', () => {
    expect(
      extractLineMeta({ type: 'user', cwd: 'F:\\proj', version: '2.1.201', gitBranch: 'main', message: {} }),
    ).toEqual({ cwd: 'F:\\proj', version: '2.1.201', gitBranch: 'main' });
    expect(extractLineMeta({ type: 'assistant' })).toEqual({});
    expect(extractLineMeta('junk')).toEqual({});
  });
});

describe('normalizeEvent — traces des skills', () => {
  test('la ligne assistant garde attributionSkill', () => {
    // Arrange
    const raw = {
      type: 'assistant', attributionSkill: 'superpowers:brainstorming', attributionPlugin: 'superpowers',
      message: { id: 'msg_s1', role: 'assistant', content: [] },
    };
    // Act
    const [evt] = normalizeEvent(raw);
    // Assert
    expect(evt).toMatchObject({ kind: 'assistant', attributionSkill: 'superpowers:brainstorming' });
  });

  test('un attributionSkill non-chaîne ne produit pas de champ', () => {
    // Arrange
    const raw = { type: 'assistant', attributionSkill: 42, message: { id: 'msg_s2', role: 'assistant', content: [] } };
    // Act
    const [evt] = normalizeEvent(raw);
    // Assert
    expect(evt && 'attributionSkill' in evt).toBe(false);
  });

  test('une pièce jointe skill_listing devient un événement skill_listing, noms non-chaînes écartés', () => {
    // Arrange
    const raw = {
      type: 'attachment',
      attachment: { type: 'skill_listing', isInitial: true, skillCount: 3, names: ['pptx', 'superpowers:brainstorming', 7], content: '- pptx: …' },
    };
    // Act
    const events = normalizeEvent(raw);
    // Assert
    expect(events).toEqual([{ kind: 'skill_listing', names: ['pptx', 'superpowers:brainstorming'] }]);
  });

  test('une autre pièce jointe reste un événement other', () => {
    // Arrange
    const raw = { type: 'attachment', attachment: { type: 'total_tokens_reminder' } };
    // Act
    const events = normalizeEvent(raw);
    // Assert
    expect(events).toEqual([{ kind: 'other', topLevelType: 'attachment' }]);
  });
});
