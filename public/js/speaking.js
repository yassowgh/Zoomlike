// Active-speaker detection.
//
// One WebAudio analyser per participant stream. We sample the waveform a few
// times a second, take its RMS, and call whoever is loudest (and above a floor)
// the active speaker. Analysers are never connected to the destination, so this
// only observes — it does not add a second copy of anyone's audio.
//
// Two values come out of it:
//   active — loudest right now, including you. Drives the tile highlight.
//   remote — the last non-you speaker. Drives the big speaker-view tile, so
//            your own face doesn't take the stage every time you talk.

const SAMPLE_MS = 120;      // how often we look
const FLOOR = 0.018;        // RMS below this is silence, not speech
const ATTACK_MS = 250;      // must stay loudest this long before we switch
const HOLD_MS = 1400;       // and we keep them for this long afterwards

export class SpeakerDetector {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.ctx = null;
    this.nodes = new Map();   // id -> { analyser, source, buf, stream }
    this.active = null;
    this.remote = null;
    this.selfId = "self";
    this._candidate = null;
    this._candidateAt = 0;
    this._changedAt = 0;
    this._timer = 0;
  }

  setSelfId(id) { if (id) this.selfId = id; }

  add(id, stream) {
    if (!stream || !stream.getAudioTracks().length) return;
    const existing = this.nodes.get(id);
    if (existing && existing.stream === stream) return;
    if (existing) this.remove(id);

    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser); // deliberately not connected onwards
      this.nodes.set(id, { analyser, source, buf: new Uint8Array(analyser.fftSize), stream });
      this.start();
    } catch (err) {
      // An unsupported browser just means no highlight; everything else works.
      console.warn("speaker detection unavailable", err);
    }
  }

  remove(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    try { n.source.disconnect(); n.analyser.disconnect(); } catch {}
    this.nodes.delete(id);
    if (this.active === id) this.active = null;
    if (this.remote === id) this.remote = null;
  }

  start() {
    if (this._timer || !this.ctx) return;
    // Browsers hand back a suspended context when there was no gesture yet.
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    this._timer = setInterval(() => this._tick(), SAMPLE_MS);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = 0;
    for (const id of [...this.nodes.keys()]) this.remove(id);
    try { this.ctx && this.ctx.close(); } catch {}
    this.ctx = null;
  }

  _level(node) {
    node.analyser.getByteTimeDomainData(node.buf);
    let sum = 0;
    for (let i = 0; i < node.buf.length; i++) {
      const v = (node.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / node.buf.length);
  }

  _tick() {
    let loudest = null;
    let best = FLOOR;
    for (const [id, node] of this.nodes) {
      const level = this._level(node);
      if (level > best) { best = level; loudest = id; }
    }

    const now = Date.now();

    // Silence carries no information about who is speaking. Speech is full of
    // gaps between words, so treating a quiet moment as a candidate change
    // would restart the attack timer constantly and nobody would ever win.
    // Leaving `active` alone also keeps the last speaker highlighted through
    // their own pauses, which is what people expect.
    if (!loudest) return;
    if (loudest === this.active) { this._candidate = loudest; this._candidateAt = now; return; }

    // A different person has to hold the lead briefly before we switch, and we
    // won't dethrone the current speaker until their hold window has passed.
    if (loudest !== this._candidate) { this._candidate = loudest; this._candidateAt = now; return; }
    if (now - this._candidateAt < ATTACK_MS) return;
    if (this.active && now - this._changedAt < HOLD_MS) return;

    this.active = loudest;
    this._changedAt = now;
    if (loudest !== this.selfId && loudest !== "self") this.remote = loudest;
    this.onChange(this.active, this.remote);
  }
}
