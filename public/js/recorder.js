// Session recorder.
//
// Records a COMPOSITED, opaque video (whiteboard on top + a strip of
// participant videos underneath) plus a mix of everyone's audio. Compositing
// onto an opaque canvas with a steady frame loop produces a normal .webm that
// plays in any player — unlike capturing a transparent canvas directly, which
// could come out black/broken.
//
// On stop it saves where the user chose: a location on their computer (via the
// native save dialog where supported), or their own server.

const W = 1280;
const H = 720;
const STRIP = 156; // height of the video strip at the bottom

export class Recorder {
  constructor(uploadUrl) {
    this.uploadUrl = uploadUrl || "";
    this.active = false;
    this.rec = null;
    this.chunks = [];
    this.audioCtx = null;
    this._raf = 0;
  }

  get recording() { return this.active; }

  pickMime() {
    const types = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  // opts: { boardCanvas, tiles:()=>[{video,label}], bgColor, audioStreams:[MediaStream] }
  start(opts) {
    if (this.active) return;
    this.active = true;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = opts.bgColor || "#0e1730";

    const frame = () => {
      if (!this.active) return;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Whiteboard (contain) in the upper area.
      const boardArea = H - STRIP;
      const bc = opts.boardCanvas;
      if (bc && bc.width && bc.height) {
        const s = Math.min(W / bc.width, boardArea / bc.height);
        const dw = bc.width * s, dh = bc.height * s;
        try { ctx.drawImage(bc, (W - dw) / 2, (boardArea - dh) / 2, dw, dh); } catch {}
      }

      // Participant strip along the bottom.
      const tiles = (opts.tiles && opts.tiles()) || [];
      const tw = 232, th = STRIP - 16, gap = 8;
      let x = 10; const y = boardArea + 8;
      for (const t of tiles) {
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, tw, th);
        const v = t.video;
        if (v && v.videoWidth) {
          const s = Math.max(tw / v.videoWidth, th / v.videoHeight);
          const dw = v.videoWidth * s, dh = v.videoHeight * s;
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, tw, th); ctx.clip();
          try { ctx.drawImage(v, x + (tw - dw) / 2, y + (th - dh) / 2, dw, dh); } catch {}
          ctx.restore();
        }
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(x, y + th - 20, tw, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "13px system-ui, sans-serif";
        ctx.fillText(String(t.label || "").slice(0, 26), x + 8, y + th - 6);
        x += tw + gap;
        if (x + tw > W) break;
      }
      this._raf = requestAnimationFrame(frame);
    };
    frame();

    const videoStream = canvas.captureStream(25);

    // Mix all audio sources.
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = this.audioCtx.createMediaStreamDestination();
    let hasAudio = false;
    for (const s of opts.audioStreams || []) {
      const a = s && s.getAudioTracks && s.getAudioTracks()[0];
      if (!a) continue;
      try { this.audioCtx.createMediaStreamSource(new MediaStream([a])).connect(dest); hasAudio = true; } catch {}
    }

    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...(hasAudio ? dest.stream.getAudioTracks() : []),
    ]);

    const mimeType = this.pickMime();
    this.rec = new MediaRecorder(combined, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.startedAt = Date.now();
    this.rec.start(1000); // gather data every second
  }

  // MediaRecorder WebM has no Duration/Cues, so players can't seek. Patch the
  // duration in so the file is scrubbable (forward/backward).
  async _fixSeek(blob) {
    try {
      if (!window.ysFixWebmDuration) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/fix-webm-duration@1.0.5/fix-webm-duration.js";
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      if (window.ysFixWebmDuration) {
        const dur = Date.now() - (this.startedAt || Date.now());
        return await window.ysFixWebmDuration(blob, dur, { logger: false });
      }
    } catch (e) { console.warn("duration fix failed", e); }
    return blob;
  }

  // target: "computer" | "server"
  async stop(roomId, target) {
    if (!this.active || !this.rec) return null;
    this.active = false;
    cancelAnimationFrame(this._raf);

    const done = new Promise((res) => (this.rec.onstop = res));
    try { this.rec.requestData(); } catch {}
    this.rec.stop();
    await done;
    try { this.audioCtx && this.audioCtx.close(); } catch {}

    const type = this.rec.mimeType || "video/webm";
    let blob = new Blob(this.chunks, { type });
    blob = await this._fixSeek(blob); // make it seekable
    const filename = `zoomlike-${roomId || "room"}-${stamp()}.webm`;

    if (target === "server" && this.uploadUrl) {
      try {
        const fd = new FormData();
        fd.append("file", blob, filename);
        fd.append("room", roomId || "");
        fd.append("recordedAt", new Date().toISOString());
        const r = await fetch(this.uploadUrl, { method: "POST", body: fd });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { where: "server", filename };
      } catch (err) {
        console.warn("upload failed, saving locally", err);
      }
    }

    // Let the user choose a location where supported.
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "WebM video", accept: { "video/webm": [".webm"] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return { where: "chosen", filename };
      } catch (e) {
        if (e && e.name === "AbortError") return { where: "cancelled", filename };
        // otherwise fall through to a normal download
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return { where: "downloads", filename };
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
