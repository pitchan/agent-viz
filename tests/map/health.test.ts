import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapHealth } from '../../src/engine/map/health.js';
import { mapRoutes } from '../../src/engine/map/routes.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-health-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

fixture('src/ok.ts', 'export const fine = 1;\n');
fixture('src/broken.ts', 'const = {{{ pas du typescript ;;; export\n');

describe('mapHealth', () => {
  test('compte les fichiers parsés et liste les échecs de parse avec message — jamais deviné', async () => {
    const health = await mapHealth(root);
    expect(health.filesParsed).toBe(1);
    expect(health.parseFailures).toHaveLength(1);
    expect(health.parseFailures[0]?.file).toContain('broken.ts');
    expect(health.parseFailures[0]?.message.length).toBeGreaterThan(0);
  });

  test('un fichier qui ne parse pas est EXCLU des faits servis (pas de route devinée)', async () => {
    fixture('src/broken-routes.ts', "@Controller('ghost')\nclass X { @Get( } // cassé\n");
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path.includes('ghost'))).toBeUndefined();
    expect(result.failures.some((f) => f.file.includes('broken-routes.ts'))).toBe(true);
  });
});
