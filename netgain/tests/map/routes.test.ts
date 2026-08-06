import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapRoutes } from '../../src/map/routes.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-routes-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

fixture(
  'backend/users.controller.ts',
  [
    "import { Controller, Get, Post, UseGuards } from '@nestjs/common';",
    "import { AuthGuard } from './auth.guard';",
    "import { RolesGuard } from './roles.guard';",
    '',
    "@Controller('users')",
    '@UseGuards(AuthGuard)',
    'export class UsersController {',
    '  @Get()',
    '  findAll() { return []; }',
    '',
    "  @Get(':id')",
    '  findOne() { return null; }',
    '',
    '  @Post()',
    '  @UseGuards(RolesGuard)',
    '  create() { return null; }',
    '}',
    '',
  ].join('\n'),
);

fixture(
  'backend/health.controller.ts',
  [
    "import { Controller, Get } from '@nestjs/common';",
    '',
    '@Controller()',
    'export class HealthController {',
    "  @Get('health')",
    '  health() { return "ok"; }',
    '}',
    '',
  ].join('\n'),
);

fixture(
  'server/app.ts',
  [
    "import express from 'express';",
    "import { userRouter } from './users';",
    'const app = express();',
    "app.get('/ping', (_req, res) => res.send('pong'));",
    "app.use('/api/users', userRouter);",
    'export default app;',
    '',
  ].join('\n'),
);

fixture(
  'server/users.ts',
  [
    "import { Router } from 'express';",
    'export const userRouter = Router();',
    "userRouter.get('/', () => []);",
    "userRouter.post('/:id/ban', () => null);",
    '',
  ].join('\n'),
);

fixture(
  'server/inline.ts',
  [
    "import express from 'express';",
    'const app = express();',
    'const itemsRouter = express.Router();',
    "itemsRouter.get('/:id', () => null);",
    "app.use('/api/items', itemsRouter);",
    '',
  ].join('\n'),
);

fixture(
  'front/app.routes.ts',
  [
    "import { Routes } from '@angular/router';",
    "import { HomeComponent } from './home.component';",
    "import { DvfComponent } from './dvf.component';",
    "import { AdminUsersComponent } from './admin-users.component';",
    "import { authGuard, adminGuard } from './guards';",
    '',
    'export const routes: Routes = [',
    "  { path: '', component: HomeComponent },",
    "  { path: 'dvf', component: DvfComponent, canActivate: [authGuard] },",
    '  {',
    "    path: 'admin',",
    '    canActivate: [authGuard, adminGuard],',
    '    children: [',
    "      { path: 'users', component: AdminUsersComponent },",
    '    ],',
    '  },',
    "  { path: 'stats', loadComponent: () => import('./stats.component').then((m) => m.StatsComponent) },",
    '];',
    '',
  ].join('\n'),
);

fixture(
  'front/flagged.routes.ts',
  [
    "import { Routes } from '@angular/router';",
    "import { environment } from './environment';",
    '',
    'export const flaggedRoutes: Routes = environment.features.beta',
    '  ? [',
    "      { path: 'beta', loadChildren: () => import('./beta/routes').then((m) => m.BETA_ROUTES) },",
    '    ]',
    '  : [];',
    '',
  ].join('\n'),
);

describe('mapRoutes — Angular, routes conditionnelles (feature flag)', () => {
  test('un array derrière un ternaire est extrait ET marqué conditional — jamais ignoré en silence', async () => {
    const result = await mapRoutes(root);
    const beta = result.routes.find((r) => r.framework === 'angular' && r.path === '/beta');
    expect(beta).toMatchObject({ target: 'lazy', conditional: true });
  });

  test('les routes inconditionnelles ne portent PAS le marqueur', async () => {
    const result = await mapRoutes(root);
    const dvf = result.routes.find((r) => r.framework === 'angular' && r.path === '/dvf');
    expect(dvf?.conditional).toBeUndefined();
  });
});

describe('mapRoutes — Angular', () => {
  test('array typé Routes → chemins avec method null et cible', async () => {
    const result = await mapRoutes(root);
    const ng = result.routes.filter((r) => r.framework === 'angular');
    expect(ng.find((r) => r.path === '/')).toMatchObject({ method: null, target: 'HomeComponent', file: expect.stringContaining('app.routes.ts') });
    expect(ng.find((r) => r.path === '/dvf')).toMatchObject({ target: 'DvfComponent' });
    expect(ng.find((r) => r.path === '/stats')).toMatchObject({ target: 'lazy' });
  });

  test('children imbriqués : chemin joint et guards du parent cumulés', async () => {
    const result = await mapRoutes(root);
    const users = result.routes.find((r) => r.framework === 'angular' && r.path === '/admin/users');
    expect(users).toMatchObject({ target: 'AdminUsersComponent', guards: ['authGuard', 'adminGuard'], line: 14 });
    const dvf = result.routes.find((r) => r.framework === 'angular' && r.path === '/dvf');
    expect(dvf?.guards).toEqual(['authGuard']);
  });
});

describe('mapRoutes — Express', () => {
  test('app.METHOD direct → chemin tel quel', async () => {
    const result = await mapRoutes(root);
    const ping = result.routes.find((r) => r.framework === 'express' && r.path === '/ping');
    expect(ping).toMatchObject({ method: 'GET', mountedAt: null, file: expect.stringContaining('app.ts'), line: 4 });
  });

  test('router monté dans le MÊME fichier → chemin complet exact', async () => {
    const result = await mapRoutes(root);
    const item = result.routes.find((r) => r.framework === 'express' && r.path === '/api/items/:id');
    expect(item).toMatchObject({ method: 'GET', mountedAt: '/api/items' });
  });

  test('router monté ailleurs → mountedAt unknown, chemin local, jamais inventé', async () => {
    const result = await mapRoutes(root);
    const ban = result.routes.find((r) => r.framework === 'express' && r.method === 'POST' && r.path === '/:id/ban');
    expect(ban).toMatchObject({ mountedAt: 'unknown', file: expect.stringContaining('users.ts') });
  });
});

describe('mapRoutes — NestJS', () => {
  test('joint le préfixe @Controller au chemin de méthode, avec file:line', async () => {
    const result = await mapRoutes(root);
    const nest = result.routes.filter((r) => r.framework === 'nestjs');
    const paths = nest.map((r) => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual(['GET /health', 'GET /users', 'GET /users/:id', 'POST /users']);
    const findOne = nest.find((r) => r.path === '/users/:id');
    expect(findOne).toMatchObject({ method: 'GET', provenance: 'ast', file: expect.stringContaining('users.controller.ts'), line: 11 });
  });

  test('cumule les guards de classe et de méthode', async () => {
    const result = await mapRoutes(root);
    const create = result.routes.find((r) => r.method === 'POST' && r.path === '/users');
    expect(create?.guards).toEqual(['AuthGuard', 'RolesGuard']);
    const findAll = result.routes.find((r) => r.method === 'GET' && r.path === '/users');
    expect(findAll?.guards).toEqual(['AuthGuard']);
  });
});
