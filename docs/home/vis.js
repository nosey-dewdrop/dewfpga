// *-*-*-*-*-*-*-*-*-*-*-* the pictures beside the flow *-*-*-*-*-*-*-*-*-*-*-*
// under the caption of each step, in the part of the frame the laptop and the board leave
// empty, a small drawing of what that step really does, in the step's own colour:
// write, vs code's run on basys3 button (the colours of the syntax); simulate, an error as a
// sticky note (amber); waveform, the browser's wave window (its green and its yellow cursor);
// flash, the chain of tools from .sv to the board, then the inside of the artix-7 (the done
// led's green). each is a function of the scroll, like the flow, so scrolling back runs it back.

function visBox(g, x0, y0, x1, y1, cls) {
  for (let x = x0 + 1; x < x1; x++) {
    put(g, x, y0, '_', cls);
    put(g, x, y1, '_', cls);
  }
  for (let y = y0 + 1; y <= y1; y++) {
    put(g, x0, y, '|', cls);
    put(g, x1, y, '|', cls);
  }
}

// a line of systemverilog in the editor's colours: keywords, types and widths, comments
const SV_KW = /^(module|endmodule|input|output|assign|always_comb|begin|end)$/;
function svLine(g, x, y, line, w) {
  line = line.slice(0, w);
  const c = line.indexOf('//');
  const code = c < 0 ? line : line.slice(0, c);
  const re = /[A-Za-z_][A-Za-z0-9_]*|\[[0-9:]+\]|\S/g;
  let m;
  while ((m = re.exec(code))) {
    const t = m[0];
    const cls = SV_KW.test(t) ? KWD : t === 'logic' || t[0] === '[' ? TYP : /^[A-Za-z_]/.test(t) ? MUTE : DIM;
    text(g, x + m.index, y, t, cls);
  }
  if (c >= 0) {
    text(g, x + c, y, line.slice(c), FAINT);
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* write: vs code and its run on basys3 button *-*-*-*-*-*-*-*-*-*-*-*
// the file the extension's new design starts with, the play button above it; pressed, the
// terminal says what the extension says, and the done led of the board on its cable lights
const VS_CODE = [
  '// Write your circuit here, save, then Run on Basys3 (the play button above this file).',
  '// No .xdc and no Makefile: these port names are pinned automatically:',
  '//   sw[15:0] led[15:0] btnC btnU btnD btnL btnR clk (100 MHz) seg[6:0] dp an[3:0]',
  'module top(',
  '  input  logic [15:0] sw,',
  '  output logic [15:0] led',
  ');',
  '  assign led = sw;',
  'endmodule',
];
const VIS_D = { cols: 82, rows: 17 };
function drawVSCode(g, k) {
  const x1 = 55;
  // the window: the tab of the file and the play button over it, the file, the terminal
  text(g, 1, 0, '_'.repeat(x1 - 1), DIM);
  visBox(g, 0, 0, x1, 15, DIM);
  text(g, 2, 1, 'o o o', DIM);
  text(g, 9, 1, '|', DIM);
  text(g, 11, 1, 'top.sv', INK);
  text(g, 19, 1, 'x', FAINT);
  text(g, 21, 1, '|', DIM);
  text(g, 1, 2, '_'.repeat(8) + '|', DIM);
  text(g, 21, 2, '|' + '_'.repeat(x1 - 22), DIM);
  const hover = k > 0.4, pressed = k > 0.58 && k < 0.7, ran = k > 0.64, done = k > 0.84;
  const bx = x1 - 10;
  text(g, bx, 1, pressed ? '[|>]' : ' |> ', pressed || hover ? INK : MUTE);
  text(g, bx + 6, 1, '...', FAINT);
  VS_CODE.forEach((l, i) => {
    text(g, 2, 3 + i, String(i + 1).padStart(2, ' '), FAINT);
    svLine(g, 6, 3 + i, l, x1 - 7);
  });
  text(g, 1, 12, '_'.repeat(x1 - 1), DIM);
  text(g, 3, 13, 'terminal', FAINT);
  if (ran) {
    text(g, 14, 13, 'Run on Basys3', MUTE);
    text(g, 3, 14, done ? 'Done: top.sv is on the Basys3.' : 'dewfpga run top.sv', done ? INK : DIM);
  }
  // the play button's tooltip while the pointer rests on it
  if (hover && !ran) {
    const tip = 'dewfpga: Run on Basys3', tx = x1 - tip.length - 5;
    for (let y = 2; y <= 5; y++) {
      for (let x = tx; x <= tx + tip.length + 3; x++) {
        put(g, x, y, ' ', 0);
      }
    }
    text(g, tx + 1, 2, '_'.repeat(tip.length + 2), DIM);
    visBox(g, tx, 2, tx + tip.length + 3, 4, DIM);
    text(g, tx + 2, 3, tip, INK);
  }
  // the board, its prog port on the cable that sags out of the side of the window
  const b0 = 64;
  text(g, b0 + 1, 9, '_'.repeat(16), DIM);
  visBox(g, b0, 9, b0 + 17, 15, DIM);
  text(g, b0 + 10, 10, 'BASYS3', FAINT);
  text(g, b0 - 1, 11, '[=]', MUTE);
  text(g, b0 + 3, 11, 'PROG', FAINT);
  text(g, b0 + 3, 13, done ? '*' : '.', done ? LED : DIM);
  text(g, b0 + 5, 13, 'DONE', done ? MUTE : FAINT);
  stroke(g, catmullV([[x1 + 1, 13.6], [x1 + 3, 15.3], [x1 + 5.5, 15.5], [b0 - 3.4, 13.4], [b0 - 2, 11.6]], 6), DIM, false, 52, true);
}

// *-*-*-*-*-*-*-*-*-*-*-* simulate: an error on a sticky note *-*-*-*-*-*-*-*-*-*-*-*
// what dewfpga sim prints when a line of the testbench misses its ;  (test/run.sh checks
// this line word for word), wrapped on a note, the end of its link under it
const NOTE_LINES = [
  ['blink_tb.sv:36: syntax error', DIM],
  ['blink_tb.sv:35: ERROR [iverilog-refused]:', INK],
  ['iverilog cannot compile this code (its', MUTE],
  ['message is above).', MUTE],
  null,
  ['Fix: end blink_tb.sv:35 with ; (iverilog', INK],
  ['names blink_tb.sv:36, the line after it: a', MUTE],
  ['missing ; is reported where the next', MUTE],
  ['statement starts), then fix what is left.', MUTE],
  null,
  ['.../dewfpga/errors/iverilog-refused/', LINKC],
];
const VIS_G = { cols: 49, rows: 16 };
function drawNote(g, k) {
  const W = 47, y0 = k < 0.1 ? 1 : 0, yb = y0 + 14;
  // the tape that holds it, the note's edges, its corner folded
  text(g, 18, y0, '_'.repeat(12), FAINT);
  text(g, 17, y0 + 1, '[' + '_'.repeat(12) + ']', FAINT);
  text(g, 1, y0 + 1, '_'.repeat(16), PROMPTC);
  text(g, 31, y0 + 1, '_'.repeat(W - 31), PROMPTC);
  for (let y = y0 + 2; y <= yb; y++) {
    put(g, 0, y, '|', PROMPTC);
    if (y <= yb - 1) {
      put(g, W, y, '|', PROMPTC);
    }
  }
  text(g, W - 5, yb - 1, '_____', PROMPTC);
  text(g, 1, yb, '_'.repeat(W - 7), PROMPTC);
  put(g, W - 6, yb, '/', PROMPTC);
  // the lines come in as the terminal prints them
  const n = Math.ceil(NOTE_LINES.length * Math.min(1, k / 0.6));
  NOTE_LINES.slice(0, n).forEach((l, i) => {
    if (!l) {
      return;
    }
    const y = y0 + 3 + i;
    if (l[0].startsWith('Fix:')) {
      text(g, 2, y, 'Fix:', PROMPTC);
      text(g, 7, y, l[0].slice(5), l[1]);
    } else {
      text(g, 2, y, l[0], l[1]);
    }
  });
}

// *-*-*-*-*-*-*-*-*-*-*-* waveform: the browser's wave window *-*-*-*-*-*-*-*-*-*-*-*
// dewfpga sim top_monitor --wave=browser: vivado's layout, the scope pane, names and values,
// the black wave area with green traces and the yellow cursor whose values the value column
// shows. the stretch is top_monitor.vcd from 28240 to 28350 ns: en on, room 3, the sensors
// counting, so alarm follows sensor 3 and lamp 3 with it
const WAVE_T0 = 0xb04, WAVE_N = 12;
const VIS_B = { cols: 84, rows: 17 };
function drawWave(g, k) {
  const W = 83, H = 16, sx = 17, nx = 19, vx = 33, wx = 39, ww = W - wx - 1;
  text(g, 1, 0, '_'.repeat(W - 1), DIM);
  visBox(g, 0, 0, W, H, DIM);
  text(g, 2, 1, 'o o o', DIM);
  text(g, 9, 1, 'top_monitor.vcd - dewfpga waveform', MUTE);
  text(g, 1, 2, '_'.repeat(W - 1), DIM);
  text(g, 2, 3, 'Scope', FAINT);
  for (let y = 3; y < H; y++) {
    put(g, sx, y, '|', DIM);
    put(g, wx - 1, y, '|', DIM);
  }
  ['top_monitor_tb', ' dut', '  u_monitor', '   m_dec3_act', '   m_mux2_ena', '   m_mux8_sel'].forEach((s, i) => text(g, 2, 5 + i, s, i === 0 ? MUTE : FAINT));
  text(g, nx, 3, 'Name', FAINT);
  text(g, vx, 3, 'Value', FAINT);
  // the ruler, a time every 4 steps of 10 ns
  const step = ww / WAVE_N;
  for (let i = 0; i <= WAVE_N; i += 4) {
    const lbl = String((WAVE_T0 + i) * 10);
    text(g, Math.min(wx + ww - lbl.length, Math.round(wx + i * step) + (i ? 0 : 1)), 3, lbl, FAINT);
  }
  const cur = Math.min(WAVE_N - 1e-6, 0.5 + k * (WAVE_N - 1));
  const ci = Math.floor(cur);
  const sw = i => WAVE_T0 + i, room = i => (sw(i) >> 8) & 7, sens = i => sw(i) & 255;
  const alarm = i => ((sw(i) >> 11) & 1) && ((sens(i) >> room(i)) & 1) ? 1 : 0;
  const sig = [
    ['room[2:0]', room, 3], ['sensors[7:0]', sens, 8], ['alarm', alarm, 1], ['lamps[7:0]', i => (alarm(i) ? 1 << room(i) : 0), 8],
  ];
  const hex = (v, bits) => (bits < 8 ? String(v) : v.toString(16).padStart(2, '0'));
  sig.forEach(([name, f, bits], r) => {
    const y = 5 + r * 3;
    text(g, nx, y + 1, name, INK);
    text(g, vx, y + 1, hex(f(ci), bits), MUTE);
    for (let i = 0; i < WAVE_N; i++) {
      const a = Math.round(wx + i * step), b = Math.round(wx + (i + 1) * step);
      const val = f(i), changed = i > 0 && f(i - 1) !== val;
      if (bits === 1) {
        // a bit: high on the upper row, low on the lower, a stroke where it changes
        for (let x = a; x < b; x++) {
          put(g, x, val ? y : y + 1, '_', WAVE);
        }
        if (changed) {
          put(g, a, y + 1, '|', WAVE);
        }
      } else {
        // a bus: its two edges, crossed where the value changes, the value inside
        for (let x = a; x < b; x++) {
          put(g, x, y, '_', WAVE);
          put(g, x, y + 1, '_', WAVE);
        }
        if (i === 0 || changed) {
          put(g, a, y, ' ', 0);
          put(g, a, y + 1, i === 0 ? '<' : 'X', WAVE);
          const lbl = hex(val, bits);
          if (b - a > lbl.length) {
            text(g, a + 1, y + 1, lbl, WAVE);
          }
        }
      }
    }
  });
  // the cursor, a yellow line down the wave area, its time in a box at the top
  const cx = Math.round(wx + cur * step);
  for (let y = 5; y < H; y++) {
    put(g, cx, y, '|', CURS);
  }
  const tl = '[' + (sw(0) * 10 + Math.round(cur * 10)) + ' ns]';
  const tx = Math.max(wx, Math.min(wx + ww - tl.length, cx - Math.floor(tl.length / 2)));
  text(g, tx, 4, tl, CURS);
  text(g, 1, H, '_'.repeat(W - 1), DIM);
  return { wx: wx, wy: 4, ww: ww, wh: H - 4 };
}

// *-*-*-*-*-*-*-*-*-*-*-* flash: the chain of tools *-*-*-*-*-*-*-*-*-*-*-*
// every stage of a build has its own tool and dewfpga runs them one after the other: the
// chips light as the flash command's lines come, the trace between two of them carries the
// signal on. the last chip is the board, and its done led
const CHAIN = [['.sv', 'top_monitor'], ['yosys', 'synthesis'], ['nextpnr', 'place, route'], ['prjxray', 'bitstream'], ['openFPGALoader', 'usb jtag'], ['basys 3', '']];
const VIS_A = { cols: 104, rows: 10 };
function drawChain(g, s) {
  // how far the build has come, from the flash command's own lines
  const lit = s.done ? 6 : s.sram > 0 ? 5 : s.flashOut >= 2 ? 4 : s.flashOut >= 1 ? 3 : s.flash.done ? 1 : s.flash.text ? 1 : 0;
  const run = s.done ? 0 : s.sram > 0 ? s.sram : s.flashOut >= 1 ? 0.5 : s.flash.done ? 0.7 : 0;
  const offs = [1, 3, 2, 4, 2, 3];
  const ws = CHAIN.map(([n]) => Math.max(9, n.length + 5));
  const gap = Math.floor((VIS_A.cols - 2 - ws.reduce((a, b) => a + b, 0)) / (CHAIN.length - 1));
  let x = 1;
  const at = [];
  CHAIN.forEach(([n, sub], i) => {
    const w = ws[i], y = offs[i], on = i < lit;
    const cls = on ? LED : DIM;
    const pins = ' ' + Array.from({ length: Math.floor((w - 1) / 2) }, () => '| ').join('').slice(0, w - 1);
    text(g, x, y, pins, on ? LED : FAINT);
    text(g, x, y + 1, '.' + '-'.repeat(w - 2) + '.', cls);
    text(g, x, y + 2, '(', cls);
    put(g, x + w - 1, y + 2, '|', cls);
    text(g, x + 2, y + 2, n, on ? INK : MUTE);
    text(g, x, y + 3, '\'' + '-'.repeat(w - 2) + '\'', cls);
    text(g, x, y + 4, pins, on ? LED : FAINT);
    if (i === CHAIN.length - 1) {
      // the board's chip carries its done led
      text(g, x + 2, y + 5, s.done ? '*' : '.', s.done ? LED : DIM);
      text(g, x + 4, y + 5, 'DONE', FAINT);
    } else {
      text(g, x + Math.max(0, Math.round((w - sub.length) / 2)), y + 5, sub, FAINT);
    }
    at.push([x, y, w]);
    x += w + gap;
  });
  // the trace from each chip's right side to the next one's left, a 45 degree jog between rows
  for (let i = 0; i + 1 < at.length; i++) {
    const [x0, y0, w0] = at[i], [x1, y1] = at[i + 1];
    const ya = y0 + 2.5, yb = y1 + 2.5, a = x0 + w0, b = x1;
    const mid = (a + b) / 2, d = Math.abs(yb - ya) * 2;
    const pts = [[a, ya], [mid - d / 2, ya], [mid + d / 2, yb], [b, yb]];
    const cls = i + 1 < lit ? LED : TRACE;
    stroke(g, pts, cls, false, 62, false);
    // the signal on its way to the next chip
    if (i + 1 === lit && run > 0) {
      const t = Math.min(1, run);
      const px = Math.round(a + (b - a) * t);
      const py = px < mid - d / 2 ? ya : px > mid + d / 2 ? yb : ya + (yb - ya) * (px - (mid - d / 2)) / Math.max(1, d);
      const c = get(g, px, Math.floor(py));
      put(g, px, Math.floor(py), c === ' ' ? '_' : c, LED);
    }
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* flash, the end: inside the artix-7 *-*-*-*-*-*-*-*-*-*-*-*
// where nextpnr put top_monitor: its 13 luts in six slices at the die's left edge, x0 to x3,
// y11 to y20 (top_monitor_routed.json), out of 66 columns and 150 rows of slices; the switch
// pads they read and the led pads they drive. the die first, then the corner up close
const LUTS = [['X0Y20', 'ABCD'], ['X0Y17', 'AB'], ['X0Y12', 'A'], ['X1Y12', 'D'], ['X2Y11', 'ABCD'], ['X3Y11', 'C']];
const VIS_C = { cols: 86, rows: 17 };
function drawDie(g, k) {
  // the die: slices as dots, two block ram columns, the corner the design uses lit
  const D = { x: 62, y: 1, w: 22, h: 12 };
  text(g, D.x + 1, D.y - 1, '_'.repeat(D.w - 1), DIM);
  visBox(g, D.x, D.y - 1, D.x + D.w, D.y + D.h, DIM);
  for (let y = 1; y < D.h; y += 2) {
    for (let x = 2; x < D.w - 1; x += 3) {
      put(g, D.x + x, D.y + y, '.', FAINT);
    }
  }
  for (const bx of [8, 15]) {
    for (let y = 1; y < D.h; y++) {
      put(g, D.x + bx, D.y + y, ':', FAINT);
    }
  }
  text(g, D.x + 1, D.y + D.h + 1, 'xc7a35t', FAINT);
  const cy = D.y + D.h - 2;
  text(g, D.x + 1, cy, '##', k > 0.05 ? LED : MUTE);
  // the close view of that corner, joined to it by the two lines of a lens
  const Z = { x: 0, y: 0, w: 51, h: 15 };
  const kz = span(k, [0.12, 0.3]);
  if (kz > 0) {
    const ends = [[Z.x + Z.w + 0.5, Z.y + 0.6], [Z.x + Z.w + 0.5, Z.y + Z.h + 0.4]];
    [[D.x - 0.2, cy + 0.2], [D.x - 0.2, cy + 0.9]].forEach(([x0, y0], i) => {
      const [x1, y1] = ends[i];
      stroke(g, [[x0, y0], [x0 + (x1 - x0) * kz, y0 + (y1 - y0) * kz]], FAINT, false, 62, false);
    });
  }
  if (k < 0.3) {
    return;
  }
  text(g, Z.x + 1, Z.y, '_'.repeat(Z.w - 1), DIM);
  visBox(g, Z.x, Z.y, Z.x + Z.w, Z.y + Z.h, DIM);
  const colX = sx => Z.x + 8 + sx * 9, rowY = sy => Z.y + 2 + (21 - sy);
  text(g, 2, 1, 'io', FAINT);
  for (let sx = 0; sx < 4; sx++) {
    text(g, colX(sx) + 2, 1, 'x' + sx, FAINT);
  }
  // the luts light in the order nextpnr lists them
  const nOn = Math.round(13 * span(k, [0.35, 0.75]));
  let n = 0;
  const lit = {};
  for (const [site, luts] of LUTS) {
    for (const l of luts) {
      lit[site + l] = ++n <= nOn;
    }
  }
  for (let sy = 21; sy >= 10; sy--) {
    const y = rowY(sy);
    for (let sx = 0; sx < 4; sx++) {
      const site = 'X' + sx + 'Y' + sy, x = colX(sx), used = LUTS.find(([s2]) => s2 === site);
      if (!used) {
        text(g, x + 1, y, '.  .', FAINT);
        continue;
      }
      put(g, x, y, '[', DIM);
      'ABCD'.split('').forEach((l, i) => {
        const has = used[1].includes(l);
        put(g, x + 1 + i, y, has ? l : '.', has ? (lit[site + l] ? LED : MUTE) : FAINT);
      });
      put(g, x + 5, y, ']', DIM);
    }
    if (LUTS.some(([s2]) => s2.endsWith('Y' + sy))) {
      text(g, colX(3) + 7, y, 'y' + sy, FAINT);
    }
  }
  // the pads at this edge and their nets: three lamps out of the top slices, two sensors
  // into x2; the room bits come down from the bank on the far side of the die
  const on = k > 0.8, nc = on ? LED : TRACE;
  for (const sy of [20, 19, 18, 11, 10]) {
    put(g, 2, rowY(sy), 'o', on ? MUTE : DIM);
  }
  const hline = (y, a, b) => {
    for (let x = a; x <= b; x++) {
      put(g, x, y, '-', nc);
    }
  };
  hline(rowY(20), 3, colX(0) - 1);
  hline(rowY(19), 3, colX(0) - 3);
  put(g, colX(0) - 2, rowY(19), '/', nc);
  hline(rowY(18), 3, colX(0) - 3);
  put(g, colX(0) - 2, rowY(18), '\\', nc);
  hline(rowY(11), 3, colX(2) - 1);
  hline(rowY(10), 3, colX(2) - 3);
  put(g, colX(2) - 2, rowY(10), '/', nc);
  const bus = colX(3) + 11;
  text(g, bus - 4, 1, 'sw[10:8]', FAINT);
  for (let y = 2; y < rowY(11); y++) {
    put(g, bus, y, '|', nc);
  }
  put(g, bus, rowY(11), '\'', nc);
  hline(rowY(11), colX(3) + 6, bus - 1);
  put(g, colX(3) + 7, rowY(11), '-', nc);
  text(g, colX(3) + 7, rowY(11), '----', nc);
  if (nOn >= 13) {
    text(g, Z.x + 2, Z.y + Z.h + 1, 'top_monitor  13 LUT', on ? INK : MUTE);
  }
}

function catmullV(P, n) {
  const out = [];
  const Q = [P[0]].concat(P, [P[P.length - 1]]);
  for (let i = 1; i + 2 < Q.length; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// the pictures, each with the stretch of the scroll it lives in, and its region in the frame
const VIS = [
  { id: 'd', spec: VIS_D, span: [0.07, 0.255], k: p => span(p, [0.07, 0.24]), draw: (g, k) => drawVSCode(g, k) },
  { id: 'g', spec: VIS_G, span: [0.255, 0.415], k: p => span(p, [0.27, 0.4]), draw: (g, k) => drawNote(g, k), href: '/dewfpga/errors/iverilog-refused/' },
  { id: 'b', spec: VIS_B, span: [0.415, 0.615], k: p => span(p, [0.45, 0.6]), draw: (g, k) => drawWave(g, k), black: true },
  { id: 'a', spec: VIS_A, span: [0.615, 0.79], k: p => p, draw: (g, k, s) => drawChain(g, s) },
  { id: 'c', spec: VIS_C, span: [0.9, 1.01], k: p => span(p, [0.925, 0.995]), draw: (g, k) => drawDie(g, k) },
];

function startVis(root) {
  const els = VIS.map(v => {
    const wrap = document.createElement(v.href ? 'a' : 'div');
    wrap.className = 'vis';
    wrap.dataset.v = v.id;
    const pre = document.createElement('pre');
    if (v.href) {
      wrap.href = v.href;
      wrap.tabIndex = -1;
      wrap.setAttribute('aria-label', (window.HOME && window.HOME.note) || v.href);
      pre.setAttribute('aria-hidden', 'true');
    } else {
      wrap.setAttribute('aria-hidden', 'true');
    }
    if (v.black) {
      const bk = document.createElement('div');
      bk.className = 'bk';
      wrap.appendChild(bk);
    }
    wrap.appendChild(pre);
    root.appendChild(wrap);
    return { v, wrap, pre, last: null, ok: false };
  });
  let adv = 0.6;

  // regions: [{ x, y, w, h }] per picture, in the stage's frame. each takes the largest size
  // that fits, up to 11 px; when one of them would be smaller than 8 px none is drawn, so the
  // steps keep one look
  function size(regions, a) {
    adv = a;
    const fss = els.map((e, i) => {
      const r = regions[i];
      return r ? Math.min(11, r.w / (e.v.spec.cols * adv), r.h / (e.v.spec.rows * 1.16)) : 0;
    });
    const all = fss.every(f => f >= 8);
    els.forEach((e, i) => {
      const r = regions[i], fs = fss[i];
      e.ok = all;
      e.wrap.style.display = all ? '' : 'none';
      if (!all) {
        return;
      }
      e.fs = fs;
      e.wrap.dataset.fs = fs.toFixed(2);
      e.wrap.style.left = r.x + 'px';
      e.wrap.style.top = r.y + 'px';
      setGrid(e.pre, e.v.spec.cols, e.v.spec.rows, fs, adv);
      e.last = null;
    });
  }

  function draw(p, s, capO) {
    for (const e of els) {
      if (!e.ok) {
        continue;
      }
      const [a, b] = e.v.span;
      const o = Math.min(span(p, [a, a + 0.012]), 1 - span(p, [b - 0.012, b])) * capO;
      e.wrap.style.opacity = o.toFixed(3);
      e.wrap.style.visibility = o < 0.01 ? 'hidden' : 'visible';
      if (e.v.href) {
        e.wrap.tabIndex = o > 0.5 ? 0 : -1;
      }
      if (o < 0.01) {
        continue;
      }
      const k = e.v.k(p);
      const key = e.v.id === 'a' ? [s.flash.text.length, s.flashOut, Math.round(s.sram * 40), s.done].join() : Math.round(k * 400);
      if (key === e.last) {
        continue;
      }
      e.last = key;
      const g = makeGrid(e.v.spec.cols, e.v.spec.rows);
      const box = e.v.draw(g, k, s);
      e.pre.innerHTML = toHTML(g);
      if (box && e.v.black) {
        const bk = e.wrap.querySelector('.bk'), cw = adv * e.fs, lh = e.fs * 1.16;
        bk.style.cssText = 'left:' + (box.wx * cw) + 'px;top:' + (box.wy * lh) + 'px;width:' + (box.ww * cw) + 'px;height:' + (box.wh * lh) + 'px';
      }
    }
  }

  function hide() {
    els.forEach(e => {
      e.wrap.style.display = 'none';
      e.ok = false;
    });
  }

  return { size, draw, hide };
}
