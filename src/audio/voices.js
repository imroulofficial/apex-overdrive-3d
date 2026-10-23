// Concurrent one-shot voices. Every one-shot (an impact, a nitro ignition, a blow-off) builds
// a handful of oscillators, noise sources and filters that the audio thread renders until
// they stop. A pile-up (a cone field on nitro, grinding a wall) used to stack dozens of them
// at once, and a phone's audio thread then runs out of time inside its buffer and underruns:
// the crackle. The pool keeps at most MAX_VOICES one-shots sounding on top of the continuous
// beds (engine, rain, music). A new one replaces the least important, oldest voice, or is
// dropped when everything sounding matters more.

export const MAX_VOICES = 6;

// Priorities: a dropped or cut-short low one is never missed under the rest of the mix.
export const PRIORITY = { detail: 0, impact: 1, cue: 2, key: 3 };

const BUSES = ['sfx', 'ui', 'space', 'ambience'];
// How fast a stolen voice fades out (time constant, seconds).
const STEAL_FADE = 0.012;

export class VoicePool {
  constructor(mix, max = MAX_VOICES) {
    this.mix = mix;
    this.max = max;
    this.voices = [];
    this.live = !(typeof OfflineAudioContext !== 'undefined' && mix.ac instanceof OfflineAudioContext);
    this.stats = { played: 0, stolen: 0, dropped: 0, peak: 0 };
  }

  // Plays fn(voiceMix) as one voice at audio time `at` (default now). voiceMix stands in for
  // the mixer: its buses are the voice's own, so the voice can be faded out as a whole.
  // Returns false when the voice was dropped.
  play(priority, fn, at) {
    const mix = this.mix;
    const t = at ?? mix.ac.currentTime;
    this.voices = this.voices.filter((v) => v.end > t);
    if (this.voices.length >= this.max) {
      let victim = this.voices[0];
      for (const v of this.voices) if (v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      if (victim.priority > priority) {
        this.stats.dropped++;
        return false;
      }
      this.steal(victim, t);
    }
    const vm = voiceMix(mix);
    fn(vm);
    this.voices.push({ priority, start: t, end: Math.max(vm.voiceEnd, t + 0.05), buses: vm.buses });
    this.stats.played++;
    this.stats.peak = Math.max(this.stats.peak, this.voices.length);
    return true;
  }

  // Number of one-shots sounding at audio time t.
  active(t = this.mix.ac.currentTime) {
    return this.voices.filter((v) => v.end > t && v.start <= t).length;
  }

  steal(voice, t) {
    this.stats.stolen++;
    this.voices.splice(this.voices.indexOf(voice), 1);
    for (const g of voice.buses) g.gain.setTargetAtTime(0, t, STEAL_FADE);
    // Unplugged, its nodes stop costing the audio thread anything at once.
    if (this.live) setTimeout(() => voice.buses.forEach((g) => g.disconnect()), (t - this.mix.ac.currentTime + STEAL_FADE * 8) * 1000);
  }
}

// A view of the mixer whose buses are gains owned by one voice (created on first use).
function voiceMix(mix) {
  const vm = Object.create(mix);
  vm.voiceEnd = 0;
  vm.buses = [];
  for (const name of BUSES) {
    if (!mix[name]) continue;
    let g = null;
    Object.defineProperty(vm, name, {
      get() {
        if (!g) {
          g = mix.ac.createGain();
          g.connect(mix[name]);
          vm.buses.push(g);
        }
        return g;
      },
    });
  }
  return vm;
}
