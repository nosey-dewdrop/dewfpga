// *-*-*-*-*-*-*-*-*-*-*-* models *-*-*-*-*-*-*-*-*-*-*-*
// the desk in cm: an all-in-one mac, its keyboard and mouse, a basys 3 on its usb cable.
// x right, y up, z away from the viewer; the desk top is y = 0.

// a frame whose axes are the camera's: the screen built in it stays a flat rectangle
function camFrame(cam, o) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  // inverse of the camera rotation: camera axes written in world coordinates
  const R = [cy, 0, -sy], U = [sy * sp, cp, cy * sp], F = [sy * cp, -sp, cy * cp];
  const fix = (a, b) => [a[0], a[1], b];
  return p => [o[0] + R[0] * p[0] + U[0] * p[1] + F[0] * p[2],
               o[1] + R[1] * p[0] + U[1] * p[1] + F[1] * p[2],
               o[2] + R[2] * p[0] + U[2] * p[1] + F[2] * p[2]];
}

// *-*-*-*-*-*-*-*-*-*-*-* the mac *-*-*-*-*-*-*-*-*-*-*-*
// panel 54 x 34, a deep chin, a bent stand behind it. the screen faces the camera.
function addMac(sc, cam, o, opt) {
  const W = 54, H = 34, D = 1.6, chin = 5.2, side = 1.5, top = 1.7;
  const T = camFrame(cam, o);                 // o: the panel's bottom centre, front face
  const out = roundRect(W, H, 2.2, 5).map(([u, v]) => [u - W / 2, v]);
  const front = out.map(([u, v]) => T([u, v, 0]));
  const back = out.map(([u, v]) => T([u, v, D]));
  // the rim: one face per outline segment, so the side shows its thickness
  walls(sc, front, back, T([0, H / 2, D / 2]), { cls: DIM });
  sc.face(front, { cls: INK, bias: -0.05, twoSided: true });
  // the screen and the chin line, drawn on the front plane
  const sx0 = -W / 2 + side, sx1 = W / 2 - side, sy0 = chin, sy1 = H - top;
  const scr = [[sx0, sy1], [sx1, sy1], [sx1, sy0], [sx0, sy0]].map(([u, v]) => T([u, v, -0.01]));
  sc.face(scr, { cls: MUTE, bias: -0.1, twoSided: true });
  // the camera dot on the top bezel
  sc.label(T([0, H - top / 2 - 0.3, -0.02]), '.', { cls: DIM, bias: -0.12 });
  // stand: a slim column from the back of the panel down to a round foot
  const yawR = place([0, 0, 0], cam.yaw);
  const at = (u, y, z) => {
    const p = yawR([u, y, z]);
    return [o[0] + p[0], p[1], o[2] + p[2]];
  };
  const cw = 3.2, cz = 7.5;
  const c0 = T([-cw, 13, D]), c1 = T([cw, 13, D]);
  sc.face([c0, c1, at(cw, 0.9, cz), at(-cw, 0.9, cz)], { cls: MUTE, twoSided: true, bias: 0.4, skip: [0, 2] });
  // the foot: an oval plate; its top outline, and the near half of its lower edge
  const ov = ellipse(12.5, 7.5, 64);
  const ft = ov.map(([u, v]) => at(u, 0.9, v + cz - 1));
  sc.face(ft, { cls: MUTE, twoSided: true, bias: 1.2, curve: true });
  return { screen: scr, T, W, H };
}

// *-*-*-*-*-*-*-*-*-*-*-* the macbook *-*-*-*-*-*-*-*-*-*-*-*
// o: the front centre of the base on the desk. the lid stands on the hinge, tilted
// back so the screen faces the camera and stays a flat rectangle.
function addLaptop(sc, cam, o, opt) {
  const W = 30.4, Db = 21.5, hb = 1.5;
  const T = place(o, cam.yaw);
  const x0 = -W / 2;
  // the base
  sc.group(T([0, hb, Db / 2]));
  const rr = roundRect(W, Db, 1.0, 3);
  const topP = rr.map(([a, b]) => T([a + x0, hb, b]));
  const lowP = rr.map(([a, b]) => T([a + x0 + (a < W / 2 ? 0.3 : -0.3), 0, b + (b < Db / 2 ? 0.3 : -0.3)]));
  sc.face(topP.slice().reverse(), { cls: INK, twoSided: true, bias: 30 });
  walls(sc, topP, lowP, T([0, hb / 2, Db / 2]), { cls: MUTE, bias: 29 });
  // the keys sit in the back half, the trackpad in front of them
  const keys = addKeys(sc, T, x0 + 1.7, Db - 1.4 - (5 * 1.86 + 0.95), () => hb, Object.assign({ kh: 0.12 }, opt));
  const tp = roundRect(15.5, 9.0, 0.7, 2).map(([a, b]) => T([a - 7.75, hb + 0.01, b + 0.9]));
  sc.face(tp.slice().reverse(), { cls: MUTE, twoSided: true, bias: 5 });
  // the thumb notch on the front edge
  sc.line([T([-3.2, hb, 0.02]), T([-2.2, hb - 0.35, 0.0]), T([2.2, hb - 0.35, 0.0]), T([3.2, hb, 0.02])], { cls: DIM, bias: -2, curve: true });
  sc.group(null);
  // the lid
  const hinge = T([0, hb, Db - 0.2]);
  const L = camFrame(cam, hinge);
  const Wl = W, Hl = 21.0, Dl = 0.55;
  const out = roundRect(Wl, Hl, 1.0, 4).map(([u, v]) => [u - Wl / 2, v]);
  const front = out.map(([u, v]) => L([u, v, 0]));
  const back = out.map(([u, v]) => L([u, v, Dl]));
  walls(sc, front, back, L([0, Hl / 2, Dl / 2]), { cls: DIM });
  sc.face(front, { cls: INK, bias: -0.05, twoSided: true });
  const sx0 = -Wl / 2 + 0.9, sx1 = Wl / 2 - 0.9, sy0 = 1.3, sy1 = Hl - 0.8;
  const scr = [[sx0, sy1], [sx1, sy1], [sx1, sy0], [sx0, sy0]].map(([u, v]) => L([u, v, -0.01]));
  sc.face(scr, { cls: MUTE, bias: -0.1, twoSided: true });
  // the notch, a small dark tab hanging from the top of the screen
  const notch = [[-1.6, sy1 + 0.02], [1.6, sy1 + 0.02], [1.4, sy1 - 0.6], [-1.4, sy1 - 0.6]].map(([u, v]) => L([u, v, -0.03]));
  return { screen: scr, T: L, base: T, keys, W, port: T([W / 2 + 0.1, 0.75, 4.2]), notch };
}

// *-*-*-*-*-*-*-*-*-*-*-* the note on the bezel *-*-*-*-*-*-*-*-*-*-*-*
// a paper square stuck on the mac's chin, a little crooked; the site's whole
// promise, written by hand
function addNote(sc, mac, opt) {
  const T = mac.T, W = mac.W;
  const cx = W / 2 - 7.5, cy = 2.55, s = 2.15, r = 0.09;
  const P = [[-s * 1.25, s], [s * 1.25, s], [s * 1.25, -s], [-s * 1.25, -s]].map(([u, v]) => {
    const c = Math.cos(r), n = Math.sin(r);
    return T([cx + c * u - n * v, cy + n * u + c * v, -0.08]);
  });
  sc.face(P, { cls: MUTE, twoSided: true, bias: -0.5 });
  sc.custom(T([cx, cy, -0.1]), (g, p) => {
    text(g, Math.round(p[0] - 4), Math.floor(p[1]) - 1, 'no vivado', INK);
    text(g, Math.round(p[0] + 2), Math.floor(p[1]) + 1, '<3', ACC);
  }, { bias: -0.6 });
}

// *-*-*-*-*-*-*-*-*-*-*-* keyboard *-*-*-*-*-*-*-*-*-*-*-*
const KB_ROWS = [
  // front to back: [label, width in keys]
  [['fn', 1], ['ctrl', 1], ['opt', 1], ['cmd', 1.25], [' ', 5], ['cmd', 1.25], ['opt', 1], ['<', 1], ['^', 1], ['>', 1]],
  [['shift', 2.25], ['z', 1], ['x', 1], ['c', 1], ['v', 1], ['b', 1], ['n', 1], ['m', 1], [',', 1], ['.', 1], ['/', 1], ['shift', 2.25]],
  [['caps', 1.75], ['a', 1], ['s', 1], ['d', 1], ['f', 1], ['g', 1], ['h', 1], ['j', 1], ['k', 1], ['l', 1], [';', 1], ['\'', 1], ['return', 1.75]],
  [['tab', 1.5], ['q', 1], ['w', 1], ['e', 1], ['r', 1], ['t', 1], ['y', 1], ['u', 1], ['i', 1], ['o', 1], ['p', 1], ['[', 1], [']', 1], ['\\', 1]],
  [['`', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['-', 1], ['=', 1], ['del', 1.5]],
  [['esc', 1.5], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['', 1], ['o', 1]],
];

// the caps, row by row from the front; each cap is its top face, a pressed cap sinks
function addKeys(sc, T, xs, zs, hAt, opt) {
  const u = (opt && opt.u) || 1.86, gap = 0.04, rowD = [u, u, u, u, u, u * 0.51];
  const keys = {};
  const pressed = (opt && opt.pressed) || {};
  const kh = (opt && opt.kh) || 0.32;
  let z = zs;
  KB_ROWS.forEach((row, ri) => {
    let x = xs;
    const d = rowD[ri];
    row.forEach(([label, w], ki) => {
      // a cap shares its left edge with its neighbour and its back edge with the row
      // behind, so those are drawn once, by the neighbour and by the row behind
      const skip = [].concat(ki > 0 ? [3] : [], ri < KB_ROWS.length - 1 ? [0] : []);
      const kw = w * u;
      const a = x + gap / 2, b = x + kw - gap / 2, c = z + gap / 2, e = z + d - gap / 2;
      const p = pressed[label] || 0;
      const cap = (c0, e0) => {
        const h0 = hAt(c0) + kh * (1 - 0.85 * p), h1 = hAt(e0) + kh * (1 - 0.85 * p);
        return [T([a, h0, c0]), T([b, h0, c0]), T([b, h1, e0]), T([a, h1, e0])].reverse();
      };
      if (label === '^') {
        const mid = (c + e) / 2;
        sc.face(cap(c, mid - gap / 4), { cls: MUTE, twoSided: true, bias: 0.3, steep: 34, skip: [3] });
        sc.face(cap(mid + gap / 4, e), { cls: MUTE, twoSided: true, bias: 0.3, steep: 34, skip });
      } else {
        sc.face(cap(c, e), { cls: p > 0.3 ? INK : MUTE, twoSided: true, bias: 0.3, steep: 34, skip });
      }
      const show = label && label !== ' ' && label !== '^' && (label.length === 1 || (opt && opt.words));
      if (show) {
        const lz = (c + e) / 2, h = hAt(lz) + kh * (1 - 0.85 * p);
        sc.label(T([(a + b) / 2, h, lz]), label, { cls: p > 0.3 ? INK : DIM, bias: -10 });
      }
      keys[label] = keys[label] || { x: (a + b) / 2, z: (c + e) / 2 };
      x += kw;
    });
    z += d;
  });
  return keys;
}

function addKeyboard(sc, o, yaw, opt) {
  const u = 1.86;
  const W = 14.5 * u + 0.9, Dp = 5 * u + 0.95 + 1.0;
  const T = place(o, yaw);
  const hF = 0.5, hB = 1.1;                       // the wedge: thin at the front
  const hAt = z => hF + (hB - hF) * (z / Dp);
  const x0 = -W / 2;
  sc.group(T([0, hB, Dp / 2]));
  // the body: the top plate, then its rim down to the desk
  const rr = roundRect(W, Dp, 0.6, 2);
  const topPts = rr.map(([a, b]) => T([a + x0, hAt(b), b]));
  const lowPts = rr.map(([a, b]) => T([a + x0, 0, b]));
  sc.face(topPts.slice().reverse(), { cls: INK, twoSided: true, bias: 30 });
  walls(sc, topPts, lowPts, T([0, 0.3, Dp / 2]), { cls: INK, bias: 29 });
  const keys = addKeys(sc, T, x0 + 0.45, 0.5, hAt, opt);
  sc.group(null);
  return { T, keys, W, Dp };
}

// *-*-*-*-*-*-*-*-*-*-*-* mouse *-*-*-*-*-*-*-*-*-*-*-*
function addMouse(sc, o, yaw) {
  const T = place(o, yaw);
  // a dome: three rings, the outline of the widest one is what the eye reads
  const ring = (r, h, rz) => ellipse(r, rz, 40).map(([a, b]) => T([a, h, b]));
  sc.face(ring(2.9, 0.5, 5.6).reverse(), { cls: MUTE, twoSided: true, bias: 0.3 });
  sc.face(ring(2.6, 1.5, 5.2).reverse(), { cls: MUTE, twoSided: true, bias: 0.1 });
  // the seam between the two buttons and the wheel
  sc.line([T([0, 1.9, -4.6]), T([0, 2.1, -1.2])], { cls: DIM, bias: -0.2 });
  sc.label(T([0, 2.2, -2.9]), 'o', { cls: DIM, bias: -0.3 });
}

// *-*-*-*-*-*-*-*-*-*-*-* basys 3 *-*-*-*-*-*-*-*-*-*-*-*
// how much of the board the grid can hold: the step between two switches decides
function boardLod(cam, o, yaw) {
  const T0 = place(o, yaw);
  const a = cam.proj(T0([-5.15, 0.7, -3.35])), b = cam.proj(T0([4.75, 0.7, -3.35]));
  const step = Math.abs(b[0] - a[0]) / 15;
  return step > 6.5 ? { near: true } : step >= 3.05 ? { mid: true } : {};
}

// local u along the switch edge (0..12.1), w from the switches (0) back to the usb edge (8.3).
// far away it is drawn flat, its parts as outlines on the board; close up its parts stand up.
function addBoard(sc, o, yaw, opt) {
  const L = 12.1, Dd = 8.3, y0 = 0.55, y1 = 0.7;
  const T0 = place(o, yaw);
  const T = p => T0([p[0] - L / 2, p[1], p[2] - Dd / 2]);
  const leds = (opt && opt.leds) || 0;
  const sw = (opt && opt.switches) || 0;
  const near = !!(opt && opt.near);
  const noIO = !!(opt && opt.noIO);
  const btn = (opt && opt.btn) || [0, 0, 0, 0, 0];
  sc.group(T([L / 2, y1, Dd / 2]));
  const outline = roundRect(L, Dd, 0.5, 2);
  const topP = outline.map(([a, b]) => T([a, y1, b]));
  const lowP = outline.map(([a, b]) => T([a, y0, b]));
  sc.face(topP.slice().reverse(), { cls: INK, twoSided: true, bias: 30 });
  walls(sc, topP, lowP, T([L / 2, (y0 + y1) / 2, Dd / 2]), { cls: MUTE, bias: 29 });
  // a flat part: its outline drawn on the board
  const flat = (a, b, cls, after) => {
    const [u0, w0] = a, [u1, w1] = b;
    sc.face([T([u0, y1, w0]), T([u1, y1, w0]), T([u1, y1, w1]), T([u0, y1, w1])].reverse(), { cls, twoSided: true, bias: 0.3, after });
  };
  const B = (a, b, opt2) => box(sc, T, a, b, Object.assign({ cls: DIM, skip: ['bottom'] }, opt2 || {}));
  // sixteen slide switches along the front edge, leftmost is sw15
  const su = i => 0.95 + i * 0.64;
  if (noIO) {
    // the switches and leds are drawn over the grid by the page, as buttons; only the
    // slot each switch sits in is on the board
  } else if (near) {
    // close up: each switch body is a small dark rectangle, its lever a smaller one
    // at the back (on) or the front (off) of the slot
    for (let i = 0; i < 16; i++) {
      const u = su(i), on = (sw >> (15 - i)) & 1, lw = on ? 1.0 : 0.6;
      flat([u, 0.3], [u + 0.46, 1.3], MUTE);
      sc.label(T([u + 0.23, y1 + 0.02, lw]), '[#]', { cls: INK, bias: -0.3, center: true });
    }
  } else if (opt && opt.mid) {
    // each switch a body with its lever up (on) or down (off), shoulder to shoulder
    // in one run so the row keeps an even step on the grid
    let row = '';
    for (let i = 0; i < 16; i++) {
      row += (sw >> (15 - i)) & 1 ? '[\']' : '[.]';
    }
    sc.custom(T([(su(0) + su(15) + 0.44) / 2, y1, 0.8]), (g, p) => {
      text(g, Math.round(p[0] - row.length / 2), Math.floor(p[1]), row, INK);
    }, { bias: 0.1 });
  } else {
    // far away: sixteen small bodies side by side, the ones switched on brighter,
    // and the leds as a dotted row over them
    sc.custom(T([(su(0) + su(15) + 0.44) / 2, y1, 0.8]), (g, p) => {
      const x = Math.round(p[0] - 16), y = Math.floor(p[1]);
      for (let i = 0; i < 16; i++) {
        text(g, x + 2 * i, y, '[]', (sw >> (15 - i)) & 1 ? INK : MUTE);
        const lit = (leds >> (15 - i)) & 1;
        put(g, x + 2 * i + 1, y - 1, lit ? '*' : '.', lit ? LED : DIM);
      }
    }, { bias: 0.1 });
  }
  // the leds behind them
  for (let i = 0; !noIO && (near || (opt && opt.mid)) ? i < 16 : false; i++) {
    const lit = (leds >> (15 - i)) & 1;
    // close up an led is a small lens: dark, or lit
    const s = near ? (lit ? '(#)' : '(.)') : (lit ? '*' : '.');
    sc.label(T([su(i) + 0.22, y1, 1.75]), s, { cls: lit ? LED : DIM, bias: -0.4, center: near });
  }
  // the four digit display
  if (near) {
    B([4.2, y1, 2.25], [7.5, y1 + 0.55, 3.55], { cls: MUTE });
  } else {
    flat([4.2, 2.25], [7.5, 3.55], MUTE);
  }
  if (near) {
    // close up the four digits are drawn segment by segment, unlit
    sc.custom(T([5.85, y1 + 0.56, 2.9]), (g, p) => {
      const D = [' _  ', '|_| ', '|_|.'];
      const x = Math.round(p[0] - 8), y = Math.floor(p[1]) - 1;
      for (let r = 0; r < 3; r++) {
        text(g, x, y + r, D[r].repeat(4), (opt && opt.segCls) || DIM);
      }
    }, { bias: -0.4 });
  } else {
    sc.label(T([5.85, y1, 2.85]), (opt && opt.seg) || '8.8.8.8.', { cls: (opt && opt.segCls) || DIM, bias: -0.4, center: true });
  }
  // five buttons in a cross
  // c, l, r, u, d
  const BTN = [[0, 0], [-0.95, 0], [0.95, 0], [0, 0.95], [0, -0.95]];
  BTN.forEach(([du, dw], bi) => {
    const u = 9.55 + du, w = 3.1 + dw, h = btn[bi] ? 0.12 : 0.35;
    if (near) {
      B([u - 0.3, y1, w - 0.3], [u + 0.3, y1 + h, w + 0.3], btn[bi] ? { cls: MUTE } : {});
    }
    sc.label(T([u, y1 + (near ? h + 0.01 : 0), w]), 'o', { cls: btn[bi] ? INK : MUTE, bias: -0.4 });
  });
  // the fpga, the square in the middle
  if (near) {
    B([4.8, y1, 4.35], [7.15, y1 + 0.28, 6.7], { cls: MUTE });
  } else {
    flat([4.8, 4.35], [7.15, 6.7], MUTE);
  }
  // pmod headers, pins on top
  for (const [u0, u1, w0, w1] of [[11.15, 11.85, 1.6, 3.7], [11.15, 11.85, 4.1, 6.2], [0.25, 0.95, 1.6, 3.7], [0.25, 0.95, 4.1, 6.2]]) {
    if (near) {
      B([u0, y1, w0], [u1, y1 + 0.85, w1], { faces: { top: { cls: DIM, after: (g, pts) => fill(g, pts, ':', DIM) } } });
    } else {
      flat([u0, w0], [u1, w1], DIM, (g, pts) => fill(g, pts, ':', DIM));
    }
  }
  // the back edge: micro usb, power switch, vga, usb host
  B([0.7, y1, 7.55], [1.55, y1 + 0.32, 8.45], { cls: MUTE });
  B([2.0, y1, 7.7], [2.55, y1 + 0.5, 8.3]);
  sc.label(T([2.9, y1, 7.2]), '*', { cls: LED, bias: -0.4 });
  // the done led beside it lights once the board holds a design
  sc.label(T([3.5, y1, 7.2]), opt && opt.done ? '*' : '.', { cls: opt && opt.done ? LED : DIM, bias: -0.4 });
  B([6.3, y1, 7.4], [9.4, y1 + 1.25, 8.5], { cls: MUTE });
  B([9.8, y1, 7.15], [11.25, y1 + 0.85, 8.5], { cls: MUTE });
  // mounting holes and the silkscreen
  for (const [u, w] of [[0.45, 0.45], [L - 0.45, 0.45], [0.45, Dd - 0.45], [L - 0.45, Dd - 0.45]]) {
    sc.label(T([u, y1, w]), 'o', { cls: DIM, bias: -0.4 });
  }
  sc.label(T([2.6, y1, 3.4]), 'BASYS3', { cls: MUTE, bias: -0.4, center: true });
  // close up, the silkscreen: the chip's name, the ports and headers by the names the
  // guide uses for them
  if (near && opt && opt.silk) {
    const silk = (u, w, s2, cls) => sc.label(T([u, y1 + 0.3, w]), s2, { cls: cls || FAINT, bias: -0.6, center: true });
    silk(5.97, 5.85, 'XILINX', MUTE);
    silk(5.97, 5.3, 'ARTIX-7', DIM);
    silk(1.12, 6.85, 'PROG');
    silk(2.3, 6.85, 'POWER');
    silk(11.5, 1.2, 'JA');
    silk(11.5, 6.6, 'JB');
    silk(0.6, 1.2, 'JXADC');
    silk(0.6, 6.6, 'JC');
    silk(9.55, 4.65, 'BTNU');
  }
  sc.group(null);
  return {
    T, plug: T([1.12, y1 + 0.16, 8.6]),
    // where the page puts its switches, leds and buttons: local points on the top face
    sw: i => T([su(15 - i) + 0.23, y1, 0.8]), swTop: i => T([su(15 - i) + 0.23, y1, 1.3]), swBot: i => T([su(15 - i) + 0.23, y1, 0.3]),
    led: i => T([su(15 - i) + 0.22, y1, 1.75]),
    btn: bi => [T([9.55 + BTN[bi][0] - 0.3, y1, 3.1 + BTN[bi][1] - 0.3]), T([9.55 + BTN[bi][0] + 0.3, y1 + 0.35, 3.1 + BTN[bi][1] + 0.3])],
  };
}

// *-*-*-*-*-*-*-*-*-*-*-* cable *-*-*-*-*-*-*-*-*-*-*-*
// a smooth curve through the given points (catmull-rom), cut into short pieces
// so each piece takes its own place in depth
function addCable(sc, P, opt) {
  const n = (opt && opt.n) || 24;
  const pts = [];
  const Q = [P[0]].concat(P, [P[P.length - 1]]);
  for (let i = 1; i + 2 < Q.length; i++) {
    const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1, 2].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  pts.push(P[P.length - 1]);
  // pieces of several segments, so a steep stretch never doubles its strokes at a seam
  const k = (opt && opt.piece) || 1000;
  for (let i = 0; i + 1 < pts.length; i += k) {
    sc.line(pts.slice(i, Math.min(pts.length, i + k + 1)), { cls: (opt && opt.cls) || MUTE, bias: (opt && opt.bias) || 0, steep: 40, curve: true });
  }
  return pts;
}
