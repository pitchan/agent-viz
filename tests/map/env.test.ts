import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapEnv } from '../../src/engine/map/env.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-env-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

fixture(
  'src/direct.ts',
  [
    'const url = process.env.DATABASE_URL;',
    "const key = process.env['API_SECRET'];",
    'export const both = url && key;',
    '',
  ].join('\n'),
);

fixture(
  'src/guard.ts',
  [
    'if (!process.env.JWT_SECRET) {',
    "  throw new Error('JWT_SECRET manquant');",
    '}',
    'export const secret = process.env.JWT_SECRET;',
    '',
  ].join('\n'),
);

fixture(
  'src/zod.ts',
  [
    "import { z } from 'zod';",
    'const schema = z.object({',
    '  PORT: z.coerce.number(),',
    '  REDIS_URL: z.string().url(),',
    '  LOG_LEVEL: z.string().optional(),',
    "  NODE_ENV: z.string().default('development'),",
    '});',
    'export const env = schema.parse(process.env);',
    '',
  ].join('\n'),
);

fixture(
  'src/nest-config.ts',
  [
    "import { ConfigModule } from '@nestjs/config';",
    "import * as Joi from 'joi';",
    'export const config = ConfigModule.forRoot({',
    '  validationSchema: Joi.object({',
    '    SUPABASE_URL: Joi.string().required(),',
    '    SUPABASE_KEY: Joi.string().required(),',
    "    CACHE_TTL: Joi.number().default(60),",
    '  }),',
    '});',
    '',
  ].join('\n'),
);

fixture(
  'src/service.ts',
  [
    'export class FooService {',
    '  constructor(private readonly configService: any) {}',
    '  connect() {',
    "    return this.configService.get('MOTEUR_IMMO_TOKEN');",
    '  }',
    '}',
    '',
  ].join('\n'),
);

fixture(
  'src/envalid.ts',
  [
    "import { cleanEnv, str, port } from 'envalid';",
    'export const env = cleanEnv(process.env, {',
    '  SMTP_HOST: str(),',
    '  SMTP_PORT: port({ default: 587 }),',
    '});',
    '',
  ].join('\n'),
);

fixture(
  'src/composite-guard.ts',
  [
    "if (process.env.APP_MODE === 'production' && !process.env.SERVICE_KEY) {",
    "  throw new Error('SERVICE_KEY requis en production');",
    '}',
    '',
  ].join('\n'),
);

// Repro exacte S10-N bug 1 (supabase.config.ts) : garde composée via liaisons
// intermédiaires const, disjonction `!u || !k` au niveau module.
fixture(
  'src/binding-guard.ts',
  [
    'const boundUrl = process.env.BOUND_URL;',
    'const boundKey = process.env.BOUND_KEY;',
    '',
    'if (!boundUrl || !boundKey) {',
    "  throw new Error('BOUND_URL et BOUND_KEY doivent être définis.');",
    '}',
    '',
    'export const client = boundUrl + boundKey;',
    '',
  ].join('\n'),
);

// Repro exacte S10-N bug 1 (auth.service.ts) : même pattern DANS une fonction.
fixture(
  'src/binding-guard-fn.ts',
  [
    'export async function verify() {',
    '  const url = process.env.FN_BOUND_URL;',
    '  if (!url) {',
    "    throw new Error('FN_BOUND_URL manquant');",
    '  }',
    '  return url;',
    '}',
    '',
  ].join('\n'),
);

// Liaison SANS garde-throw : ne doit jamais devenir required.
fixture(
  'src/binding-noguard.ts',
  [
    'const token = process.env.UNGUARDED_TOKEN;',
    'if (!token) {',
    "  console.warn('absent');",
    '}',
    'export const t = token;',
    '',
  ].join('\n'),
);

// Repro exacte S10-N bug 2 (main.ts:13) : condition NODE_ENV portée, avec en
// prime une lecture à défaut plus bas (supabase.config.ts:28) que la dédup ne
// doit pas laisser gagner.
fixture(
  'src/conditional-guard.ts',
  [
    "if (process.env.NODE_ENV === 'production' && !process.env.PROD_ONLY_KEY) {",
    "  throw new Error('PROD_ONLY_KEY doit être défini en production');",
    '}',
    "export const k = process.env.PROD_ONLY_KEY || 'fallback';",
    '',
  ].join('\n'),
);

// Bug 1 + bug 2 combinés : liaison intermédiaire gardée sous condition NODE_ENV.
fixture(
  'src/conditional-binding.ts',
  [
    'const svc = process.env.COND_BOUND_KEY;',
    "if (process.env.NODE_ENV === 'production' && !svc) {",
    "  throw new Error('COND_BOUND_KEY requis en prod');",
    '}',
    '',
  ].join('\n'),
);

// Conjonction NON reconnue : on ne prouve rien, donc on n'affirme rien.
fixture(
  'src/opaque-guard.ts',
  [
    'const flagActive = Math.random() > 0.5;',
    'if (flagActive && !process.env.MYSTERY_KEY) {',
    "  throw new Error('MYSTERY_KEY manquant');",
    '}',
    '',
  ].join('\n'),
);

// If imbriqué reconnu : la condition externe gate le throw et doit être portée.
fixture(
  'src/nested-guard.ts',
  [
    "if (process.env.NODE_ENV === 'production') {",
    '  if (!process.env.NESTED_PROD_KEY) {',
    "    throw new Error('NESTED_PROD_KEY requis en prod');",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Throw conditionnel NON prouvé à l'INTÉRIEUR de la garde : jamais required=true sec.
fixture(
  'src/nested-opaque.ts',
  [
    'const dbReady = Math.random() > 0.5;',
    'if (!process.env.INNER_KEY) {',
    '  if (dbReady) {',
    "    throw new Error('INNER_KEY manquant');",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Repro exacte S10-N rejeu (turnstile.service.ts / guest-jwt.service.ts) :
// propriété de classe assignée depuis configService.get au constructeur avec
// fallback falsy, gardée par throw sous condition NODE_ENV portée par une
// liaison const intermédiaire. Les 4 extensions J1-fix2 réunies.
fixture(
  'src/class-prop-guard.ts',
  [
    'export class TurnstileLikeService {',
    '  private readonly logger = { warn: (_: string) => {} };',
    '  private readonly secretKey: string;',
    '',
    '  constructor(',
    '    private readonly httpService: unknown,',
    '    private readonly configService: { get<T>(k: string): T | undefined },',
    '  ) {',
    "    this.secretKey = this.configService.get<string>('CLASS_PROP_SECRET') || '';",
    '',
    '    if (!this.secretKey) {',
    '      const isProd =',
    "        this.configService.get<string>('NODE_ENV') === 'production';",
    '      if (isProd) {',
    "        throw new Error('CLASS_PROP_SECRET doit être définie en production');",
    '      }',
    "      this.logger.warn('désactivée (dev uniquement)');",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Garde this.propriété dans une MÉTHODE (la liaison vaut pour toute la classe,
// pas seulement la fonction englobante : le constructeur s'exécute d'abord).
fixture(
  'src/class-prop-method-guard.ts',
  [
    'export class UrlService {',
    '  private readonly url: string | undefined;',
    '',
    '  constructor() {',
    '    this.url = process.env.THIS_PROP_URL;',
    '  }',
    '',
    '  connect(): string {',
    '    if (!this.url) {',
    "      throw new Error('THIS_PROP_URL manquant');",
    '    }',
    '    return this.url;',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Propriété RÉASSIGNÉE ailleurs dans la classe : on ne sait plus ce que vaut
// this.token au moment de la garde → jamais required.
fixture(
  'src/class-prop-reassigned.ts',
  [
    'export class TokenService {',
    '  private token: string | undefined;',
    '',
    '  constructor() {',
    '    this.token = process.env.REASSIGNED_KEY;',
    '  }',
    '',
    '  reset(): void {',
    "    this.token = 'vide';",
    '  }',
    '',
    '  use(): string {',
    '    if (!this.token) {',
    "      throw new Error('token absent');",
    '    }',
    '    return this.token;',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// configService.get gardé DIRECTEMENT (sans liaison) : lecture env reconnue.
fixture(
  'src/cs-direct-guard.ts',
  [
    'export class DirectService {',
    '  constructor(private readonly configService: { get(k: string): string | undefined }) {',
    "    if (!this.configService.get('CS_GUARDED')) {",
    "      throw new Error('CS_GUARDED manquant');",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// configService.get lié à une CONST locale puis gardé (dataflow J1-fix étendu
// aux lectures configService).
fixture(
  'src/cs-binding-guard.ts',
  [
    'export function boot(configService: { get(k: string): string | undefined }): string {',
    "  const url = configService.get('CS_BOUND');",
    '  if (!url) {',
    "    throw new Error('CS_BOUND manquant');",
    '  }',
    '  return url;',
    '}',
    '',
  ].join('\n'),
);

// Fallback TRUTHY : this.k ne peut jamais être falsy, la garde est inerte —
// affirmer required serait un mensonge.
fixture(
  'src/class-prop-truthy-fallback.ts',
  [
    'export class FallbackService {',
    '  private readonly k: string;',
    '',
    '  constructor() {',
    "    this.k = process.env.TRUTHY_FALLBACK_KEY || 'défaut';",
    '    if (!this.k) {',
    "      throw new Error('jamais atteint');",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Défaut passé en 2e argument de .get() : falsy ('') → la garde reste
// atteignable (repro moteur-immo.service.ts) ; TRUTHY → garde inerte, on
// n'affirme rien.
fixture(
  'src/cs-default-arg.ts',
  [
    'export class DefaultArgService {',
    '  private readonly apiKey: string;',
    '  private readonly label: string;',
    '',
    '  constructor(private readonly configService: { get<T>(k: string, d?: T): T }) {',
    "    this.apiKey = this.configService.get<string>('CS_FALSY_DEFAULT', '');",
    "    this.label = this.configService.get<string>('CS_TRUTHY_DEFAULT', 'fallback');",
    '  }',
    '',
    '  use(): void {',
    '    if (!this.apiKey) {',
    "      throw new Error('CS_FALSY_DEFAULT manquant');",
    '    }',
    '    if (!this.label) {',
    "      throw new Error('jamais atteint');",
    '    }',
    "    if (!this.configService.get<string>('CS_TRUTHY_DIRECT', 'x')) {",
    "      throw new Error('jamais atteint non plus');",
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Condition liée à une const (const isProd = ... === 'production') utilisée
// dans la conjonction de garde : la condition doit être résolue et portée.
fixture(
  'src/cond-const-binding.ts',
  [
    "const isProd = process.env.NODE_ENV === 'production';",
    'if (isProd && !process.env.COND_CONST_KEY) {',
    "  throw new Error('COND_CONST_KEY requis en prod');",
    '}',
    '',
  ].join('\n'),
);

describe('mapEnv — J1-fix2 : gardes this.propriété (repro turnstile/guest-jwt)', () => {
  test("repro turnstile : this.prop = configService.get('X') || '' + garde const isProd → required 'NODE_ENV=production'", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CLASS_PROP_SECRET')).toMatchObject({ kind: 'throw', required: 'NODE_ENV=production' });
  });

  test('liaison this.prop au constructeur, garde dans une MÉTHODE → required true', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'THIS_PROP_URL')).toMatchObject({ kind: 'throw', required: true });
  });

  test('propriété réassignée ailleurs dans la classe → reste direct/unknown', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'REASSIGNED_KEY')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });

  test("configService.get('X') gardé directement par throw → required true", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CS_GUARDED')).toMatchObject({ kind: 'throw', required: true });
  });

  test('const url = configService.get(...) puis garde → required true', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CS_BOUND')).toMatchObject({ kind: 'throw', required: true });
  });

  test("fallback truthy (|| 'défaut') → garde inerte, reste direct/unknown", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'TRUTHY_FALLBACK_KEY')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });

  test("const isProd = NODE_ENV === 'production' dans la conjonction → condition portée", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'COND_CONST_KEY')).toMatchObject({ kind: 'throw', required: 'NODE_ENV=production' });
  });

  test("défaut falsy en 2e argument de .get('X', '') → garde atteignable, required true (repro moteur-immo)", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CS_FALSY_DEFAULT')).toMatchObject({ kind: 'throw', required: true });
  });

  test("défaut TRUTHY en 2e argument de .get('X', 'fallback') → garde inerte, reste nestjs-config/unknown", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CS_TRUTHY_DEFAULT')).toMatchObject({ kind: 'nestjs-config', required: 'unknown' });
  });

  test('garde DIRECTE sur .get avec défaut truthy → également inerte, nestjs-config/unknown', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'CS_TRUTHY_DIRECT')).toMatchObject({ kind: 'nestjs-config', required: 'unknown' });
  });
});

describe('mapEnv — garde composée', () => {
  test("seul l'accès NIÉ est exigé ; la variable seulement comparée reste unknown ; la condition est portée", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'SERVICE_KEY')).toMatchObject({ kind: 'throw', required: 'APP_MODE=production' });
    expect(result.facts.find((f) => f.name === 'APP_MODE')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });
});

describe('mapEnv — J1-fix bug 1 : garde via liaisons intermédiaires (dataflow local const)', () => {
  test('const u = process.env.X; if (!u || !k) throw → les deux exigées (repro supabase.config.ts)', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'BOUND_URL')).toMatchObject({ kind: 'throw', required: true });
    expect(result.facts.find((f) => f.name === 'BOUND_KEY')).toMatchObject({ kind: 'throw', required: true });
  });

  test('même pattern dans une fonction (repro auth.service.ts)', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'FN_BOUND_URL')).toMatchObject({ kind: 'throw', required: true });
  });

  test('liaison testée sans throw → reste direct/unknown', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'UNGUARDED_TOKEN')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });
});

describe('mapEnv — J1-fix bug 2 : condition de garde portée (required ternaire)', () => {
  test("NODE_ENV === 'production' && !X → required 'NODE_ENV=production', jamais true sec (repro main.ts:13)", async () => {
    const result = await mapEnv(root);
    const facts = result.facts.filter((f) => f.name === 'PROD_ONLY_KEY');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: 'throw', required: 'NODE_ENV=production' });
  });

  test('condition portée aussi à travers une liaison intermédiaire', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'COND_BOUND_KEY')).toMatchObject({ kind: 'throw', required: 'NODE_ENV=production' });
  });

  test('conjonction non reconnue → on ne prouve rien, direct/unknown', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'MYSTERY_KEY')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });

  test('if imbriqué reconnu → condition externe portée', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'NESTED_PROD_KEY')).toMatchObject({ kind: 'throw', required: 'NODE_ENV=production' });
  });

  test('throw conditionnel non prouvé DANS la garde → direct/unknown, jamais required=true', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'INNER_KEY')).toMatchObject({ kind: 'direct', required: 'unknown' });
  });
});

describe('mapEnv — bibliothèques de validation', () => {
  test('zod : schéma parsé sur process.env → clés avec required exact (optional/default = false)', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'PORT')).toMatchObject({ kind: 'zod', required: true, file: expect.stringContaining('zod.ts') });
    expect(result.facts.find((f) => f.name === 'REDIS_URL')).toMatchObject({ kind: 'zod', required: true });
    expect(result.facts.find((f) => f.name === 'LOG_LEVEL')).toMatchObject({ kind: 'zod', required: false });
    expect(result.facts.find((f) => f.name === 'NODE_ENV')).toMatchObject({ kind: 'zod', required: false });
  });

  test('@nestjs/config + Joi : validationSchema → clés, required() exact, default = false', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'SUPABASE_URL')).toMatchObject({ kind: 'joi', required: true, line: 5 });
    expect(result.facts.find((f) => f.name === 'CACHE_TTL')).toMatchObject({ kind: 'joi', required: false });
  });

  test("configService.get('X') → kind nestjs-config, required unknown", async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'MOTEUR_IMMO_TOKEN')).toMatchObject({ kind: 'nestjs-config', required: 'unknown' });
  });

  test('envalid : cleanEnv(process.env, {...}) → clés, default = false', async () => {
    const result = await mapEnv(root);
    expect(result.facts.find((f) => f.name === 'SMTP_HOST')).toMatchObject({ kind: 'envalid', required: true });
    expect(result.facts.find((f) => f.name === 'SMTP_PORT')).toMatchObject({ kind: 'envalid', required: false });
  });
});

describe('mapEnv — accès directs', () => {
  test('trouve les lectures process.env.X et process.env["X"] avec file:line', async () => {
    const result = await mapEnv(root);
    const url = result.facts.find((f) => f.name === 'DATABASE_URL');
    expect(url).toMatchObject({ kind: 'direct', required: 'unknown', provenance: 'ast' });
    expect(url?.file.replaceAll('\\', '/')).toBe('src/direct.ts');
    expect(url?.line).toBe(1);
    const secret = result.facts.find((f) => f.name === 'API_SECRET');
    expect(secret).toMatchObject({ kind: 'direct', line: 2 });
  });

  test('un accès gardé par throw devient kind=throw, required=true, une seule fois par variable', async () => {
    const result = await mapEnv(root);
    const jwt = result.facts.filter((f) => f.name === 'JWT_SECRET');
    expect(jwt).toHaveLength(1);
    expect(jwt[0]).toMatchObject({ kind: 'throw', required: true, file: expect.stringContaining('guard.ts') });
  });
});
