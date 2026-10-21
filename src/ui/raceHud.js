import { NITRO } from '../race/vehicle.js';
import { ordinal } from '../race/Race.js';
import { raceSfx, sfx } from '../core/audio.js';
import { describeObjective } from '../data/career.js';

// In-race HUD: standing, lap, timer, progress strip, speedometer, nitro gauge with the
// double-tap sweet-spot ring, drift score with the combo multiplier and link timer, the apex
// "release" hint, callouts, pause menu and the finish screen.

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString('en-US');
const RING_WINDOW = 0.6; // seconds shown on the sweet-spot ring

export function formatTime(t) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function createRaceHud({ onPause, onResume, onRestart, onQuit, onGarage, onRaceAgain, onDoubleCoins }) {
  const root = $('#race-hud');
  const el = {
    pos: $('#rh-pos'),
    suf: $('#rh-pos-suf'),
    total: $('#rh-total'),
    lap: $('#rh-lap'),
    laps: $('#rh-laps'),
    time: $('#rh-time'),
    dots: $('#rh-dots'),
    lapmarks: $('#rh-lapmarks'),
    speed: $('#rh-speed'),
    dial: $('#rh-dial-fill'),
    nitroFill: $('#rh-nitro-fill'),
    nitroBtn: $('#rc-nitro'),
    ring: $('#rc-nitro-ring'),
    sweet: $('#rc-sweet'),
    needle: $('#rc-needle'),
    drift: $('#rh-drift'),
    driftValue: $('#rh-drift b'),
    combo: $('#rh-combo'),
    chain: $('#rh-chain'),
    linkFill: $('#rh-link-fill'),
    surface: $('#rh-surface'),
    wrong: $('#rh-wrong'),
    callouts: $('#rh-callouts'),
    fx: $('#race-fx'),
    countdown: $('#countdown'),
    intro: $('#race-intro'),
    pause: $('#pause'),
    results: $('#results'),
  };
  const last = {};
  let dots = [];

  const sweetStart = (NITRO.sweetMin / RING_WINDOW) * 100;
  const sweetLen = ((NITRO.sweetMax - NITRO.sweetMin) / RING_WINDOW) * 100;
  el.sweet.style.strokeDasharray = `${sweetLen} ${100 - sweetLen}`;
  el.sweet.style.strokeDashoffset = `${-sweetStart}`;

  // Every HUD button gets the high-tech click.
  const button = (sel, fn) => $(sel).addEventListener('click', () => (sfx.tap(), fn()));
  button('#rh-pause', () => onPause());
  button('#pause-resume', () => onResume());
  button('#pause-restart', () => onRestart());
  button('#pause-quit', () => onQuit());
  el.pause.addEventListener('cancel', (e) => {
    e.preventDefault();
    onResume();
  });
  button('#res-garage', () => onGarage());
  button('#res-again', () => onRaceAgain());
  const doubleBtn = $('#res-double');
  button('#res-double', () => onDoubleCoins?.());

  const set = (key, value, fn) => {
    if (last[key] === value) return;
    last[key] = value;
    fn(value);
  };

  function buildDots(racers) {
    el.dots.innerHTML = racers
      .map((r) => `<i class="rh-dot${r.isPlayer ? ' me' : ''}" style="--c:${r.color}"></i>`)
      .join('');
    dots = [...el.dots.children];
  }

  let countdownTimer = 0;
  let introTimer = 0;

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      el.intro.hidden = true;
      el.countdown.hidden = true;
      el.results.hidden = true;
      el.callouts.innerHTML = '';
      if (el.pause.open) el.pause.close();
    },

    intro(def) {
      for (const k of Object.keys(last)) delete last[k];
      dots = [];
      el.results.hidden = true;
      el.callouts.innerHTML = '';
      el.drift.hidden = true;
      el.wrong.hidden = true;
      root.classList.remove('apex-ready');
      el.laps.textContent = def.laps;
      el.lapmarks.innerHTML = Array.from({ length: def.laps - 1 }, (_, i) => `<i style="left:${((i + 1) / def.laps) * 100}%"></i>`).join('');
      $('#ri-biome').textContent = def.biome.toUpperCase();
      $('#ri-name').textContent = def.name.toUpperCase();
      $('#ri-laps').textContent = `${def.laps} LAPS · 6 RACERS`;
      el.intro.hidden = false;
      el.intro.classList.remove('out');
      clearTimeout(introTimer);
      introTimer = setTimeout(() => {
        el.intro.classList.add('out');
        introTimer = setTimeout(() => (el.intro.hidden = true), 500);
      }, 2400);
      root.hidden = false;
      root.classList.add('is-intro');
    },

    countdown(text) {
      root.classList.remove('is-intro');
      el.countdown.hidden = false;
      el.countdown.innerHTML = `<span class="${text === 'GO!' ? 'go' : ''}">${text}</span>`;
      clearTimeout(countdownTimer);
      countdownTimer = setTimeout(() => (el.countdown.hidden = true), 900);
    },

    callout(text, kind = '') {
      const c = document.createElement('div');
      c.className = `rh-callout ${kind}`;
      c.textContent = text;
      el.callouts.appendChild(c);
      while (el.callouts.children.length > 3) el.callouts.firstChild.remove();
      setTimeout(() => c.remove(), 1500);
    },

    // A finished drift or chain; multiplier > 0 when drifts were linked.
    driftBank(value, multiplier = 0) {
      if (multiplier) this.callout(`COMBO x${multiplier.toFixed(1)}  +${fmt(value)}`, `combo${multiplier >= 3 ? ' l3' : ''}`);
      else this.callout(`+${fmt(value)} DRIFT`, 'drift');
    },

    comboUp(multiplier, nitro) {
      el.combo.classList.remove('pop');
      void el.combo.offsetWidth;
      el.combo.classList.add('pop');
      if (nitro) this.callout(`x${multiplier.toFixed(1)} COMBO · +NITRO`, `combo${multiplier >= 3 ? ' l3' : ''}`);
    },

    flash(kind) {
      el.fx.className = 'race-fx';
      void el.fx.offsetWidth;
      el.fx.classList.add(`flash-${kind}`);
    },

    update(s) {
      if (!dots.length) buildDots(s.racers);
      set('speed', s.speed, (v) => {
        el.speed.textContent = v;
        el.dial.style.strokeDashoffset = `${100 - Math.min(100, (v / 330) * 100)}`;
      });
      set('pos', s.position, (v) => {
        el.pos.textContent = v;
        el.suf.textContent = ordinal(v).replace(String(v), '');
        root.dataset.position = v;
      });
      set('total', s.total, (v) => (el.total.textContent = v));
      set('lap', s.lap, (v) => (el.lap.textContent = v));
      set('time', formatTime(s.time), (v) => (el.time.textContent = v));

      const n = Math.round(s.nitro * 100);
      set('nitro', n, (v) => {
        el.nitroFill.style.width = `${v}%`;
        el.ring.style.strokeDashoffset = `${100 - v}`;
        el.nitroBtn.classList.toggle('ready', v >= NITRO.blueCost);
        el.nitroBtn.classList.toggle('pulse-ready', v >= NITRO.blueCost + NITRO.pulseExtra);
      });
      set('tier', s.tier, (v) => {
        root.dataset.boost = v;
      });

      // Sweet-spot ring: after a blue tap, a needle sweeps; tap again inside the arc for Pulse.
      const t = s.sinceTap;
      const showing = t >= 0 && t <= RING_WINDOW;
      set('ring', showing, (v) => el.nitroBtn.classList.toggle('timing', v));
      if (showing) {
        el.needle.style.strokeDashoffset = `${-(t / RING_WINDOW) * 100}`;
        const inside = t >= NITRO.sweetMin && t <= NITRO.sweetMax;
        set('inside', inside, (v) => el.nitroBtn.classList.toggle('sweet', v));
      } else set('inside', false, () => el.nitroBtn.classList.remove('sweet'));

      // Drift panel: live points while sliding; between linked drifts the chain total and a
      // shrinking link timer.
      const linking = !s.drifting && s.linkLeft > 0;
      set('driftShown', (s.drifting && s.driftScore > 0) || linking, (v) => (el.drift.hidden = !v));
      set('linking', linking, (v) => el.drift.classList.toggle('linking', v));
      if (s.drifting) set('driftScore', s.driftScore, (v) => (el.driftValue.textContent = fmt(v)));
      if (linking) el.linkFill.style.transform = `scaleX(${s.linkLeft.toFixed(3)})`;
      set('combo', s.combo, (v) => {
        el.combo.hidden = v <= 1;
        el.combo.textContent = `x${v.toFixed(1)}`;
        el.drift.dataset.level = v >= 3 ? 3 : v >= 2 ? 2 : 1;
      });
      set('chain', s.chainTotal, (v) => {
        el.chain.hidden = !v;
        el.chain.textContent = `CHAIN ${fmt(v)}`;
      });
      set('apex', !!s.apexReady, (v) => root.classList.toggle('apex-ready', v));
      set('surface', s.surface, (v) => {
        el.surface.hidden = !v || v === 'asphalt';
        el.surface.textContent = v === 'grass' ? 'GRASS' : 'GRAVEL';
        el.surface.dataset.surface = v;
      });
      set('wrong', s.wrongWay, (v) => (el.wrong.hidden = !v));

      for (let i = 0; i < dots.length; i++) {
        const left = (s.racers[i].frac * 100).toFixed(1);
        if (dots[i]._left !== left) {
          dots[i]._left = left;
          dots[i].style.left = `${left}%`;
        }
      }
    },

    openPause() {
      if (!el.pause.open) el.pause.showModal();
    },
    closePause() {
      if (el.pause.open) el.pause.close();
    },
    get pauseOpen() {
      return el.pause.open;
    },
    get resultsOpen() {
      return !el.results.hidden;
    },

    // r.best / r.wallet are filled in by the app once the reward is saved.
    results(r) {
      const { best, wallet } = r;
      sfx.tab(); // the results panel swipes in
      $('#res-track').textContent = `${r.trackName.toUpperCase()} · ${ordinal(r.position)} OF ${r.total}`;
      $('#res-title').textContent = r.position === 1 ? 'VICTORY!' : r.position <= 3 ? 'PODIUM FINISH' : 'RACE COMPLETE';
      $('#res-pos').textContent = r.position;
      $('#res-pos-suf').textContent = ordinal(r.position).replace(String(r.position), '');
      $('.res-place span').textContent = `of ${r.total}`;
      $('#res-time').textContent = formatTime(r.time);
      $('#res-lap').textContent = formatTime(r.bestLap);
      $('#res-drift').textContent = fmt(r.driftScore);
      $('#res-smash').textContent = r.smashes;
      $('#res-c-pos').textContent = `+${fmt(r.coins.finish)}`;
      $('#res-c-skill').textContent = `+${fmt(r.coins.skill)}`;
      $('#res-c-star').textContent = `+${fmt(r.coins.star)}`;
      $('#res-best').hidden = !best;
      doubleBtn.hidden = !(r.coins.total > 0);
      this.setDoubleState('ready');
      const total = $('#res-c-total');
      total.textContent = '+0';
      const stars = [...document.querySelectorAll('#res-stars svg')];
      stars.forEach((st, i) => {
        st.classList.remove('on');
        const o = r.objectives?.[i];
        if (o) st.setAttribute('aria-label', `${(r.stars >> i) & 1 ? 'Earned' : 'Not earned'}: ${describeObjective(o)}`);
      });
      el.results.hidden = false;
      el.results.dataset.place = r.position;
      root.classList.add('is-done');
      stars.forEach((st, i) => {
        // r.stars is a bitmask: each star is its own objective (finish, skill, mastery).
        if ((r.stars >> i) & 1) setTimeout(() => {
          st.classList.add('on');
          raceSfx.coin(i * 6);
        }, 450 + i * 260);
      });
      // Count the coins up.
      const start = performance.now() + 500;
      const dur = 900;
      const tick = (nowMs) => {
        const k = Math.min(1, Math.max(0, (nowMs - start) / dur));
        total.textContent = `+${fmt(Math.round(r.coins.total * k))}`;
        if (k < 1) requestAnimationFrame(tick);
        else total.parentElement.dataset.wallet = `Wallet ${fmt(wallet)}`;
      };
      total.parentElement.dataset.wallet = '';
      requestAnimationFrame(tick);
      setTimeout(() => $('#res-garage').focus({ preventScroll: true }), 50);
    },

    // Rewarded "2× coins" button: 'ready' | 'loading' | 'done'.
    setDoubleState(mode, { bonus = 0, wallet = 0 } = {}) {
      doubleBtn.disabled = mode !== 'ready';
      doubleBtn.classList.toggle('is-done', mode === 'done');
      doubleBtn.querySelector('span').textContent =
        mode === 'loading' ? 'Loading ad…' : mode === 'done' ? `Coins doubled · +${fmt(bonus)}` : 'Watch ad · 2× coins';
      if (mode === 'done') {
        const total = $('#res-c-total');
        total.textContent = `+${fmt(bonus * 2)}`;
        total.parentElement.dataset.wallet = `Wallet ${fmt(wallet)}`;
        raceSfx.coin(12);
      }
    },

    hideResults() {
      el.results.hidden = true;
      root.classList.remove('is-done');
    },
  };
}
