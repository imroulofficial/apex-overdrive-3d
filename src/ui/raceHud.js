import { NITRO } from '../race/vehicle.js';
import { ordinal } from '../race/Race.js';
import { raceSfx, sfx } from '../core/audio.js';
import { describeObjective } from '../data/career.js';
import { objectiveProgress } from '../core/career.js';

// In-race HUD: standing, lap, timer, progress strip, the game mode's panel (Time Trial clock,
// drift target, knock-out timer, boss gap), speedometer, nitro gauge with the double-tap
// sweet-spot ring, drift score with the combo multiplier and link timer, the apex "release"
// hint, callouts, pause menu and the 3-star results screen.

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => n.toLocaleString('en-US');
const RING_WINDOW = 0.6; // seconds shown on the sweet-spot ring

export function formatTime(t) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function createRaceHud({ onPause, onResume, onRestart, onQuit, onGarage, onRaceAgain, onNext, onDoubleCoins }) {
  const root = $('#race-hud');
  const el = {
    pos: $('#rh-pos'),
    suf: $('#rh-pos-suf'),
    total: $('#rh-total'),
    lap: $('#rh-lap'),
    mode: $('#rh-mode'),
    modeLabel: $('#rh-mode-label'),
    modeValue: $('#rh-mode-value'),
    modeSub: $('#rh-mode-sub'),
    modeTag: $('#rh-mode-tag'),
    modeMeter: $('#rh-mode-meter'),
    modeFill: $('#rh-mode-fill'),
    draft: $('#rh-draft'),
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
  button('#res-next', () => onNext?.());
  const doubleBtn = $('#res-double');
  button('#res-double', () => onDoubleCoins?.());

  const set = (key, value, fn) => {
    if (last[key] === value) return;
    last[key] = value;
    fn(value);
  };

  // Objective chips on the intro card and the results rows share the star glyph.
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" /></svg>';
  const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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

    // info: the mode's intro card ({ kicker, title, line, blurb, boss }); course: the stage course;
    // objectives: the stage's three star objectives, earned: stars already held (bitmask).
    intro(info, course, { objectives = [], earned = 0 } = {}) {
      for (const k of Object.keys(last)) delete last[k];
      dots = [];
      el.results.hidden = true;
      el.callouts.innerHTML = '';
      el.drift.hidden = true;
      el.wrong.hidden = true;
      el.mode.hidden = true;
      el.draft.hidden = true;
      root.classList.remove('apex-ready');
      const laps = course.layout === 'circuit' && !course.endless ? course.laps : 1;
      el.lapmarks.innerHTML = Array.from({ length: laps - 1 }, (_, i) => `<i style="left:${((i + 1) / laps) * 100}%"></i>`).join('');
      $('#ri-biome').textContent = info.kicker;
      $('#ri-name').textContent = info.title;
      $('#ri-laps').textContent = info.line;
      $('#ri-objectives').innerHTML = objectives
        .map((o, i) => `<li class="${(earned >> i) & 1 ? 'have' : ''}">${STAR}<span>${escape(describeObjective(o))}</span></li>`)
        .join('');
      el.intro.classList.toggle('boss', !!info.boss);
      root.dataset.mode = info.mode ?? '';
      el.intro.hidden = false;
      el.intro.classList.remove('out');
      clearTimeout(introTimer);
      introTimer = setTimeout(() => {
        el.intro.classList.add('out');
        introTimer = setTimeout(() => (el.intro.hidden = true), 500);
      }, info.boss ? 3000 : 2600);
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
      set('solo', !!s.solo, (v) => root.classList.toggle('is-solo', v));
      set('pos', s.position, (v) => {
        el.pos.textContent = v;
        el.suf.textContent = ordinal(v).replace(String(v), '');
        root.dataset.position = v;
      });
      set('total', s.total, (v) => (el.total.textContent = v));
      set('lap', s.lapText, (v) => (el.lap.textContent = v));
      set('time', formatTime(s.time), (v) => (el.time.textContent = v));
      set('draft', !!s.draft, (v) => (el.draft.hidden = !v));
      this.panel(s.panel);

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
        el.surface.textContent = { grass: 'GRASS', dirt: 'DIRT', wood: 'TIMBER' }[v] ?? 'GRAVEL';
        el.surface.dataset.surface = v;
      });
      set('wrong', s.wrongWay, (v) => (el.wrong.hidden = !v));

      for (let i = 0; i < dots.length; i++) {
        const left = (s.racers[i].frac * 100).toFixed(1);
        if (dots[i]._left !== left) {
          dots[i]._left = left;
          dots[i].style.left = `${left}%`;
        }
        if (dots[i]._out !== s.racers[i].out) {
          dots[i]._out = s.racers[i].out;
          dots[i].classList.toggle('out', !!s.racers[i].out);
        }
      }
    },

    // The game mode's panel: { label, value, sub, state, meter: { fill, marks }, tag, color }.
    panel(p) {
      set('panelOn', !!p, (v) => (el.mode.hidden = !v));
      if (!p) return;
      set('panelLabel', p.label, (v) => (el.modeLabel.textContent = v));
      set('panelValue', p.value, (v) => (el.modeValue.textContent = v));
      set('panelSub', p.sub ?? '', (v) => (el.modeSub.textContent = v));
      set('panelState', p.state ?? '', (v) => (el.mode.dataset.state = v));
      set('panelTag', p.tag ?? '', (v) => {
        el.modeTag.hidden = !v;
        el.modeTag.textContent = v;
      });
      set('panelColor', p.color ?? '', (v) => el.mode.style.setProperty('--accent', v || 'transparent'));
      set('panelMeter', !!p.meter, (v) => (el.modeMeter.hidden = !v));
      if (p.meter) {
        set('panelMarks', p.meter.marks.join(','), () => {
          el.modeMeter.querySelectorAll('.mark').forEach((m) => m.remove());
          for (const at of p.meter.marks) {
            const m = document.createElement('span');
            m.className = 'mark';
            m.style.left = `${(at * 100).toFixed(1)}%`;
            el.modeMeter.appendChild(m);
          }
        });
        set('panelFill', p.meter.fill.toFixed(3), (v) => (el.modeFill.style.transform = `scaleX(${v})`));
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

    // r.view comes from the game mode (title, headline figure, stat rows). r.stars, r.newStars,
    // r.coins, r.best, r.wallet and r.practice are filled in by the app once the run is banked.
    results(r) {
      const { best, wallet, view } = r;
      sfx.tab(); // the results panel swipes in
      const solo = r.total <= 1;
      $('#res-track').textContent = `${r.stageLabel ?? ''}${r.trackName.toUpperCase()}${solo ? '' : ` · ${ordinal(r.position)} OF ${r.total}`}`;
      $('#res-title').textContent = view.title;
      const place = $('.res-place');
      place.classList.toggle('compact', !!view.headline.compact);
      $('#res-pos').textContent = view.headline.value;
      $('#res-pos-suf').textContent = view.headline.suffix;
      $('#res-pos-cap').textContent = view.headline.caption;
      $('#res-stats').innerHTML = view.rows.map(([k, v]) => `<li><span>${escape(k)}</span><b>${escape(v)}</b></li>`).join('');
      $('#res-c-pos').textContent = `+${fmt(r.coins.finish)}`;
      $('#res-c-skill').textContent = `+${fmt(r.coins.skill)}`;
      $('#res-c-star').textContent = `+${fmt(r.coins.star)}`;
      $('#res-best').hidden = !best;
      $('#res-practice').hidden = !r.practice;
      doubleBtn.hidden = !(r.coins.total > 0) || !!r.practice;
      this.setDoubleState('ready');
      const total = $('#res-c-total');
      const starLine = $('#res-c-star');
      total.textContent = '+0';
      starLine.textContent = '+0';

      // The three objectives, each with what this run achieved; earned rows light up in turn
      // with their star, and first-time stars pop a +250 chip that counts into the bonus line.
      const objectives = r.objectives ?? [];
      const list = $('#res-objectives');
      list.innerHTML = objectives
        .map((o, i) => {
          const p = objectiveProgress(o, r);
          const isNew = (r.newStars >> i) & 1;
          const had = !((r.stars >> i) & 1) && (r.stageStars >> i) & 1;
          return `<li data-i="${i}" class="${had ? 'had' : ''}">${STAR}<span class="obj">${escape(p.label)}</span><b>${escape(p.value)}</b>${isNew ? `<em>+${fmt(r.starBonus ?? 0)}</em>` : ''}</li>`;
        })
        .join('');
      const rows = [...list.children];
      const stars = [...document.querySelectorAll('#res-stars svg')];
      stars.forEach((st, i) => {
        st.classList.remove('on', 'new', 'had');
        const o = objectives[i];
        if (o) st.setAttribute('aria-label', `${(r.stars >> i) & 1 ? 'Earned' : 'Not earned'}: ${describeObjective(o)}`);
        // Stars from earlier runs show dimmed so the player sees what is still missing.
        if (!((r.stars >> i) & 1) && (r.stageStars >> i) & 1) st.classList.add('had');
      });
      el.results.hidden = false;
      el.results.dataset.place = view.gold ? 1 : 0;
      root.classList.add('is-done');
      let starBank = 0;
      stars.forEach((st, i) => {
        // r.stars is a bitmask: each star is its own objective (finish, skill, mastery).
        const delay = 450 + i * 320;
        setTimeout(() => rows[i]?.classList.add('checked'), delay - 120);
        if (!((r.stars >> i) & 1)) return;
        setTimeout(() => {
          st.classList.add('on');
          rows[i]?.classList.add('met');
          raceSfx.coin(i * 6);
          if ((r.newStars >> i) & 1) {
            st.classList.add('new');
            rows[i]?.classList.add('new');
            starBank += r.starBonus ?? 0;
            starLine.textContent = `+${fmt(starBank)}`;
            setTimeout(() => raceSfx.coin(i * 6 + 12), 120);
          }
        }, delay);
      });
      // Count the coins up once the stars are in.
      const start = performance.now() + 500 + objectives.length * 320;
      const dur = 900;
      const tick = (nowMs) => {
        const k = Math.min(1, Math.max(0, (nowMs - start) / dur));
        total.textContent = `+${fmt(Math.round(r.coins.total * k))}`;
        if (k < 1) requestAnimationFrame(tick);
        else {
          starLine.textContent = `+${fmt(r.coins.star)}`;
          total.parentElement.dataset.wallet = r.practice ? 'Practice: not banked' : `Wallet ${fmt(wallet)}`;
        }
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

    // "Next stage" on the results card: shown when the stage after this one is open.
    setNext(label) {
      const b = $('#res-next');
      b.hidden = !label;
      if (label) b.textContent = label;
    },

    hideResults() {
      el.results.hidden = true;
      root.classList.remove('is-done');
    },
  };
}
