// Low-end GPU handling (render/gpuTier.js): which GPUs count as low-end, where Auto starts,
// and that a player's own choice in Settings always wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLowEndGpu, autoStartLevel, raceBloom, rememberAutoLevel, rememberedAutoLevel, bloomChosen, markBloomChosen } from '../src/render/gpuTier.js';
import { DEFAULT_BLOOM } from '../src/data/weather.js';

test('every PowerVR and the listed Mali and Adreno GPUs are low-end', () => {
  for (const name of [
    'PowerVR Rogue GE8320',
    'PowerVR Rogue GE8322',
    'PowerVR Rogue GE8100',
    'PowerVR Rogue GM9446',
    'PowerVR B-Series BXM-8-256',
    'ANGLE (Imagination Technologies, PowerVR Rogue GE8320, OpenGL ES 3.2)',
    'Mali-T720',
    'Mali-T830 MP2',
    'Mali-T860',
    'Mali-G31 MP2',
    'Mali-G51 MP4',
    'Mali-G52 MC2',
    'Mali-G52',
    'Mali-G57 MC2',
    'ANGLE (ARM, Mali-G57 MC1, OpenGL ES 3.2)',
    'Adreno (TM) 306',
    'Adreno (TM) 308',
    'Adreno (TM) 405',
    'Adreno (TM) 430',
    'Adreno (TM) 505',
    'Adreno (TM) 506',
    'Adreno (TM) 510',
    'Adreno (TM) 512',
    'ANGLE (Qualcomm, Adreno (TM) 509, OpenGL ES 3.2)',
  ]) {
    assert.equal(isLowEndGpu(name), true, name);
  }
});

test('newer and desktop GPUs are not low-end', () => {
  for (const name of [
    'Mali-G510 MC2',
    'Mali-G610 MC6',
    'Mali-G68 MC4',
    'Mali-G72 MP3',
    'Mali-G76 MC4',
    'Mali-G77 MC9',
    'Mali-G710 MC10',
    'Immortalis-G715',
    'Adreno (TM) 504',
    'Adreno (TM) 530',
    'Adreno (TM) 610',
    'Adreno (TM) 618',
    'Adreno (TM) 619',
    'Adreno (TM) 650',
    'Adreno (TM) 740',
    'ANGLE (Qualcomm, Adreno (TM) 642L, OpenGL ES 3.2)',
    'Xclipse 920',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple GPU',
  ]) {
    assert.equal(isLowEndGpu(name), false, name);
  }
});

test('no GPU name: unknown, so nothing changes', () => {
  assert.equal(isLowEndGpu(null), null);
  assert.equal(isLowEndGpu(''), null);
  assert.equal(isLowEndGpu(undefined), null);
});

test('Auto starts at its usual level unless the GPU is low-end or it stepped down before', () => {
  assert.equal(autoStartLevel({ start: 'medium' }), 'medium');
  assert.equal(autoStartLevel({ start: 'high' }), 'high');
  assert.equal(autoStartLevel({ start: 'medium', lowEnd: true }), 'low');
  assert.equal(autoStartLevel({ start: 'medium', remembered: 'low' }), 'low');
  assert.equal(autoStartLevel({ start: 'high', remembered: 'medium' }), 'medium');
  // A remembered level never raises the start, and junk is ignored.
  assert.equal(autoStartLevel({ start: 'medium', remembered: 'high' }), 'medium');
  assert.equal(autoStartLevel({ start: 'medium', remembered: 'ultra' }), 'medium');
  assert.equal(autoStartLevel({ start: 'medium', remembered: 'medium', lowEnd: true }), 'low');
});

test('race bloom: off on a low-end GPU only while Auto and the untouched default', () => {
  const base = { bloom: DEFAULT_BLOOM, quality: 'auto', lowEnd: true, chosen: false, defaultBloom: DEFAULT_BLOOM };
  assert.equal(raceBloom(base), 'off');
  // Normal GPU: exactly the setting.
  assert.equal(raceBloom({ ...base, lowEnd: false }), DEFAULT_BLOOM);
  // The player's own choices win.
  assert.equal(raceBloom({ ...base, chosen: true }), DEFAULT_BLOOM);
  assert.equal(raceBloom({ ...base, bloom: 'medium' }), 'medium');
  for (const quality of ['low', 'medium', 'high']) assert.equal(raceBloom({ ...base, quality }), DEFAULT_BLOOM, quality);
});

test('the stepped-down Auto level and the bloom choice live in local storage only', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    assert.equal(rememberedAutoLevel(), null);
    rememberAutoLevel('low');
    assert.equal(rememberedAutoLevel(), 'low');
    rememberAutoLevel('bogus');
    assert.equal(rememberedAutoLevel(), 'low');
    assert.equal(bloomChosen(), false);
    markBloomChosen();
    assert.equal(bloomChosen(), true);
    // Outside the save key.
    for (const k of store.keys()) assert.ok(!k.startsWith('apex-overdrive.save'), k);
  } finally {
    delete globalThis.localStorage;
  }
});

test('storage failures never throw', () => {
  globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  try {
    assert.equal(rememberedAutoLevel(), null);
    rememberAutoLevel('low');
    assert.equal(bloomChosen(), false);
    markBloomChosen();
  } finally {
    delete globalThis.localStorage;
  }
});
