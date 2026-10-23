// The audio control clock. Engine pitch, music notes and ducking are laid out on the audio
// timeline a little ahead of the playhead, in fixed steps of audio time, instead of being set
// "now" from inside the render loop. A frame that stalls for less than the look-ahead leaves
// nothing to catch up, and a long one only holds the last state: the audio thread always has
// the next stretch of automation queued, and no stall turns into a jump in pitch or level.
//
// Web Audio renders on its own thread, but every parameter change comes from JS on the main
// thread, so the timeline is fed from two places: the race frame (input changes reach the
// engine at once) and a metronome in a Web Worker. A worker cannot host Web Audio itself, but
// its timer is independent of requestAnimationFrame (which Android pauses whenever the
// WebView skips a frame), so the schedule keeps rolling through menus, loading and dropped
// frames, and stalls get covered as soon as the main thread is free.

export class AudioClock {
  constructor(ac, { interval = 0.02 } = {}) {
    this.ac = ac;
    this.interval = interval;
    this.clients = new Set();
    this.timer = null;
    this.ticking = false;
  }

  // client.fill(now) queues its automation up to its own look-ahead past `now`.
  add(client) {
    this.clients.add(client);
    this.run();
    return client;
  }

  remove(client) {
    this.clients.delete(client);
    if (!this.clients.size) this.halt();
  }

  tick() {
    if (this.ticking) return;
    this.ticking = true;
    const now = this.ac.currentTime;
    try {
      for (const c of this.clients) c.fill(now);
    } finally {
      this.ticking = false;
    }
  }

  run() {
    if (this.timer || !this.clients.size) return;
    this.timer = metronome(this.interval, () => this.tick());
  }

  halt() {
    this.timer?.stop();
    this.timer = null;
  }
}

// A steady tick from a Web Worker's timer, or a plain interval where workers are unavailable.
const WORKER = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
let workerUrl = null;
function metronome(seconds, fn) {
  const ms = Math.round(seconds * 1000);
  try {
    workerUrl ??= URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const w = new Worker(workerUrl);
    w.onmessage = fn;
    w.postMessage(ms);
    return { stop: () => w.terminate() };
  } catch {
    const id = setInterval(fn, ms);
    return { stop: () => clearInterval(id) };
  }
}

// Keeps a voice unplugged from the graph while it has nothing to play. The audio thread only
// renders what is connected to the speakers, so a silent layer (tyre squeal on a straight,
// the gravel rumble on asphalt, the power-chord guitar outside its sections) costs nothing
// while it is unplugged. open() plugs it in until at least audio time `until`; poll() pulls
// the plug once the playhead is past that.
export class Gate {
  // pairs: [[node, destination], …], left unconnected by the caller.
  constructor(pairs) {
    this.pairs = pairs;
    this.on = false;
    this.until = -Infinity;
  }

  // Plug in until at least audio time `until` (Infinity: until released).
  open(until = Infinity) {
    if (!this.on) {
      for (const [n, d] of this.pairs) n.connect(d);
      this.on = true;
    }
    this.until = Math.max(this.until, until);
  }

  // The voice fades to silence by audio time `after`: unplug it once the playhead is past.
  release(after) {
    this.until = this.until === Infinity ? after : Math.max(this.until, after);
  }

  poll(now) {
    if (!this.on || now <= this.until) return;
    for (const [n, d] of this.pairs) n.disconnect(d);
    this.on = false;
    this.until = -Infinity;
  }
}
