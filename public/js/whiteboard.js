// Collaborative whiteboard on <canvas>.
//
// Coordinates are stored in a fixed "world" space (1920x1080) and mapped to
// each client's viewport with a "contain" fit, so every participant sees the
// same drawing regardless of screen size. Two layers: `board` holds committed
// shapes; `overlay` shows the in-progress shape and remote cursors.

const WORLD_W = 1920;
const WORLD_H = 1080;

export class Whiteboard {
  constructor(boardCanvas, overlayCanvas, wrap) {
    this.board = boardCanvas;
    this.overlay = overlayCanvas;
    this.wrap = wrap;
    this.bctx = boardCanvas.getContext("2d");
    this.octx = overlayCanvas.getContext("2d");

    this.shapes = new Map(); // id -> shape (draw order preserved by Map)
    this.myIds = []; // stack of shape ids I created (for undo)
    this.cursors = new Map(); // peerId -> element

    this.tool = "pen";
    this.color = "#ffd400";
    this.size = 3;

    this.drawing = false;
    this.current = null;
    this.fit = { scale: 1, ox: 0, oy: 0 };

    // Callbacks wired by main.js
    this.onShape = () => {};
    this.onErase = () => {};
    this.onClear = () => {};
    this.onCursor = () => {};

    this._bindResize();
    this._bindPointer();
    this.resize();
  }

  // ---- viewport / DPR -------------------------------------------------
  _bindResize() {
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.wrap);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (w === 0 || h === 0) return; // hidden (e.g. gallery view); keep last state
    for (const c of [this.board, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    // "contain" fit of the world into the viewport.
    const scale = Math.min(w / WORLD_W, h / WORLD_H);
    this.fit = {
      scale: scale * dpr,
      ox: ((w - WORLD_W * scale) / 2) * dpr,
      oy: ((h - WORLD_H * scale) / 2) * dpr,
    };
    this.redraw();
  }

  worldToScreen(x, y) {
    return [x * this.fit.scale + this.fit.ox, y * this.fit.scale + this.fit.oy];
  }
  screenToWorld(px, py) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return [((px * dpr) - this.fit.ox) / this.fit.scale, ((py * dpr) - this.fit.oy) / this.fit.scale];
  }

  // ---- state mutation -------------------------------------------------
  setTool(t) { this.tool = t; }
  setColor(c) { this.color = c; }
  setSize(s) { this.size = Number(s); }

  loadShapes(list) {
    this.shapes.clear();
    for (const s of list || []) this.shapes.set(s.id, s);
    this.redraw();
  }
  addRemoteShape(s) { if (s && s.id) { this.shapes.set(s.id, s); this.redraw(); } }
  removeShape(id) { if (this.shapes.delete(id)) this.redraw(); }
  clearAll() { this.shapes.clear(); this.myIds = []; this.redraw(); }

  undoMine() {
    while (this.myIds.length) {
      const id = this.myIds.pop();
      if (this.shapes.has(id)) {
        this.shapes.delete(id);
        this.redraw();
        this.onErase(id);
        return;
      }
    }
  }

  // ---- pointer handling ----------------------------------------------
  _bindPointer() {
    // Bind to the overlay canvas only (NOT the whole board-wrap), so the
    // toolbar buttons, colour picker and sliders that sit above it stay
    // clickable instead of being swallowed by pointer capture.
    const el = this.overlay;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => this._down(e));
    el.addEventListener("pointermove", (e) => this._move(e));
    el.addEventListener("pointerup", (e) => this._up(e));
    el.addEventListener("pointercancel", (e) => this._up(e));
    el.addEventListener("pointerleave", (e) => { if (this.drawing) this._up(e); });
  }

  _pos(e) {
    const r = this.wrap.getBoundingClientRect();
    return this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _down(e) {
    if (e.button === 2) return; // ignore right-click
    const [x, y] = this._pos(e);
    this.overlay.setPointerCapture?.(e.pointerId);

    if (this.tool === "eraser") {
      const hit = this._hitTest(x, y);
      if (hit) { this.shapes.delete(hit); this.redraw(); this.onErase(hit); }
      this.drawing = true; // allow drag-erase
      return;
    }

    if (this.tool === "text") {
      const text = window.prompt("Text:");
      if (text && text.trim()) {
        const shape = { id: uid(), type: "text", color: this.color, size: this.size, x, y, text: text.trim() };
        this._commit(shape);
      }
      return;
    }

    this.drawing = true;
    if (this.tool === "pen") {
      this.current = { id: uid(), type: "pen", color: this.color, size: this.size, points: [{ x, y }] };
    } else {
      this.current = { id: uid(), type: this.tool, color: this.color, size: this.size, x1: x, y1: y, x2: x, y2: y };
    }
  }

  _move(e) {
    const [x, y] = this._pos(e);
    this.onCursor(x, y); // broadcast my cursor (throttled in main)

    if (!this.drawing) return;

    if (this.tool === "eraser") {
      const hit = this._hitTest(x, y);
      if (hit) { this.shapes.delete(hit); this.redraw(); this.onErase(hit); }
      return;
    }
    if (!this.current) return;

    if (this.current.type === "pen") {
      this.current.points.push({ x, y });
    } else {
      this.current.x2 = x; this.current.y2 = y;
    }
    this._drawOverlay();
  }

  _up() {
    if (!this.drawing) return;
    this.drawing = false;
    const shape = this.current;
    this.current = null;
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!shape) return;
    // Discard zero-length drags for non-pen tools.
    if (shape.type !== "pen") {
      if (Math.abs(shape.x2 - shape.x1) < 2 && Math.abs(shape.y2 - shape.y1) < 2) return;
    } else if (shape.points.length < 2) {
      shape.points.push({ x: shape.points[0].x + 0.5, y: shape.points[0].y + 0.5 });
    }
    this._commit(shape);
  }

  _commit(shape) {
    this.shapes.set(shape.id, shape);
    this.myIds.push(shape.id);
    this._paintShape(this.bctx, shape);
    this.onShape(shape);
  }

  // ---- hit testing (eraser) ------------------------------------------
  _hitTest(x, y) {
    const r = 14 / this.fit.scale; // tolerance in world units
    const ids = [...this.shapes.keys()];
    for (let i = ids.length - 1; i >= 0; i--) {
      const s = this.shapes.get(ids[i]);
      if (this._near(s, x, y, r)) return ids[i];
    }
    return null;
  }
  _near(s, x, y, r) {
    if (s.type === "pen") return s.points.some((p) => Math.hypot(p.x - x, p.y - y) <= r + s.size);
    if (s.type === "text") return Math.abs(x - s.x) < 120 && Math.abs(y - s.y) < 40;
    // segment/box: check distance to the two defining points and midpoint
    const pts = [[s.x1, s.y1], [s.x2, s.y2], [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]];
    return pts.some(([px, py]) => Math.hypot(px - x, py - y) <= r + s.size + 6);
  }

  // ---- rendering ------------------------------------------------------
  redraw() {
    const { bctx, board } = this;
    bctx.clearRect(0, 0, board.width, board.height);
    for (const s of this.shapes.values()) this._paintShape(bctx, s);
  }
  _drawOverlay() {
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.current) this._paintShape(this.octx, this.current);
  }

  _paintShape(ctx, s) {
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, s.size) * this.fit.scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const P = (x, y) => this.worldToScreen(x, y);

    if (s.type === "pen") {
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const [sx, sy] = P(p.x, p.y);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.stroke();
    } else if (s.type === "line" || s.type === "arrow") {
      const [a, b] = P(s.x1, s.y1);
      const [c, d] = P(s.x2, s.y2);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      if (s.type === "arrow") this._arrowHead(ctx, a, b, c, d);
    } else if (s.type === "rect") {
      const [a, b] = P(s.x1, s.y1);
      const [c, d] = P(s.x2, s.y2);
      ctx.strokeRect(a, b, c - a, d - b);
    } else if (s.type === "ellipse") {
      const [a, b] = P(s.x1, s.y1);
      const [c, d] = P(s.x2, s.y2);
      ctx.beginPath();
      ctx.ellipse((a + c) / 2, (b + d) / 2, Math.abs(c - a) / 2, Math.abs(d - b) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === "text") {
      const [x, y] = P(s.x, s.y);
      ctx.font = `${Math.max(12, s.size * 6) * this.fit.scale}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(s.text, x, y);
    }
    ctx.restore();
  }

  _arrowHead(ctx, x1, y1, x2, y2) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = 12 + ctx.lineWidth * 1.5;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 6), y2 - len * Math.sin(ang - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 6), y2 - len * Math.sin(ang + Math.PI / 6));
    ctx.stroke();
  }

  // ---- remote cursors -------------------------------------------------
  showCursor(id, name, wx, wy, color) {
    let el = this.cursors.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "cursor";
      el.innerHTML = `<span class="dot"></span><span class="name"></span>`;
      el.querySelector(".dot").style.background = color;
      el.querySelector(".name").textContent = name || "Guest";
      this.wrap.appendChild(el);
      this.cursors.set(id, el);
    }
    const [sx, sy] = this.worldToScreen(wx, wy);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.style.left = sx / dpr + "px";
    el.style.top = sy / dpr + "px";
    el.style.display = "flex";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = "none"), 4000);
  }
  removeCursor(id) {
    const el = this.cursors.get(id);
    if (el) { el.remove(); this.cursors.delete(id); }
  }
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
}
