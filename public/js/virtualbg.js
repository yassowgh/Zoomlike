// Virtual camera background using MediaPipe Selfie Segmentation.
//
// Takes the camera track, segments the person from the background each frame,
// and composites either a blurred version of the real background or a
// generated scene behind them. Returns a processed MediaStreamTrack you can
// send over WebRTC in place of the raw camera track.
//
// The library + model load from a CDN on first use; if that fails, start()
// throws and the caller keeps the plain camera.

const LIB = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
const BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";

export class VirtualBg {
  constructor() {
    this.mode = "none";
    this.running = false;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.seg = null;
    this.raf = 0;
    this.scenes = {};
  }

  async ensureLib() {
    if (window.SelfieSegmentation) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LIB; s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = () => rej(new Error("Failed to load segmentation library"));
      document.head.appendChild(s);
    });
    if (!window.SelfieSegmentation) throw new Error("Segmentation library unavailable");
  }

  scene(mode, w, h) {
    if (this.scenes[mode] && this.scenes[mode].width === w) return this.scenes[mode];
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, w, h);
    if (mode === "office") { grad.addColorStop(0, "#dfe7f0"); grad.addColorStop(1, "#9fb0c8"); }
    else if (mode === "beach") { grad.addColorStop(0, "#7ec8e3"); grad.addColorStop(0.6, "#bfe3ef"); grad.addColorStop(0.6, "#f3e2b3"); grad.addColorStop(1, "#e6c98f"); }
    else if (mode === "space") { grad.addColorStop(0, "#05010f"); grad.addColorStop(1, "#1b1b3a"); }
    else { grad.addColorStop(0, "#1a2540"); grad.addColorStop(1, "#0e1730"); }
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    if (mode === "space") {
      g.fillStyle = "#fff";
      for (let i = 0; i < 120; i++) g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
    }
    this.scenes[mode] = c;
    return c;
  }

  // inputTrack: a live camera video track. Returns a processed video track.
  async start(inputTrack, mode) {
    await this.ensureLib();
    this.mode = mode || "blur";

    const settings = inputTrack.getSettings ? inputTrack.getSettings() : {};
    const w = settings.width || 640, h = settings.height || 480;

    this.video = document.createElement("video");
    this.video.autoplay = true; this.video.playsInline = true; this.video.muted = true;
    this.video.srcObject = new MediaStream([inputTrack]);
    await this.video.play().catch(() => {});

    this.canvas = document.createElement("canvas");
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");

    this.seg = new window.SelfieSegmentation({ locateFile: (f) => `${BASE}/${f}` });
    this.seg.setOptions({ modelSelection: 1 });
    this.seg.onResults((r) => this._draw(r));

    this.running = true;
    const pump = async () => {
      if (!this.running) return;
      if (this.video.readyState >= 2) { try { await this.seg.send({ image: this.video }); } catch {} }
      this.raf = requestAnimationFrame(pump);
    };
    pump();

    return this.canvas.captureStream(25).getVideoTracks()[0];
  }

  _draw(results) {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // Person mask.
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);
    // Keep the camera pixels only where the person is.
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(results.image, 0, 0, w, h);
    // Put the background behind.
    ctx.globalCompositeOperation = "destination-over";
    if (this.mode === "blur") {
      ctx.filter = "blur(10px)";
      ctx.drawImage(results.image, 0, 0, w, h);
      ctx.filter = "none";
    } else {
      ctx.drawImage(this.scene(this.mode, w, h), 0, 0, w, h);
    }
    ctx.restore();
  }

  setMode(mode) { this.mode = mode; }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.seg && this.seg.close(); } catch {}
    this.seg = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
  }
}
