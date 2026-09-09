// Camera / microphone / speaker selection.
//
// Browsers only reveal device labels once the page has been granted media
// permission, so enumeration is always done after getUserMedia has succeeded.
// The list changes while a meeting is running — someone plugs in a headset —
// so we listen for `devicechange` and tell the caller.

export const DEVICE_KEYS = { audioinput: "zl_mic", videoinput: "zl_cam", audiooutput: "zl_spk" };

export async function listDevices() {
  const out = { audioinput: [], videoinput: [], audiooutput: [] };
  if (!navigator.mediaDevices?.enumerateDevices) return out;
  try {
    for (const d of await navigator.mediaDevices.enumerateDevices()) {
      if (!out[d.kind]) continue;
      out[d.kind].push({
        deviceId: d.deviceId,
        // Fall back to a positional name when a label is not available.
        label: d.label || `${labelFor(d.kind)} ${out[d.kind].length + 1}`,
      });
    }
  } catch (err) {
    console.warn("could not list devices", err);
  }
  return out;
}

function labelFor(kind) {
  return kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Speaker";
}

// Remember a choice so the next meeting starts on the same hardware.
export function remember(kind, deviceId) {
  try { deviceId ? localStorage.setItem(DEVICE_KEYS[kind], deviceId) : localStorage.removeItem(DEVICE_KEYS[kind]); } catch {}
}
export function recall(kind) {
  try { return localStorage.getItem(DEVICE_KEYS[kind]) || ""; } catch { return ""; }
}

// Only Chromium can route audio to a chosen output device.
export const canChooseSpeaker = () => typeof HTMLMediaElement !== "undefined" &&
  typeof HTMLMediaElement.prototype.setSinkId === "function";

export async function applySpeaker(deviceId, elements) {
  if (!canChooseSpeaker() || !deviceId) return false;
  let ok = true;
  for (const el of elements) {
    try { await el.setSinkId(deviceId); } catch (err) { ok = false; console.warn("setSinkId failed", err); }
  }
  return ok;
}

// Fires the callback whenever devices are added or removed.
export function onDeviceChange(fn) {
  if (!navigator.mediaDevices?.addEventListener) return () => {};
  const handler = () => fn();
  navigator.mediaDevices.addEventListener("devicechange", handler);
  return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
}

// A simple RMS meter for the pre-join microphone check.
export function meter(stream, onLevel) {
  let ctx, raf;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    console.warn("mic meter unavailable", err);
  }
  return () => { cancelAnimationFrame(raf); try { ctx && ctx.close(); } catch {} };
}
