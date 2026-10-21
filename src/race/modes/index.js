// The five match types (blueprint §02) as plug-ins for the race host (race/Race.js). The host
// owns the world, cars, laps and the finish line; a mode decides who races, lays out its own
// track furniture, runs its rules each frame, feeds the HUD's mode panel and dresses the result.
//
// Host API a mode may use:
//   race.course, race.track, race.player, race.racers, race.positions (live ranking),
//   race.raceTime, race.driftTotal, race.chain, race.hud, race.modeProps, race.smashes
//   race.endRun({ finished, reason, position })   ends the player's run now
//   race.eliminate(racer)                         knocks a car out (explosion, exit)
//   race.burst(pos, color, n)                     sparks
import { GAME_MODES } from '../../data/career.js';
import { RIVAL_SETS, rivalById } from '../../data/rivals.js';
import { raceSfx } from '../../core/audio.js';
import { ChronoClock, CHRONO, checkpointCount, EliminationTimer, ELIMINATION, pickEliminated } from './rules.js';
import { racingLinePylons } from '../modeProps.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
export function clock(t) {
  if (!Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
const ORD = ['TH', 'ST', 'ND', 'RD'];
const ordinal = (n) => n + (ORD[((n % 100) - 20) % 10] || ORD[n % 100] || ORD[0]);

class Mode {
  constructor(stage, race) {
    this.stage = stage;
    this.race = race;
    this.info = GAME_MODES[stage.gameMode];
    this.set = RIVAL_SETS[stage.rivalSet];
  }

  get id() {
    return this.stage.gameMode;
  }

  get rivals() {
    return this.set.rivals.map(rivalById);
  }

  get difficulty() {
    return this.set.difficulty;
  }

  // Slipstream strength for this match (0 = off).
  get draft() {
    return 1;
  }

  // Grid slot for each car (0 = pole, left). Players start at the back of the pack.
  gridSlot(racer, rivalIndex) {
    return racer.isPlayer ? this.race.racers.length - 1 : rivalIndex;
  }

  // Track furniture: sprints get a start and a finish arch.
  layout() {
    const { course, modeProps } = this.race;
    const gates = [];
    if (course.layout === 'sprint') {
      gates.push({ s: course.startS, kind: 'start' });
      if (course.finishS !== null) gates.push({ s: course.finishS, kind: 'finish' });
    }
    modeProps.setGates(gates);
    modeProps.setPylons([]);
  }

  // Called after every (re)start, once the cars are on the grid.
  start() {}

  // Every frame while racing.
  update() {}

  // Mode panel under the standing box, or null to hide it.
  panel() {
    return null;
  }

  // Race intro card.
  intro() {
    const c = this.race.course;
    const n = this.race.racers.length;
    const length = c.layout === 'circuit' ? `${c.laps} LAP${c.laps > 1 ? 'S' : ''}` : 'SPRINT';
    return {
      kicker: `STAGE ${chapterTag(this.stage)} · ${this.info.name.toUpperCase()}`,
      title: c.name.toUpperCase(),
      line: `${length} · ${n} RACERS`,
      blurb: this.info.blurb,
      mode: this.id,
    };
  }

  // Adjusts the raw run result before stars are judged (Time Trial swaps in the clock).
  finalize() {}

  // Results card: title, the big headline figure and the stat rows.
  view(r) {
    return {
      title: r.position === 1 ? 'VICTORY!' : r.position <= 3 ? 'PODIUM FINISH' : 'RACE COMPLETE',
      headline: { value: r.position, suffix: ordinal(r.position).replace(String(r.position), ''), caption: `of ${r.total}` },
      rows: [
        ['Race time', clock(r.time)],
        [this.race.course.layout === 'circuit' ? 'Best lap' : 'Top speed', this.race.course.layout === 'circuit' ? clock(r.bestLap) : `${r.topSpeed} km/h`],
        ['Drift score', fmt(r.driftScore)],
        ['Props smashed', String(r.smashes)],
      ],
      gold: r.position === 1,
    };
  }

  finishCallout(r) {
    return r.position === 1 ? 'VICTORY!' : `FINISHED ${ordinal(r.position)}`;
  }
}

const chapterTag = (stage) => `${stage.stageId.slice(0, 2).toUpperCase()}-${String(stage.chapterStage).padStart(2, '0')}`;

// ---- Mode 1 · Classic Expedition: pack race against five rivals, first past the line wins.
class Classic extends Mode {}

// ---- Mode 2 · Time Trial (Chrono Run) ----
class TimeTrial extends Mode {
  get draft() {
    return 0;
  }

  gridSlot() {
    return -1; // alone, on the centre line
  }

  // The star-1 target, which the whole-run clock budget is built from.
  get target() {
    const times = this.stage.objectives.filter((o) => o.type === 'time').map((o) => o.seconds);
    return times.length ? Math.max(...times) : this.race.course.distance / 40;
  }

  layout() {
    const { course, modeProps, track } = this.race;
    const n = checkpointCount(course.distance);
    this.gateDist = Array.from({ length: n }, (_, i) => (course.distance * (i + 1)) / (n + 1));
    const gates = this.gateDist.map((d) => ({ s: course.startS + d, kind: 'checkpoint' }));
    if (course.layout === 'sprint') gates.push({ s: course.startS, kind: 'start' }, { s: course.finishS, kind: 'finish' });
    modeProps.setGates(gates);
    // One lap's worth of pylons; they respawn each lap on longer runs.
    modeProps.setPylons(
      racingLinePylons(track, {
        startS: course.startS,
        distance: Math.min(course.distance, track.length),
        spacing: CHRONO.pylonSpacing,
        avoid: gates.map((g) => g.s),
      })
    );
  }

  start() {
    this.clock = new ChronoClock({ budget: this.target * CHRONO.slack, checkpoints: this.gateDist.length });
    this.nextGate = 0;
    this.lap = 0;
    this.warned = false;
    this.lastBeep = null;
    this.race.modeProps.resetPylons();
  }

  update(dt) {
    const race = this.race;
    const c = this.clock;
    const p = race.player;
    c.tick(dt);
    // Pylons on the racing line: -1.0 s each.
    const hit = race.modeProps.collidePylon(p.vehicle);
    if (hit) {
      c.pylon();
      race.smashes += 1;
      raceSfx.pylon();
      race.burst(hit.pos, race.modeProps.pylonColor, 24);
      race.hud.callout(`-${CHRONO.pylonBonus.toFixed(1)}s`, 'pylon');
    }
    const lap = Math.max(0, Math.floor(p.dist / race.track.length));
    if (lap > this.lap) {
      this.lap = lap;
      for (const pl of race.modeProps.pylons) pl.taken = false;
    }
    // Checkpoint gates.
    while (this.nextGate < this.gateDist.length && p.dist >= this.gateDist[this.nextGate]) {
      const added = c.checkpoint();
      race.modeProps.passGate(this.nextGate);
      this.nextGate += 1;
      this.warned = false;
      raceSfx.checkpoint();
      race.hud.callout(`CHECKPOINT +${added.toFixed(1)}s`, 'checkpoint');
    }
    const left = c.remaining;
    if (left <= CHRONO.warnAt && !this.warned) {
      this.warned = true;
      race.hud.callout('HURRY!', 'warn');
    }
    if (left <= 5) {
      const sec = Math.ceil(left);
      if (sec !== this.lastBeep && sec > 0) {
        this.lastBeep = sec;
        raceSfx.tick();
      }
    }
    if (c.expired) race.endRun({ finished: false, reason: 'timeout' });
  }

  panel() {
    const c = this.clock;
    if (!c) return null;
    const left = c.remaining;
    return {
      label: 'TIME LEFT',
      value: clock(left),
      sub: `CHECKPOINT ${this.nextGate}/${this.gateDist.length} · PYLONS ${c.pylons}`,
      state: left <= CHRONO.warnAt ? 'danger' : '',
    };
  }

  intro() {
    const base = super.intro();
    const c = this.race.course;
    return { ...base, line: `${c.layout === 'circuit' ? `${c.laps} LAP${c.laps > 1 ? 'S' : ''}` : 'SPRINT'} · SOLO · ${checkpointCount(c.distance)} CHECKPOINTS` };
  }

  finalize(r) {
    this.clock.stop();
    r.clockTime = r.time;
    r.time = Math.round(this.clock.time * 100) / 100;
    r.pylons = this.clock.pylons;
    r.timeBonus = this.clock.bonus;
  }

  view(r) {
    return {
      title: r.reason === 'timeout' ? 'TIME UP' : r.time < this.target ? 'TARGET BEATEN' : 'RUN COMPLETE',
      headline: { value: r.reason === 'timeout' ? '--' : clock(r.time), suffix: '', caption: r.reason === 'timeout' ? 'out of time' : 'run time', compact: true },
      rows: [
        ['Clock time', clock(r.clockTime)],
        ['Pylons smashed', `${r.pylons} · -${r.timeBonus.toFixed(1)}s`],
        ['Drift score', fmt(r.driftScore)],
        ['Props smashed', String(r.smashes)],
      ],
      gold: r.reason !== 'timeout' && r.time < this.target,
    };
  }

  finishCallout(r) {
    return r.reason === 'timeout' ? 'TIME UP' : 'CHECKERED!';
  }
}

// ---- Mode 3 · Drift Touge Challenge: score attack, proximity bonus along the rails ----
class DriftTouge extends Mode {
  get draft() {
    return 0;
  }

  gridSlot() {
    return -1;
  }

  get targets() {
    const pts = this.stage.objectives.filter((o) => o.type === 'driftScore').map((o) => o.points);
    return pts.length ? pts.sort((a, b) => a - b) : [3000];
  }

  start() {
    this.race.player.vehicle.proximity = true;
    this.reached = 0;
    this.railCool = 0;
  }

  score() {
    const r = this.race;
    const v = r.player.vehicle;
    return r.driftTotal + r.chain.total + (v.drifting ? v.driftScore * r.chain.multiplier : 0);
  }

  update(dt) {
    const race = this.race;
    const v = race.player.vehicle;
    this.railCool = Math.max(0, this.railCool - dt);
    if (v.drifting && v.nearRail > 0.5 && this.railCool === 0) {
      this.railCool = 2.2;
      race.hud.callout('RAIL KISS · x2', 'proximity');
    }
    // Banked score crossing the stage thresholds.
    const banked = race.driftTotal + race.chain.total;
    const t = this.targets;
    while (this.reached < t.length && banked >= t[this.reached]) {
      this.reached += 1;
      raceSfx.checkpoint();
      race.hud.callout(this.reached === t.length ? 'GOLD SCORE!' : 'TARGET SCORE!', 'checkpoint');
    }
  }

  panel() {
    const t = this.targets;
    const score = this.score();
    const top = t[t.length - 1];
    const v = this.race.player.vehicle;
    return {
      label: 'DRIFT SCORE',
      value: fmt(score),
      sub: score >= t[0] ? (score >= top ? 'GOLD SCORE' : `GOLD ${fmt(top)}`) : `TARGET ${fmt(t[0])}`,
      state: score >= t[0] ? 'good' : '',
      meter: { fill: Math.min(1, score / top), marks: t.map((x) => x / top) },
      tag: v.drifting && v.nearRail > 0 ? 'PROXIMITY' : '',
    };
  }

  intro() {
    const base = super.intro();
    return { ...base, line: `SOLO · TARGET ${fmt(this.targets[0])} PTS` };
  }

  finalize(r) {
    r.proximity = Math.round(this.race.player.vehicle.proximityScore);
  }

  view(r) {
    const t = this.targets;
    return {
      title: r.driftScore >= t[t.length - 1] ? 'DRIFT KING' : r.driftScore >= t[0] ? 'TARGET SMASHED' : 'TARGET MISSED',
      headline: { value: fmt(r.driftScore), suffix: '', caption: 'drift points', compact: true },
      rows: [
        ['Target score', fmt(t[0])],
        ['Proximity bonus', `+${fmt(r.proximity)}`],
        ['Best combo', `x${r.bestCombo.toFixed(1)}`],
        ['Drift distance', `${r.driftDistance} m`],
      ],
      gold: r.driftScore >= t[0],
    };
  }

  finishCallout(r) {
    return r.driftScore >= this.targets[0] ? 'TARGET SMASHED!' : 'FINISH';
  }
}

// ---- Mode 4 · Elimination Knock-Out: last place is out every 20 seconds ----
class Elimination extends Mode {
  start() {
    this.timer = new EliminationTimer(ELIMINATION.interval);
    this.lastBeep = null;
  }

  update(dt) {
    const race = this.race;
    const sec = this.timer.secondsLeft;
    if (sec <= ELIMINATION.warnAt && sec !== this.lastBeep && sec > 0) {
      this.lastBeep = sec;
      raceSfx.tick();
    }
    if (!this.timer.tick(dt)) return;
    this.lastBeep = null;
    const out = pickEliminated(race.positions.filter((r) => !r.out));
    if (out) race.eliminate(out);
  }

  panel() {
    if (!this.timer) return null;
    const race = this.race;
    const alive = race.positions.filter((r) => !r.out);
    const last = alive[alive.length - 1] === race.player;
    const left = Math.max(0, this.timer.left);
    return {
      label: `KNOCK-OUT · ROUND ${this.timer.round}`,
      value: `0:${left.toFixed(1).padStart(4, '0')}`,
      sub: last ? 'YOU ARE LAST!' : `${alive.length} LEFT`,
      state: last ? 'danger' : left <= ELIMINATION.warnAt ? 'warn' : '',
      meter: { fill: left / ELIMINATION.interval, marks: [] },
    };
  }

  intro() {
    const base = super.intro();
    return { ...base, line: `${this.race.racers.length} RACERS · LAST PLACE OUT EVERY ${ELIMINATION.interval}s` };
  }

  view(r) {
    const champ = r.position === 1;
    return {
      ...super.view(r),
      title: champ ? 'CHAMPION!' : `ELIMINATED · ${ordinal(r.position)}`,
      rows: [
        ['Survived', clock(r.time)],
        ['Rivals outlasted', String(r.total - r.position)],
        ['Drift score', fmt(r.driftScore)],
        ['Props smashed', String(r.smashes)],
      ],
    };
  }

  finishCallout(r) {
    return r.position === 1 ? 'CHAMPION!' : 'ELIMINATED';
  }
}

// ---- Mode 5 · Boss Duel: 1v1 against the region's champion ----
class BossDuel extends Mode {
  get draft() {
    return 2.2; // heavy draft: tucking in behind is how you pass (and how the boss passes you)
  }

  get boss() {
    return this.rivals[0];
  }

  gridSlot(racer) {
    return racer.isPlayer ? 1 : 0; // side by side on the front row
  }

  panel() {
    const race = this.race;
    const bossRacer = race.racers.find((r) => !r.isPlayer);
    if (!bossRacer) return null;
    const gapM = race.player.dist - bossRacer.dist;
    const speed = Math.max(15, race.player.vehicle.speed);
    const gap = Math.min(99.9, Math.abs(gapM) / speed);
    const ahead = gapM >= 0;
    return {
      label: `VS ${this.boss.name.toUpperCase()}`,
      value: `${ahead ? '+' : '-'}${gap.toFixed(1)}s`,
      sub: ahead ? 'YOU LEAD' : `${this.boss.title.toUpperCase()} LEADS`,
      state: ahead ? 'good' : 'danger',
      color: this.boss.color,
    };
  }

  intro() {
    const base = super.intro();
    const c = this.race.course;
    return {
      ...base,
      kicker: `STAGE ${chapterTag(this.stage)} · BOSS DUEL`,
      title: this.boss.name.toUpperCase(),
      line: `${this.boss.title.toUpperCase()} · 1V1 · ${c.layout === 'circuit' ? `${c.laps} LAPS` : 'SPRINT'} · ${c.name.toUpperCase()}`,
      boss: true,
    };
  }

  view(r) {
    const win = r.position === 1;
    return {
      ...super.view(r),
      title: win ? 'BOSS DEFEATED!' : `${this.boss.name.toUpperCase()} WINS`,
    };
  }

  finishCallout(r) {
    return r.position === 1 ? 'BOSS DEFEATED!' : 'DEFEATED';
  }
}

const MODES = { Classic, TimeTrial, DriftTouge, Elimination, BossDuel };

export function createMode(stage, race) {
  const M = MODES[stage.gameMode];
  if (!M) throw new Error(`unknown game mode ${stage.gameMode}`);
  return new M(stage, race);
}
