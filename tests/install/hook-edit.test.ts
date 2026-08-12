import { describe, expect, test } from 'vitest';
import { InstallError } from '../../src/engine/install/json-file.js';
import {
  applyHookOff,
  applyHookOn,
  buildHookCommand,
  buildHookEntry,
  hasNetgainHook,
  isNetgainRouterHook,
} from '../../src/engine/install/hook-edit.js';

const NETGAIN = 'F:\\DEV\\agent-viz\\netgain';
const CMD = 'node "F:/DEV/agent-viz/netgain/dist/engine/cli.js" router-hook';
const ENTRY = { type: 'command', command: CMD, timeout: 10 };

describe('buildHookCommand / buildHookEntry', () => {
  test('quoting exact du chemin à espaces, timeout 10', () => {
    expect(buildHookCommand(NETGAIN)).toBe(CMD);
    expect(buildHookEntry(NETGAIN)).toEqual(ENTRY);
  });
});

describe('isNetgainRouterHook', () => {
  test('commande canonique → oui', () => {
    expect(isNetgainRouterHook(CMD)).toBe(true);
  });

  test('entrée périmée (autre chemin netgain, sans quotes) → oui', () => {
    expect(isNetgainRouterHook('node C:/vieux/netgain/dist/cli.js router-hook')).toBe(true);
  });

  test('« foo router-hook » sans netgain → NON (hook étranger)', () => {
    expect(isNetgainRouterHook('foo router-hook')).toBe(false);
  });

  test('netgain sans router-hook → non', () => {
    expect(isNetgainRouterHook('node netgain/dist/cli.js doctor')).toBe(false);
  });

  test('non-string → non', () => {
    expect(isNetgainRouterHook(42)).toBe(false);
    expect(isNetgainRouterHook(undefined)).toBe(false);
  });
});

describe('applyHookOn', () => {
  test('depuis un fichier absent (undefined) : structure complète exacte, changed', () => {
    const { value, changed } = applyHookOn(undefined, NETGAIN);
    expect(changed).toBe(true);
    expect(value).toEqual({ hooks: { UserPromptSubmit: [{ hooks: [ENTRY] }] } });
  });

  test('préserve les hooks étrangers du même groupe et les autres événements', () => {
    const etranger = { type: 'command', command: 'echo salut' };
    const root = {
      permissions: { allow: ['Bash'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }],
        UserPromptSubmit: [{ hooks: [etranger] }],
      },
    };
    const { value, changed } = applyHookOn(root, NETGAIN);
    expect(changed).toBe(true);
    const v = value as any;
    expect(v.permissions).toEqual({ allow: ['Bash'] });
    expect(v.hooks.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }]);
    expect(v.hooks.UserPromptSubmit[0]).toEqual({ hooks: [etranger] });
    expect(v.hooks.UserPromptSubmit[1]).toEqual({ hooks: [ENTRY] });
  });

  test('idempotence : rejouer on ne change rien (changed:false)', () => {
    const first = applyHookOn(undefined, NETGAIN);
    const second = applyHookOn(first.value, NETGAIN);
    expect(second.changed).toBe(false);
    expect(second.value).toEqual(first.value);
  });

  test('upsert : une entrée périmée est purgée, le groupe vidé nettoyé, la canonique posée', () => {
    const root = {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node C:/vieux/netgain/dist/cli.js router-hook', timeout: 5 }] }],
      },
    };
    const { value, changed } = applyHookOn(root, NETGAIN);
    expect(changed).toBe(true);
    expect((value as any).hooks.UserPromptSubmit).toEqual([{ hooks: [ENTRY] }]);
  });

  test('UserPromptSubmit non-tableau → InstallError', () => {
    expect(() => applyHookOn({ hooks: { UserPromptSubmit: 'cassé' } }, NETGAIN)).toThrow(InstallError);
  });
});

describe('applyHookOff', () => {
  test("retire notre hook, préserve l'étranger du même groupe (groupe conservé)", () => {
    const etranger = { type: 'command', command: 'echo salut' };
    const root = { hooks: { UserPromptSubmit: [{ hooks: [etranger, ENTRY] }] } };
    const { value, changed } = applyHookOff(root, NETGAIN);
    expect(changed).toBe(true);
    expect(value).toEqual({ hooks: { UserPromptSubmit: [{ hooks: [etranger] }] } });
  });

  test('nettoie groupe et événement vidés, garde les autres clés — jamais de fichier vidé en objet nu', () => {
    const root = { autre: 1, hooks: { UserPromptSubmit: [{ hooks: [ENTRY] }] } };
    const { value, changed } = applyHookOff(root, NETGAIN);
    expect(changed).toBe(true);
    expect(value).toEqual({ autre: 1 });
  });

  test('idempotence : off sans notre hook ne change rien (changed:false)', () => {
    const root = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo salut' }] }] } };
    expect(applyHookOff(root, NETGAIN).changed).toBe(false);
    expect(applyHookOff(undefined, NETGAIN).changed).toBe(false);
  });

  test('racine SANS « netgain » dans le chemin : off retire quand même notre entrée canonique', () => {
    const sansNetgain = 'F:\\ngroot';
    const posed = applyHookOn(undefined, sansNetgain);
    expect(hasNetgainHook(posed.value, sansNetgain)).toEqual({ present: true, canonical: true });
    const { value, changed } = applyHookOff(posed.value, sansNetgain);
    expect(changed).toBe(true);
    expect(value).toEqual({});
  });
});

describe('hasNetgainHook', () => {
  test('absent', () => {
    expect(hasNetgainHook(undefined, NETGAIN)).toEqual({ present: false, canonical: false });
    expect(hasNetgainHook({}, NETGAIN)).toEqual({ present: false, canonical: false });
  });

  test('canonique', () => {
    const { value } = applyHookOn(undefined, NETGAIN);
    expect(hasNetgainHook(value, NETGAIN)).toEqual({ present: true, canonical: true });
  });

  test('périmé : présent sans être canonique', () => {
    const root = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node C:/vieux/netgain/dist/cli.js router-hook' }] }] } };
    expect(hasNetgainHook(root, NETGAIN)).toEqual({ present: true, canonical: false });
  });
});
