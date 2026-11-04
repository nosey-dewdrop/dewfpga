// *-*-*-*-*-*-*-*-*-*-*-* what: the board, straight from above, yours to try *-*-*-*-*-*-*-*-*-*-*-*
// the basys 3 drawn flat, part by part where the real board has it. the design on the chip:
// led = sw, and the switches drive the display, seg = ~sw[6:0], an = ~sw[15:12] (both active
// low on the basys 3). an led clicked flips the switch under it, so the board stays honest.

const BW = 12.1, BD = 8.3;   // the board in cm, w from the switch edge (0) to the usb edge

// the layout of the grid: where a point of the board lands
function boardLayout(cols, mobile) {
  const mx = 1, top = mobile ? 4 : 5;
  const sx = (cols - 2 * mx) / BW, sy = sx * 0.602 / 1.16;
  const rows = Math.ceil(top + BD * sy + 2);
  const X = u => mx + u * sx, Y = w => top + (BD - w) * sy;
  return { cols, rows, sx, sy, X, Y, top };
}

// a box of underscores and bars, the way the windows of the scene are drawn
function frameBox(g, x0, y0, x1, y1, cls, fillCh) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  for (let y = y0 + 1; y <= y1; y++) {
    for (let x = x0 + 1; x < x1; x++) {
      put(g, x, y, fillCh || ' ', fillCh ? cls : 0);
    }
  }
  for (let x = x0 + 1; x < x1; x++) {
    put(g, x, y0, '_', cls);
    put(g, x, y1, '_', cls);
  }
  for (let y = y0 + 1; y <= y1; y++) {
    put(g, x0, y, '|', cls);
    put(g, x1, y, '|', cls);
  }
  return { x0, y0, x1, y1 };
}

// the switch: its body, the slot, the lever at the far end when it is on. k runs 0 (off)
// to 3 (on); the two between are the lever on its way
function switchArt(k, small) {
  if (small) {
    return k >= 2 ? [' _ ', '|#|', '| |', '|_|'] : [' _ ', '| |', '|#|', '|_|'];
  }
  const row = j => (j === 4 - k ? '|[#]|' : '|   |');
  return [' ___ ', row(1), row(2), row(3), row(4), '|___|'];
}

// a digit of the display: seven segments, a to g, and its point
const SEG7 = [
  // [segment, cells]: a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle
  [0, [[1, 0], [2, 0], [3, 0], [4, 0]]], [1, [[5, 1], [5, 2], [5, 3]]], [2, [[5, 4], [5, 5], [5, 6]]],
  [3, [[1, 6], [2, 6], [3, 6], [4, 6]]], [4, [[0, 4], [0, 5], [0, 6]]], [5, [[0, 1], [0, 2], [0, 3]]],
  [6, [[1, 3], [2, 3], [3, 3], [4, 3]]],
];
function drawDigit(g, x, y, segs, on) {
  for (const [s, cells] of SEG7) {
    const lit = on && ((segs >> s) & 1);
    for (const [dx, dy] of cells) {
      put(g, x + dx, y + dy, dx === 0 || dx === 5 ? '|' : '_', lit ? SEG : SEGOFF);
    }
  }
  put(g, x + 6, y + 6, '.', SEGOFF);
}

function drawBoardFlat(g, st, L, small) {
  const { X, Y } = L;
  // the board: a rounded plate, its four holes
  const x0 = Math.round(X(0)), x1 = Math.round(X(BW)), y0 = Math.round(Y(BD)), y1 = Math.round(Y(0));
  for (let x = x0 + 2; x <= x1 - 2; x++) {
    put(g, x, y0, '_', DIM);
    put(g, x, y1, '_', DIM);
  }
  put(g, x0 + 1, y0 + 1, '/', DIM); put(g, x1 - 1, y0 + 1, '\\', DIM);
  for (let y = y0 + 2; y < y1; y++) {
    put(g, x0, y, '|', DIM);
    put(g, x1, y, '|', DIM);
  }
  put(g, x0 + 1, y1, '\\', DIM); put(g, x1 - 1, y1, '/', DIM);
  for (const [u, w] of [[0.45, 0.45], [BW - 0.45, 0.45], [0.45, BD - 0.45], [BW - 0.45, BD - 0.45]]) {
    put(g, X(u), Y(w), 'o', DIM);
  }
  // the back edge: micro usb (prog), the power switch, vga, usb host
  const usb = frameBox(g, X(0.72), Y(BD + 0.05), X(1.52), Y(BD - 0.55), MUTE);
  text(g, Math.round((usb.x0 + usb.x1) / 2) - 1, usb.y1 - 1, '[=]', MUTE);
  const pw = frameBox(g, X(2.0), Y(BD - 0.05), X(2.6), Y(BD - 0.6), DIM);
  put(g, pw.x0 + 1 + (st.power ? 1 : 0), pw.y1 - 1, '#', INK);
  const vga = frameBox(g, X(6.3), Y(BD + 0.1), X(9.4), Y(BD - 1.0), MUTE);
  const vw = vga.x1 - vga.x0;
  for (let r = 0; r < 3; r++) {
    const n = r === 2 ? 4 : 5, step = Math.max(2, Math.floor((vw - 6) / (n + 1)));
    const sx0 = Math.round((vga.x0 + vga.x1) / 2 - (n - 1) * step / 2);
    for (let i = 0; i < n; i++) {
      put(g, sx0 + i * step, vga.y0 + 2 + r, 'o', DIM);
    }
  }
  frameBox(g, X(9.8), Y(BD + 0.1), X(11.25), Y(BD - 0.85), MUTE);
  frameBox(g, X(10.0), Y(BD - 0.05), X(11.05), Y(BD - 0.5), DIM);
  // power and done, the two leds by the switch
  put(g, X(2.95), Y(BD - 1.05), '*', LED);
  put(g, X(3.45), Y(BD - 1.05), '*', LED);
  text(g, Math.round(X(0.72)), Math.round(Y(BD - 0.85)), 'PROG', FAINT);
  text(g, Math.round(X(1.95)), Math.round(Y(BD - 0.85)), 'POWER', FAINT);
  text(g, Math.round(X(3.45)) - 1, Math.round(Y(BD - 1.05)) + 1, 'DONE', FAINT);
  // the usb bridge by the port and a regulator by the switch: small chips with legs
  const bridge = frameBox(g, X(1.15), Y(BD - 1.6), X(2.15), Y(BD - 2.55), DIM);
  for (let y = bridge.y0 + 1; y <= bridge.y1; y += 1) {
    put(g, bridge.x0 - 1, y, '-', FAINT);
    put(g, bridge.x1 + 1, y, '-', FAINT);
  }
  // the fpga: a lid in its square, the name on it
  const f = frameBox(g, X(4.75), Y(6.75), X(7.2), Y(4.3), MUTE);
  frameBox(g, f.x0 + 2, f.y0 + 1, f.x1 - 2, f.y1 - 1, DIM);
  const fc = Math.round((f.x0 + f.x1) / 2), fy = Math.round((f.y0 + f.y1) / 2);
  text(g, fc - 3, fy - 1, 'XILINX', MUTE);
  text(g, fc - 3, fy + 1, 'ARTIX-7', DIM);
  put(g, f.x0 + 3, f.y1 - 2, 'o', FAINT);
  // the flash beside it
  const fl = frameBox(g, X(7.9), Y(6.3), X(8.75), Y(5.55), DIM);
  put(g, fl.x0 + 1, fl.y1, '.', FAINT);
  // pmod headers on both sides, twelve pins each
  for (const [u0, u1] of [[0.18, 0.98], [11.12, 11.92]]) {
    for (const [w0, w1] of [[1.55, 3.75], [4.05, 6.25]]) {
      const h = frameBox(g, X(u0), Y(w1), X(u1), Y(w0), MUTE);
      const pins = 6, span = h.y1 - h.y0 - 1;
      for (let k = 0; k < pins; k++) {
        const y = h.y0 + 1 + Math.round((k + 0.5) * span / pins);
        put(g, h.x0 + 2, y, 'o', DIM);
        put(g, h.x1 - 2, y, 'o', DIM);
      }
    }
  }
  // the display: four digits in their window, the left one an[3]
  const dsp = frameBox(g, X(4.15), Y(3.6), X(7.55), Y(2.2), MUTE);
  const dw = (dsp.x1 - dsp.x0 - 2) / 4;
  const segs = st.sw & 0x7f;
  for (let d = 0; d < 4; d++) {
    const on = (st.sw >> (15 - d)) & 1;
    drawDigit(g, Math.round(dsp.x0 + 2 + d * dw + (dw - 8) / 2), Math.round((dsp.y0 + dsp.y1) / 2) - 3, segs, on);
  }
  // the five buttons in their cross
  const BT = [[0, 0], [-1.0, 0], [1.0, 0], [0, 0.95], [0, -0.95]];
  st.btnBox = [];
  BT.forEach(([du, dw2], bi) => {
    const u = 9.55 + du, w = 3.3 + dw2;
    const b = frameBox(g, X(u - 0.28), Y(w + 0.28), X(u + 0.28), Y(w - 0.28), st.btn[bi] ? INK : MUTE);
    put(g, Math.round((b.x0 + b.x1) / 2), b.y1 - 1 + (st.btn[bi] ? 1 : 0) - (b.y1 - b.y0 > 2 ? 0 : 0), st.btn[bi] ? '@' : 'o', st.btn[bi] ? INK : MUTE);
    st.btnBox[bi] = b;
  });
  text(g, Math.round(X(9.55)) - 1, Math.round(Y(4.78)), 'BTNU', FAINT);
  text(g, Math.round(X(1.6)), Math.round(Y(3.2)), 'BASYS 3', INK);
  // sixteen leds and the sixteen switches under them, sw15 on the left
  st.swBox = []; st.ledBox = [];
  for (let i = 0; i < 16; i++) {
    const u = 0.95 + (15 - i) * 0.64 + 0.23;
    const art = switchArt(st.lever[i], small);
    const sx0 = Math.round(X(u) - art[0].length / 2 + 0.5), sy0 = Math.round(Y(1.12));
    art.forEach((r, j) => text(g, sx0, sy0 + j, r, MUTE));
    // the lever brighter than its body
    art.forEach((r, j) => {
      const k = r.indexOf('#');
      if (k >= 0) {
        put(g, sx0 + k, sy0 + j, '#', INK);
      }
    });
    st.swBox[i] = [sx0, sy0, art[0].length, art.length];
    const lit = (st.sw >> i) & 1;
    const lx = Math.round(X(u)) - 1, ly = Math.round(Y(1.62));
    text(g, lx, ly, lit ? '(@)' : '(.)', lit ? LED : FAINT);
    st.ledBox[i] = [lx, ly, 3, 1];
    const n = String(i);
    text(g, Math.round(X(u) - n.length / 2 + 0.5), sy0 + art.length, n, FAINT);
  }
  // the prog cable leaves the port upward: this board was just flashed
  const px = (usb.x0 + usb.x1) / 2;
  stroke(g, [[px, usb.y0 - 0.2], [px - 0.2, usb.y0 - 1.6], [px + 1.4, usb.y0 - 3.2], [px + 2.6, -1.5]], MUTE, false, 40, true);
}

function startBoard(opts) {
  const pre = opts.pre, layer = opts.layer, readout = opts.readout;
  // the rightmost digit on, showing a 3: sw12, and segments a b c d g
  const state = { sw: (1 << 12) | 0x4f, btn: [0, 0, 0, 0, 0], lever: new Array(16).fill(0), power: 1 };
  for (let i = 0; i < 16; i++) {
    state.lever[i] = (state.sw >> i) & 1 ? 3 : 0;
  }
  let L = null, geo = null;
  const els = { sw: [], led: [], dig: [], btn: [] };

  function draw() {
    const g = makeGrid(L.cols, L.rows);
    drawBoardFlat(g, state, L, geo.small);
    pre.innerHTML = toHTML(g);
    if (readout) {
      const b = (v, n) => v.toString(2).padStart(n, '0');
      const s16 = b(state.sw, 16);
      const nib = s => s.slice(0, 4) + ' ' + s.slice(4, 8) + ' ' + s.slice(8, 12) + ' ' + s.slice(12);
      readout.sw.textContent = nib(s16);
      readout.led.textContent = nib(s16);
      readout.seg.textContent = b(~state.sw & 0x7f, 7);
      readout.an.textContent = b((~state.sw >> 12) & 0xf, 4);
    }
    if (opts.onChange) {
      opts.onChange(state);
    }
  }

  // targets: a cell box in css pixels, grown to the step between two switches
  const place = (el, [x, y, w, h], padX, padY) => {
    el.style.left = (x * geo.cw - padX) + 'px';
    el.style.top = (y * geo.lh - padY) + 'px';
    el.style.width = (w * geo.cw + 2 * padX) + 'px';
    el.style.height = (h * geo.lh + 2 * padY) + 'px';
  };

  function build() {
    layer.innerHTML = '';
    els.sw = []; els.led = []; els.dig = []; els.btn = [];
    const pitch = 0.64 * L.sx * geo.cw;
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('button');
      s.className = 'sw';
      s.type = 'button';
      s.dataset.i = i;
      s.setAttribute('aria-label', 'sw' + i);
      const bx = state.swBox[i];
      place(s, [bx[0], bx[1], bx[2], bx[3] + 1], Math.max(0, (pitch - bx[2] * geo.cw) / 2 - 1), geo.lh * 0.5);
      layer.appendChild(s);
      els.sw[i] = s;
      const e = document.createElement('button');
      e.className = 'led';
      e.type = 'button';
      e.dataset.i = i;
      e.setAttribute('aria-label', 'led' + i);
      const lb = state.ledBox[i];
      place(e, lb, Math.max(0, (pitch - lb[2] * geo.cw) / 2 - 1), Math.max(geo.lh * 1.3, 16));
      layer.appendChild(e);
      els.led[i] = e;
    }
    // a digit clicked turns itself on or off: it flips its anode switch
    const dsp = [L.X(4.15), L.Y(3.6), L.X(7.55), L.Y(2.2)].map(Math.round);
    const dw = (dsp[2] - dsp[0]) / 4;
    for (let d = 0; d < 4; d++) {
      const b = document.createElement('button');
      b.className = 'dig';
      b.type = 'button';
      b.dataset.i = 15 - d;
      b.setAttribute('aria-label', ((window.HOME && window.HOME.digit) || 'digit') + ' ' + (3 - d) + ', sw' + (15 - d));
      place(b, [dsp[0] + d * dw, dsp[1], dw, dsp[3] - dsp[1] + 1], 0, 0);
      layer.appendChild(b);
      els.dig[d] = b;
    }
    ['btnC', 'btnL', 'btnR', 'btnU', 'btnD'].forEach((name, bi) => {
      const bx = state.btnBox[bi];
      const bt = document.createElement('button');
      bt.className = 'btn';
      bt.type = 'button';
      bt.dataset.b = bi;
      bt.setAttribute('aria-label', name);
      place(bt, [bx.x0, bx.y0, bx.x1 - bx.x0 + 1, bx.y1 - bx.y0 + 1], geo.cw, geo.lh * 0.4);
      layer.appendChild(bt);
      els.btn[bi] = bt;
    });
    aria();
  }

  function aria() {
    for (let i = 0; i < 16; i++) {
      const on = (state.sw >> i) & 1 ? 'true' : 'false';
      els.sw[i].setAttribute('aria-pressed', on);
      els.led[i].setAttribute('aria-pressed', on);
    }
  }

  // the lever slides one row a frame, three frames a flip; the contact, and with it the
  // led, changes when the lever crosses the middle of the slot
  const timers = [];
  function flip(i, from) {
    const goal = state.lever[i] >= 2 ? 0 : 3;
    clearInterval(timers[i]);
    const set = () => {
      const was = (state.sw >> i) & 1;
      state.sw = state.lever[i] >= 2 ? state.sw | (1 << i) : state.sw & ~(1 << i);
      draw();
      aria();
      if (((state.sw >> i) & 1) !== was && opts.onFlip) {
        opts.onFlip(i, (state.sw >> i) & 1, from);
      }
    };
    if (opts.reduce()) {
      state.lever[i] = goal;
      set();
      return;
    }
    const step = () => {
      state.lever[i] += Math.sign(goal - state.lever[i]);
      set();
      if (state.lever[i] === goal) {
        clearInterval(timers[i]);
      }
    };
    step();
    timers[i] = setInterval(step, 45);
  }

  layer.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || t.classList.contains('btn')) {
      return;
    }
    flip(+t.dataset.i, t.classList.contains('led') ? 'led' : t.classList.contains('dig') ? 'digit' : 'switch');
  });
  const press = (bi, v) => {
    if (state.btn[bi] !== v) {
      state.btn[bi] = v;
      draw();
    }
  };
  layer.addEventListener('pointerdown', e => {
    const t = e.target.closest('button.btn');
    if (t) {
      press(+t.dataset.b, 1);
    }
  });
  const upAll = () => {
    for (let bi = 0; bi < 5; bi++) {
      press(bi, 0);
    }
  };
  addEventListener('pointerup', upAll);
  addEventListener('pointercancel', upAll);
  layer.addEventListener('keydown', e => {
    const t = e.target.closest('button.btn');
    if (t && (e.key === ' ' || e.key === 'Enter')) {
      press(+t.dataset.b, 1);
    }
  });
  layer.addEventListener('keyup', e => {
    const t = e.target.closest('button.btn');
    if (t) {
      press(+t.dataset.b, 0);
    }
  });

  function size(g2) {
    geo = g2;
    L = boardLayout(g2.cols, g2.mobile);
    draw();
    build();
    return L;
  }

  window.__board = { state, flip };
  // the left pmod header in page coordinates: where the trace leaves the board
  const pmod = () => {
    const r = pre.getBoundingClientRect();
    return { x: r.left + L.X(0.18) * geo.cw, y: r.top + scrollY + L.Y(2.65) * geo.lh };
  };
  return { size, rowsFor: (cols, mobile) => boardLayout(cols, mobile).rows, layout: () => L, pmod };
}
