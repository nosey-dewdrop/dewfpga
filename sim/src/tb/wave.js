// draws a vcd on a canvas: one row per signal, bits as steps, buses as hex boxes.
const ROW = 26, VALW = 70, PAD = 8;
const namesW = (W) => (W < 700 ? 150 : 250);
export class Wave {
  constructor(canvas, css) {
    this.canvas = canvas;
    this.css = css;   // () => ({ink, dim, accent, bg, x})
    this.data = null;
    this.cursor = null;
    this.view = null;   // [t0, t1]
    this.drag = null;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left;
      if (this.drag) { const [t0, t1] = this.view; const dt = ((this.drag.x - x) / (this._x1 - this._x0)) * (t1 - t0); this.setView(this.drag.t0 + dt, this.drag.t1 + dt); this.drag.x = x; this.drag.t0 = this.view[0]; this.drag.t1 = this.view[1]; }
      this.cursor = x; this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.cursor = null; this.drag = null; this.draw(); });
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); this.drag = { x: e.clientX - r.left, t0: this.view[0], t1: this.view[1] }; });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (!this.data) return; e.preventDefault();
      const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left;
      const [t0, t1] = this.view; const f = (x - this._x0) / (this._x1 - this._x0); const tAt = t0 + f * (t1 - t0);
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      this.setView(tAt - (tAt - t0) * k, tAt + (t1 - tAt) * k); this.draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => { if (this.data) { this.view = [0, Math.max(1, this.data.tmax)]; this.draw(); } });
    let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.draw()); }).observe(canvas.parentElement);
  }
  set(data) { this.data = data; this.view = data ? [0, Math.max(1, data.tmax)] : null; this.draw(); }
  setView(t0, t1) {
    const max = Math.max(1, this.data.tmax); let span = Math.min(max, Math.max(t1 - t0, 4));
    t0 = Math.max(0, Math.min(t0, max - span)); this.view = [t0, t0 + span];
  }
  valueAt(id, t) {
    const a = this.data.changes.get(id); let v = 'x';
    for (const c of a) { if (c.t > t) break; v = c.v; }
    return v;
  }
  draw() {
    const c = this.canvas, d = this.data;
    const W = c.parentElement.clientWidth, dpr = window.devicePixelRatio || 1;
    const H = d ? PAD * 2 + ROW * d.signals.length + 18 : 0;
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
    if (!d) return;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const { ink, dim, accent, bg, x: xcol } = this.css();
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.font = '12px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    const x0 = namesW(W), x1 = W - PAD; this._x0 = x0; this._x1 = x1;
    const [v0, v1] = this.view, span = v1 - v0;
    const X = (t) => x0 + ((t - v0) / span) * (x1 - x0);
    const tCur = this.cursor != null && this.cursor >= x0 ? Math.round(v0 + ((this.cursor - x0) / (x1 - x0)) * span) : null;
    g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip();
    // time axis
    g.fillStyle = dim; g.textAlign = 'left';
    const ticks = Math.max(2, Math.floor((x1 - x0) / 110));
    for (let k = 0; k <= ticks; k++) { const t = Math.round(v0 + (span * k) / ticks); g.fillRect(X(t), PAD, 1, ROW * d.signals.length); g.fillText(String(t), Math.min(X(t) + 3, W - 60), H - 9); }
    d.signals.forEach((s, row) => {
      const y = PAD + row * ROW, ym = y + ROW / 2, hi = y + 5, lo = y + ROW - 5;
      const a = d.changes.get(s.id);
      if (s.width === 1) {
        g.strokeStyle = accent; g.lineWidth = 1.5; g.beginPath();
        let prevV = 'x', prevX = x0;
        const yOf = (v) => (v === '1' ? hi : v === '0' ? lo : ym);
        for (let i = 0; i <= a.length; i++) {
          const c2 = a[i]; const xx = c2 ? X(c2.t) : x1;
          if (i === 0) { g.moveTo(prevX, yOf(prevV)); }
          g.lineTo(xx, yOf(prevV));
          if (c2) { if (prevV !== c2.v) { g.lineTo(xx, yOf(c2.v)); } prevV = c2.v; prevX = xx; }
        }
        g.stroke();
        if (a.length === 0 || a[0].t > 0) { g.strokeStyle = xcol; g.beginPath(); g.moveTo(x0, ym); g.lineTo(a.length ? X(a[0].t) : x1, ym); g.stroke(); }
      } else {
        g.lineWidth = 1;
        for (let i = 0; i < a.length; i++) {
          const xa = X(a[i].t), xb = i + 1 < a.length ? X(a[i + 1].t) : x1;
          const v = a[i].v, undef = /[xz]/i.test(v);
          g.strokeStyle = undef ? xcol : accent;
          g.beginPath(); g.moveTo(xa, ym); g.lineTo(Math.min(xa + 4, xb), hi); g.lineTo(Math.max(xb - 4, xa), hi); g.lineTo(xb, ym); g.lineTo(Math.max(xb - 4, xa), lo); g.lineTo(Math.min(xa + 4, xb), lo); g.closePath(); g.stroke();
          if (xb - xa > 26) { g.fillStyle = ink; g.textAlign = 'left'; g.fillText(hex(v, s.width), xa + 7, ym); }
        }
        if (a.length === 0 || a[0].t > 0) { g.strokeStyle = xcol; g.beginPath(); g.moveTo(x0, ym); g.lineTo(a.length ? X(a[0].t) : x1, ym); g.stroke(); }
      }
    });
    g.restore();
    g.font = '12px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    d.signals.forEach((s, row) => {
      const ym = PAD + row * ROW + ROW / 2;
      g.fillStyle = dim; g.textAlign = 'right';
      const label = (s.scope ? s.scope.split('.').slice(1).join('.') + (s.scope.includes('.') ? '.' : '') : '') + s.name;
      const maxc = W < 700 ? 10 : 20; g.fillText(label.length > maxc ? '…' + label.slice(-(maxc - 1)) : label, x0 - VALW - 10, ym);
    });
    if (tCur != null) {
      g.fillStyle = ink; g.fillRect(this.cursor, PAD, 1, ROW * d.signals.length);
      const lbl = `t = ${tCur}`; const lx = Math.min(this.cursor + 5, W - 90);
      g.fillStyle = bg; g.fillRect(lx - 3, H - 18, g.measureText(lbl).width + 6, 18); g.fillStyle = ink; g.textAlign = 'left'; g.fillText(lbl, lx, H - 9);
      d.signals.forEach((s, row) => { const v = this.valueAt(s.id, tCur); g.fillStyle = accent; g.textAlign = 'right'; g.fillText(s.width === 1 ? v : hex(v, s.width), x0 - 10, PAD + row * ROW + ROW / 2); g.fillStyle = dim; });
    }
  }
}
function hex(bin, width) {
  if (/[xz]/i.test(bin)) return bin.length > 8 ? bin.slice(0, 6) + '…' : bin;
  const n = BigInt('0b' + bin);
  return '0x' + n.toString(16).padStart(Math.ceil(width / 4), '0');
}
