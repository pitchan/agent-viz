'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProjectRoot } = require('../../lib/install-hooks');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('findProjectRoot: home dir with .git is NOT recognized as a project', () => {
  const fakeHome = makeTempDir('avtest-home-');
  fs.mkdirSync(path.join(fakeHome, '.git'));
  const result = findProjectRoot(fakeHome, { homedir: fakeHome });
  assert.equal(result, null, 'home dir must not be returned as projectRoot');
});

test('findProjectRoot: packageRoot with .git is NOT recognized as a project', () => {
  const pkgRoot = makeTempDir('avtest-pkg-');
  fs.mkdirSync(path.join(pkgRoot, '.git'));
  const elsewhereHome = makeTempDir('avtest-otherhome-');
  const result = findProjectRoot(pkgRoot, { packageRoot: pkgRoot, homedir: elsewhereHome });
  assert.equal(result, null, 'packageRoot must not be returned as projectRoot');
});

test('findProjectRoot: nested cwd inside a real project still finds the project root', () => {
  const projectRoot = makeTempDir('avtest-proj-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const child = path.join(projectRoot, 'src');
  fs.mkdirSync(child);
  const elsewhereHome = makeTempDir('avtest-otherhome2-');
  const result = findProjectRoot(child, { homedir: elsewhereHome });
  assert.equal(result, projectRoot);
});
