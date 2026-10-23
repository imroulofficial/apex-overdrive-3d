// The audio control clock, layer gates and the one-shot voice pool, against a stand-in for
// the Web Audio API (the real graph is exercised by tools/audio/render.mjs --stall / --live).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Gate } from '../src/audio/clock.js';
import { VoicePool, MAX_VOICES, PRIORITY } from '../src/audio/voices.js';
import { EngineDriver, CONTROL_STEP } from '../src/audio/engine.js';

function fakeNode() {
  return {
    links: new Set(),
    gain: { setTargetAtTime() {} },
    connect(d) {
      this.links.add(d);
      return d;
    },
    disconnect(d) {
      if (d) this.links.delete(d);
      else this.links.clear();
    },
  };
}

function fakeMix() {
  const ac = { currentTime: 0, createGain: fakeNode };
  return { ac, sfx: fakeNode(), ui: fakeNode(), space: fakeNode() };
}

test('a gate plugs a layer in while it sounds and unplugs it once the fade is over', () => {
  const node = fakeNode();
  const bus = fakeNode();
  const gate = new Gate([[node, bus]]);
  assert.equal(node.links.size, 0, 'starts unplugged');
  gate.open();
  assert.ok(node.links.has(bus));
  gate.release(1.2);
  gate.poll(1.0);
  assert.ok(node.links.has(bus), 'still fading at 1.0 s');
  gate.poll(1.3);
  assert.equal(node.links.size, 0);
  gate.open(2);
  gate.poll(1.9);
  assert.ok(node.links.has(bus));
  gate.poll(2.1);
  assert.equal(node.links.size, 0);
});

test(`no more than ${MAX_VOICES} one-shots sound at once; the least important gives way`, () => {
  const mix = fakeMix();
  const pool = new VoicePool(mix);
  pool.live = false;
  const shot = (vm) => {
    vm.sfx; // the voice uses its own bus
    vm.voiceEnd = 1;
  };
  for (let i = 0; i < MAX_VOICES; i++) assert.ok(pool.play(PRIORITY.impact, shot, 0));
  assert.equal(pool.active(0), MAX_VOICES);
  // A detail sound loses to six impacts.
  assert.equal(pool.play(PRIORITY.detail, shot, 0.1), false);
  assert.equal(pool.stats.dropped, 1);
  // A key cue replaces the oldest impact.
  assert.ok(pool.play(PRIORITY.key, shot, 0.1));
  assert.equal(pool.stats.stolen, 1);
  assert.equal(pool.active(0.1), MAX_VOICES);
  // Once they end there is room again.
  assert.ok(pool.play(PRIORITY.detail, shot, 1.5));
  assert.equal(pool.active(1.5), 1);
  assert.equal(pool.stats.peak, MAX_VOICES);
});

function fakeVoice() {
  return {
    times: [],
    rpms: [],
    polled: 0,
    mix: null,
    set(s, t) {
      this.times.push(t);
      this.rpms.push(s.rpm);
    },
    poll() {
      this.polled++;
    },
  };
}

test('the engine is laid out on audio time ahead of the playhead, whatever the frame timing', () => {
  const voice = fakeVoice();
  const driver = new EngineDriver(voice, { lookahead: 0.07, onEvents() {} });
  driver.input({ speedNorm: 0, throttle: 1, neutral: true });
  driver.fill(1);
  assert.ok(voice.times.at(-1) >= 1.07 - CONTROL_STEP, 'queued up to the look-ahead');
  // Frames and worker ticks arriving at any rate fill the timeline with even steps.
  for (const now of [1.004, 1.03, 1.031, 1.05, 1.09]) driver.fill(now);
  const gaps = voice.times.slice(1).map((t, i) => t - voice.times[i]);
  for (const g of gaps) assert.ok(Math.abs(g - CONTROL_STEP) < 1e-9);
  // A 60 ms hitch is covered: no step is queued in the past and nothing is skipped.
  const last = voice.times.at(-1);
  driver.fill(1.15);
  assert.ok(Math.abs(voice.times[voice.times.indexOf(last) + 1] - last - CONTROL_STEP) < 1e-9);
  // A stall longer than the look-ahead resumes from the playhead without a catch-up burst.
  const before = voice.times.length;
  driver.fill(2);
  assert.ok(voice.times[before] >= 2);
  assert.ok(voice.times.length - before <= Math.ceil(0.07 / CONTROL_STEP) + 1);
  assert.ok(voice.polled > 0, 'gates are polled every fill');
});

test('a paused race holds the gearbox where it is', () => {
  const voice = fakeVoice();
  const driver = new EngineDriver(voice, { lookahead: 0.05, onEvents() {} });
  driver.input({ speedNorm: 0, throttle: 1, neutral: true });
  for (let t = 0; t < 1; t += 0.02) driver.fill(t);
  const rpm = voice.rpms.at(-1);
  driver.input({ dt: 0, hold: true, throttle: 0, volume: 0 });
  for (let t = 1; t < 2; t += 0.02) driver.fill(t);
  assert.equal(voice.rpms.at(-1), rpm);
});
