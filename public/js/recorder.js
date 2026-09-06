// Session recorder.
//
// Records the whiteboard canvas as video plus a mix of all audio tracks
// (your mic + every remote participant). On stop it uploads the .webm to your
// own server (RECORDING_UPLOAD_URL from /api/config); if none is set, it falls
// back to a local download.

export class Recorder {
  constructor(uploadUrl) {
    this.uploadUrl = uploadUrl || "";
    this.rec = null;
    this.chunks = [];
    this.audioCtx = null;
    this.dest = null;
    this.active = false;
  }

  get recording() { return this.active; }

  pickMime() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }

  // audioStreams: array of MediaStream that may contain audio tracks.
  start(canvas, audioStreams) {
    if (this.active) return;
    const video = canvas.captureStream(20); // 20 fps is plenty for a whiteboard

    // Mix audio from all sources into one track.
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.dest = this.audioCtx.createMediaStreamDestination();
    let hasAudio = false;
    for (const s of audioStreams) {
      if (!s) continue;
      const tracks = s.getAudioTracks();
      if (!tracks.length) continue;
      try {
        this.audioCtx.createMediaStreamSource(new MediaStream([tracks[0]])).connect(this.dest);
        hasAudio = true;
      } catch {}
    }

    const combined = new MediaStream([
      ...video.getVideoTracks(),
      ...(hasAudio ? this.dest.stream.getAudioTracks() : []),
    ]);

    const mimeType = this.pickMime();
    this.rec = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.active = true;
  }

  async stop(roomId) {
    if (!this.active || !this.rec) return null;
    this.active = false;
    const done = new Promise((res) => (this.rec.onstop = res));
    this.rec.stop();
    await done;
    try { this.audioCtx && this.audioCtx.close(); } catch {}

    const blob = new Blob(this.chunks, { type: this.rec.mimeType || "video/webm" });
    const filename = `zoomlike-${roomId || "room"}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;

    if (this.uploadUrl) {
      try {
        const fd = new FormData();
        fd.append("file", blob, filename);
        fd.append("room", roomId || "");
        fd.append("recordedAt", new Date().toISOString());
        const r = await fetch(this.uploadUrl, { method: "POST", body: fd });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { uploaded: true, filename };
      } catch (err) {
        console.warn("upload failed, downloading instead", err);
      }
    }

    // Fallback: download to the local machine.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { uploaded: false, filename };
  }
}
