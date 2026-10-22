// Photographic CC0 environment assets: bundled, credited, and the textured foliage they feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FRONDS, MODELS, TEXTURES } from '../src/render/envAssets.js';
import { fernGeometry, palmGeometry, redwoodGeometry } from '../src/race/foliage.js';

const dir = path.resolve(import.meta.dirname, '../public/assets/env');
const credits = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
const files = [...Object.values(TEXTURES).map(([f]) => f), ...Object.values(MODELS)];

test('every environment asset ships in the app bundle and is credited as CC0', () => {
  assert.match(credits, /CC0 1\.0/);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} is bundled`);
    assert.ok(credits.includes(`\`${f}\``), `${f} is in CREDITS.md`);
  }
});

test('environment assets stay phone-sized', () => {
  let total = 0;
  for (const f of files) {
    const { size } = fs.statSync(path.join(dir, f));
    total += size;
    assert.ok(size < 400 * 1024, `${f} is ${(size / 1024).toFixed(0)} KB`);
  }
  assert.ok(total < 1.5 * 1024 * 1024, `all assets ${(total / 1024).toFixed(0)} KB`);
});

test('frond cut-outs lie inside the atlas, tip above stem', () => {
  for (const [u0, v0, u1, v1] of FRONDS) {
    for (const v of [u0, v0, u1, v1]) assert.ok(v >= 0 && v <= 1);
    assert.ok(u0 < u1 && v0 < v1);
  }
});

test('textured trees are bark + leaves in two groups and stay within the triangle budget', () => {
  for (const [build, maxTris] of [[redwoodGeometry, 520], [palmGeometry, 300]]) {
    const g = build();
    assert.equal(g.groups.length, 2);
    assert.deepEqual([...new Set(g.groups.map((x) => x.materialIndex))], [0, 1]);
    for (const a of ['position', 'normal', 'uv', 'color']) assert.ok(g.attributes[a], a);
    assert.ok(g.attributes.position.count / 3 <= maxTris, `${build.name}: ${g.attributes.position.count / 3} triangles`);
  }
  const fern = fernGeometry();
  assert.ok(fern.attributes.position.count / 3 <= 64);
  assert.ok(fern.attributes.uv && fern.attributes.color);
});
