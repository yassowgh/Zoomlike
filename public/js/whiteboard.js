// Collaborative whiteboard with an object model, selection/move/resize/lock,
// inline text, images, and a pan/zoom viewport (infinite canvas).
//
// Objects live in world coordinates. Each viewer has their own viewport
// { scale, panX, panY } (CSS px), so pan/zoom is personal. Two layers:
// `board` renders committed objects; `overlay` shows the in-progress shape,
// selection handles and remote cursors.

export class Whiteboard {
  constructor(boardCanvas, overlayCanvas, wrap) {
    this.board = boardCanvas;
    this.overlay = overlayCanvas;
    this.wrap = wrap;
    this.bctx = boardCanvas.getContext("2d");
    this.octx = overlayCanvas.getContext("2d");

    this.objects = new Map();     // id -> object (insertion order = z-order)
    this.cursors = new Map();
    this.images = new Map();      // id -> HTMLImageElement cache

    this.tool = "pen";
    this.color = "#ffd400";
    this.size = 3;
    this.canDraw = true;          // write permission

    this.view = { scale: 1, panX: 40, panY: 40 };
    this.drawing = false;
    this.current = null;
    this.selectedId = null;
    this.drag = null;             // {mode:'move'|'resize'|'pan', ...}

    this.onAdd = () => {};
    this.onUpdate = () => {};
    this.onDelete = () => {};
    this.onClear = () => {};
    this.onCursor = () => {};
    this.onSelect = () => {};

    this._makeTextInput();
    this._bindResize();
    this._bindPointer();
    this.resize();
  }

  // ---- viewport ----------------------------------------------------------
  _bindResize() { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.wrap); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    for (const c of [this.board, this.overlay]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.dpr = dpr;
    this.redraw();
  }

  toScreen(x, y) { return [(x * this.view.scale + this.view.panX) * this.dpr, (y * this.view.scale + this.view.panY) * this.dpr]; }
  toWorldCss(cx, cy) { return [(cx - this.view.panX) / this.view.scale, (cy - this.view.panY) / this.view.scale]; }

  setTool(t) { this.tool = t; this.select(null); }
  setColor(c) { this.color = c; if (this.selectedId) this._patch(this.selectedId, { color: c }); }
  setSize(s) { this.size = Number(s); }
  setCanDraw(v) { this.canDraw = !!v; if (!v) this.select(null); }

  zoomBy(factor, cx, cy) {
    const r = this.wrap.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const [wx, wy] = this.toWorldCss(cx, cy);
    this.view.scale = Math.max(0.2, Math.min(5, this.view.scale * factor));
    this.view.panX = cx - wx * this.view.scale;
    this.view.panY = cy - wy * this.view.scale;
    this.redraw();
  }
  panBy(dx, dy) { this.view.panX += dx; this.view.panY += dy; this.redraw(); }
  resetView() { this.view = { scale: 1, panX: 40, panY: 40 }; this.redraw(); }

  // ---- object CRUD -------------------------------------------------------
  loadShapes(list) { this.objects.clear(); for (const s of list || []) this._ingest(s); this.redraw(); }
  addRemoteShape(s) { if (s && s.id) { this._ingest(s); this.redraw(); } }
  removeShape(id) { if (this.objects.delete(id)) { if (this.selectedId === id) this.select(null); this.redraw(); } }
  clearAll() { this.objects.clear(); this.select(null); this.redraw(); }

  _ingest(s) {
    this.objects.set(s.id, s);
    if (s.type === "image" && s.src && !this.images.has(s.id)) {
      const img = new Image();
      img.onload = () => this.redraw();
      img.src = s.src;
      this.images.set(s.id, img);
    }
  }

  _commit(obj) { this.objects.set(obj.id, obj); this.onAdd(obj); this.redraw(); }
  _patch(id, patch, live) {
    const o = this.objects.get(id); if (!o) return;
    Object.assign(o, patch);
    this.redraw();
    (live ? this.onUpdateLive || this.onUpdate : this.onUpdate)(o);
  }

  insertImage(src) {
    const img = new Image();
    img.onload = () => {
      const max = 420;
      let w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, max / Math.max(w, h)); w *= s; h *= s;
      const r = this.wrap.getBoundingClientRect();
      const [cx, cy] = this.toWorldCss(r.width / 2, r.height / 2);
      const obj = { id: uid(), type: "image", x: cx - w / 2, y: cy - h / 2, w, h, src, locked: false };
      this.images.set(obj.id, img);
      this._commit(obj);
      this.setTool("select"); this.select(obj.id);
    };
    img.src = src;
  }

  deleteSelected() {
    if (!this.selectedId) return;
    const o = this.objects.get(this.selectedId);
    if (o && o.locked) return;
    const id = this.selectedId;
    this.objects.delete(id); this.select(null); this.redraw(); this.onDelete(id);
  }
  toggleLockSelected() {
    if (!this.selectedId) return;
    const o = this.objects.get(this.selectedId); if (!o) return;
    o.locked = !o.locked; this.onUpdate(o); this.redraw(); this.onSelect(o);
  }
  undoMine() { // remove my last-added object
    const ids = [...this.objects.keys()];
    for (let i = ids.length - 1; i >= 0; i--) { const o = this.objects.get(ids[i]); if (o && o.mine) { this.objects.delete(ids[i]); this.redraw(); this.onDelete(ids[i]); return; } }
  }

  select(id) { this.selectedId = id; this.onSelect(id ? this.objects.get(id) : null); this._drawOverlay(); }

  // ---- pointer -----------------------------------------------------------
  _bindPointer() {
    const el = this.overlay;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => this._down(e));
    el.addEventListener("pointermove", (e) => this._move(e));
    el.addEventListener("pointerup", (e) => this._up(e));
    el.addEventListener("pointercancel", (e) => this._up(e));
    el.addEventListener("wheel", (e) => this._wheel(e), { passive: false });
    el.addEventListener("dblclick", (e) => this._dbl(e));
  }

  _cssPos(e) { const r = this.wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _worldPos(e) { const [cx, cy] = this._cssPos(e); return this.toWorldCss(cx, cy); }

  _wheel(e) {
    e.preventDefault();
    const [cx, cy] = this._cssPos(e);
    if (e.ctrlKey || e.metaKey) this.zoomBy(e.deltaY < 0 ? 1.1 : 0.9, cx, cy);
    else this.panBy(-e.deltaX, -e.deltaY); // scroll to pan
  }

  _down(e) {
    if (e.button === 1 || this.tool === "pan" || e.button === 2) { // middle / pan tool / right = pan
      this.drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: this.view.panX, py: this.view.panY };
      this.overlay.setPointerCapture?.(e.pointerId); return;
    }
    const [wx, wy] = this._worldPos(e);
    this.onCursor(wx, wy);

    // Selection tool: pick / move / resize.
    if (this.tool === "select") {
      if (this.selectedId) {
        const handle = this._handleAt(e);
        if (handle) { this.drag = { mode: "resize", id: this.selectedId, handle, start: { ...this.objects.get(this.selectedId) } }; this.overlay.setPointerCapture?.(e.pointerId); return; }
      }
      const hit = this._hitTest(wx, wy);
      this.select(hit);
      if (hit) {
        const o = this.objects.get(hit);
        if (!o.locked) { this.drag = { mode: "move", id: hit, wx, wy, start: { ...o } }; this.overlay.setPointerCapture?.(e.pointerId); }
      }
      return;
    }

    if (!this.canDraw) return; // write permission

    if (this.tool === "eraser") { const hit = this._hitTest(wx, wy); if (hit && !this.objects.get(hit).locked) { this.objects.delete(hit); this.redraw(); this.onDelete(hit); } this.drawing = true; return; }
    if (this.tool === "text") { this._openText(wx, wy); return; }

    this.drawing = true;
    this.overlay.setPointerCapture?.(e.pointerId);
    if (this.tool === "pen") this.current = { id: uid(), type: "pen", color: this.color, size: this.size, points: [{ x: wx, y: wy }], mine: true };
    else this.current = { id: uid(), type: this.tool, color: this.color, size: this.size, x1: wx, y1: wy, x2: wx, y2: wy, mine: true };
  }

  _move(e) {
    const [wx, wy] = this._worldPos(e);
    this.onCursor(wx, wy);

    if (this.drag) {
      if (this.drag.mode === "pan") { this.view.panX = this.drag.px + (e.clientX - this.drag.sx); this.view.panY = this.drag.py + (e.clientY - this.drag.sy); this.redraw(); return; }
      if (this.drag.mode === "move") { const o = this.objects.get(this.drag.id); if (o) { translate(o, wx - this.drag.wx, wy - this.drag.wy); this.drag.wx = wx; this.drag.wy = wy; this.redraw(); } return; }
      if (this.drag.mode === "resize") { this._resize(this.drag, wx, wy); this.redraw(); return; }
    }

    if (!this.drawing) return;
    if (this.tool === "eraser") { const hit = this._hitTest(wx, wy); if (hit && !this.objects.get(hit).locked) { this.objects.delete(hit); this.redraw(); this.onDelete(hit); } return; }
    if (!this.current) return;
    if (this.current.type === "pen") this.current.points.push({ x: wx, y: wy });
    else { this.current.x2 = wx; this.current.y2 = wy; }
    this._drawOverlay();
  }

  _up(e) {
    if (this.drag) {
      const d = this.drag; this.drag = null;
      if (d.mode === "move" || d.mode === "resize") { const o = this.objects.get(d.id); if (o) this.onUpdate(o); this._drawOverlay(); }
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;
    const shape = this.current; this.current = null;
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!shape) return;
    if (shape.type !== "pen") { if (Math.abs(shape.x2 - shape.x1) < 2 && Math.abs(shape.y2 - shape.y1) < 2) return; }
    else if (shape.points.length < 2) shape.points.push({ x: shape.points[0].x + 0.5, y: shape.points[0].y + 0.5 });
    this._commit(shape);
  }

  _dbl(e) {
    if (this.tool !== "select") return;
    const [wx, wy] = this._worldPos(e);
    const hit = this._hitTest(wx, wy);
    if (hit && this.objects.get(hit).type === "text" && !this.objects.get(hit).locked) this._openText(wx, wy, hit);
  }

  _resize(drag, wx, wy) {
    const o = this.objects.get(drag.id); if (!o || o.locked) return;
    const s = drag.start;
    if (o.type === "image") {
      if (drag.handle === "se") { o.w = Math.max(20, wx - s.x); o.h = Math.max(20, wy - s.y); }
      else if (drag.handle === "nw") { o.w = Math.max(20, s.x + s.w - wx); o.h = Math.max(20, s.y + s.h - wy); o.x = wx; o.y = wy; }
    } else if (o.type === "rect" || o.type === "ellipse" || o.type === "line" || o.type === "arrow") {
      if (drag.handle === "se") { o.x2 = wx; o.y2 = wy; } else if (drag.handle === "nw") { o.x1 = wx; o.y1 = wy; }
    } else if (o.type === "text") {
      o.size = Math.max(6, Math.min(120, s.size * ((wx - s.x) / ((s.w || 100) / this.view.scale)) || s.size));
    }
  }

  // ---- text input --------------------------------------------------------
  _makeTextInput() {
    const ta = document.createElement("textarea");
    ta.className = "wb-text-input"; ta.hidden = true; ta.rows = 1; ta.wrap = "off";
    ta.addEventListener("blur", () => this._closeText());
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === "Escape") { ta.value = ""; ta.blur(); } });
    this.wrap.appendChild(ta);
    this.textInput = ta;
  }
  _openText(wx, wy, editId) {
    const ta = this.textInput;
    this._textCtx = { wx, wy, editId: editId || null };
    let val = "", size = this.size, color = this.color;
    if (editId) { const o = this.objects.get(editId); val = o.text; size = o.size; color = o.color; this._textCtx.wx = o.x; this._textCtx.wy = o.y; this.objects.delete(editId); this.redraw(); }
    const [sx, sy] = this.toScreen(this._textCtx.wx, this._textCtx.wy);
    ta.style.left = sx / this.dpr + "px";
    ta.style.top = sy / this.dpr + "px";
    ta.style.fontSize = Math.max(12, size * 1.6) * this.view.scale + "px";
    ta.style.color = color;
    ta.value = val; ta.hidden = false; setTimeout(() => ta.focus(), 0);
  }
  _closeText() {
    const ta = this.textInput; if (ta.hidden) return;
    const text = ta.value.trim(); ta.hidden = true;
    if (!text || !this._textCtx) return;
    const obj = { id: uid(), type: "text", x: this._textCtx.wx, y: this._textCtx.wy, text, size: this.size, color: this.color, mine: true, locked: false };
    this._measureText(obj);
    this._commit(obj);
    this._textCtx = null;
  }
  _measureText(o) {
    const ctx = this.bctx; ctx.save(); ctx.font = `${o.size * 1.6}px system-ui, sans-serif`;
    const lines = o.text.split("\n"); let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    o.w = w; o.h = lines.length * o.size * 1.9; ctx.restore();
  }

  // ---- hit testing -------------------------------------------------------
  _bbox(o) {
    if (o.type === "pen") { const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    if (o.type === "image") return [o.x, o.y, o.x + o.w, o.y + o.h];
    if (o.type === "text") { if (o.w == null) this._measureText(o); return [o.x, o.y, o.x + (o.w || 60), o.y + (o.h || o.size * 2)]; }
    return [Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2)];
  }
  _hitTest(wx, wy) {
    const ids = [...this.objects.keys()];
    for (let i = ids.length - 1; i >= 0; i--) {
      const o = this.objects.get(ids[i]);
      const [x0, y0, x1, y1] = this._bbox(o);
      const pad = (o.size || 6) + 6 / this.view.scale;
      if (wx >= x0 - pad && wx <= x1 + pad && wy >= y0 - pad && wy <= y1 + pad) return ids[i];
    }
    return null;
  }
  _handleAt(e) {
    const o = this.objects.get(this.selectedId); if (!o || o.locked) return null;
    if (!["image", "rect", "ellipse", "line", "arrow", "text"].includes(o.type)) return null;
    const [x0, y0, x1, y1] = this._bbox(o);
    const [sx0, sy0] = this.toScreen(x0, y0), [sx1, sy1] = this.toScreen(x1, y1);
    const [cx, cy] = this._cssPos(e); const px = cx * this.dpr, py = cy * this.dpr; const t = 12 * this.dpr;
    if (Math.abs(px - sx1) < t && Math.abs(py - sy1) < t) return "se";
    if (Math.abs(px - sx0) < t && Math.abs(py - sy0) < t) return "nw";
    return null;
  }

  // ---- rendering ---------------------------------------------------------
  redraw() { const { bctx, board } = this; if (!this.dpr) return; bctx.clearRect(0, 0, board.width, board.height); for (const o of this.objects.values()) this._paint(bctx, o); this._drawOverlay(); }
  _drawOverlay() {
    const { octx, overlay } = this; if (!this.dpr) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (this.current) this._paint(octx, this.current);
    if (this.selectedId && this.objects.has(this.selectedId)) this._paintSelection(octx, this.objects.get(this.selectedId));
  }

  _paint(ctx, o) {
    ctx.save();
    ctx.strokeStyle = o.color; ctx.fillStyle = o.color;
    ctx.lineWidth = Math.max(1, o.size || 2) * this.view.scale * this.dpr;
    ctx.lineJoin = ctx.lineCap = "round";
    const P = (x, y) => this.toScreen(x, y);
    if (o.type === "pen") { ctx.beginPath(); o.points.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
    else if (o.type === "line" || o.type === "arrow") { const [a, b] = P(o.x1, o.y1), [c, d] = P(o.x2, o.y2); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); if (o.type === "arrow") this._arrow(ctx, a, b, c, d); }
    else if (o.type === "rect") { const [a, b] = P(o.x1, o.y1), [c, d] = P(o.x2, o.y2); ctx.strokeRect(a, b, c - a, d - b); }
    else if (o.type === "ellipse") { const [a, b] = P(o.x1, o.y1), [c, d] = P(o.x2, o.y2); ctx.beginPath(); ctx.ellipse((a + c) / 2, (b + d) / 2, Math.abs(c - a) / 2, Math.abs(d - b) / 2, 0, 0, 7); ctx.stroke(); }
    else if (o.type === "text") { const [x, y] = P(o.x, o.y); ctx.textBaseline = "top"; ctx.font = `${o.size * 1.6 * this.view.scale * this.dpr}px system-ui, sans-serif`; o.text.split("\n").forEach((ln, i) => ctx.fillText(ln, x, y + i * o.size * 1.9 * this.view.scale * this.dpr)); }
    else if (o.type === "image") { const img = this.images.get(o.id); const [x, y] = P(o.x, o.y); if (img && img.complete) { try { ctx.drawImage(img, x, y, o.w * this.view.scale * this.dpr, o.h * this.view.scale * this.dpr); } catch {} } else { ctx.strokeRect(x, y, o.w * this.view.scale * this.dpr, o.h * this.view.scale * this.dpr); } }
    ctx.restore();
  }
  _arrow(ctx, x1, y1, x2, y2) { const a = Math.atan2(y2 - y1, x2 - x1), L = 12 + ctx.lineWidth * 1.5; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a - Math.PI / 6), y2 - L * Math.sin(a - Math.PI / 6)); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a + Math.PI / 6), y2 - L * Math.sin(a + Math.PI / 6)); ctx.stroke(); }

  _paintSelection(ctx, o) {
    const [x0, y0, x1, y1] = this._bbox(o);
    const [a, b] = this.toScreen(x0, y0), [c, d] = this.toScreen(x1, y1);
    ctx.save();
    ctx.strokeStyle = o.locked ? "#f59e0b" : "#3b82f6"; ctx.lineWidth = 1.5 * this.dpr; ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
    ctx.strokeRect(a - 4, b - 4, c - a + 8, d - b + 8);
    ctx.setLineDash([]);
    if (!o.locked && ["image", "rect", "ellipse", "line", "arrow"].includes(o.type)) {
      ctx.fillStyle = "#3b82f6";
      for (const [hx, hy] of [[a, b], [c, d]]) { ctx.fillRect(hx - 5 * this.dpr, hy - 5 * this.dpr, 10 * this.dpr, 10 * this.dpr); }
    }
    if (o.locked) { ctx.fillStyle = "#f59e0b"; ctx.font = `${12 * this.dpr}px system-ui`; ctx.fillText("🔒", a - 4, b - 8 * this.dpr); }
    ctx.restore();
  }

  // ---- export ------------------------------------------------------------
  // Returns a flattened PNG data URL of all content, on the given background.
  exportImage(bgColor) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of this.objects.values()) { const [a, b, c, d] = this._bbox(o); x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1280; y1 = 720; }
    const pad = 40; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const W = Math.min(4000, Math.max(200, x1 - x0)), H = Math.min(4000, Math.max(200, y1 - y0));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bgColor || "#0e1730"; ctx.fillRect(0, 0, W, H);
    // paint in world coords offset by (x0,y0), scale 1
    const savedView = this.view, savedDpr = this.dpr, savedCtx = this.bctx;
    this.view = { scale: 1, panX: -x0, panY: -y0 }; this.dpr = 1; this.bctx = ctx;
    for (const o of this.objects.values()) this._paint(ctx, o);
    this.view = savedView; this.dpr = savedDpr; this.bctx = savedCtx;
    return { url: c.toDataURL("image/png"), w: W, h: H };
  }

  // ---- remote cursors ----------------------------------------------------
  showCursor(id, name, wx, wy, color) {
    let el = this.cursors.get(id);
    if (!el) { el = document.createElement("div"); el.className = "cursor"; el.innerHTML = `<span class="dot"></span><span class="name"></span>`; el.querySelector(".dot").style.background = color; el.querySelector(".name").textContent = name || "Guest"; this.wrap.appendChild(el); this.cursors.set(id, el); }
    const [sx, sy] = this.toScreen(wx, wy);
    el.style.left = sx / this.dpr + "px"; el.style.top = sy / this.dpr + "px"; el.style.display = "flex";
    clearTimeout(el._t); el._t = setTimeout(() => (el.style.display = "none"), 4000);
  }
  removeCursor(id) { const el = this.cursors.get(id); if (el) { el.remove(); this.cursors.delete(id); } }
}

function translate(o, dx, dy) {
  if (o.type === "pen") o.points.forEach(p => { p.x += dx; p.y += dy; });
  else if (o.type === "image" || o.type === "text") { o.x += dx; o.y += dy; }
  else { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2); }
