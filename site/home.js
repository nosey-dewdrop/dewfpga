// built by docs/home/build.py from docs/home/*.js; edit those, then run it
// *-*-*-*-*-*-*-*-*-*-*-* engine *-*-*-*-*-*-*-*-*-*-*-*
// a character grid, a pen that picks the glyph from the line's slope and where it
// crosses the cell, faces filled back to front, and a camera that projects cm to cells.

const INK = 1, MUTE = 2, DIM = 3, ACC = 4, FAINT = 5, LED = 6, SEG = 7, SEGOFF = 8, PROMPTC = 9, TRACE = 10, WAVE = 11;

function makeGrid(cols, rows) {
  const n = cols * rows;
  return { cols, rows, ch: new Array(n).fill(' '), cl: new Uint8Array(n) };
}

function put(g, x, y, c, cls) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) {
    return;
  }
  g.ch[y * g.cols + x] = c;
  g.cl[y * g.cols + x] = cls;
}

function get(g, x, y) {
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) {
    return ' ';
  }
  return g.ch[y * g.cols + x];
}

function text(g, x, y, s, cls) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ' ') {
      put(g, x + i, y, s[i], cls);
    }
  }
}

// text that also blanks its spaces (for screen content)
function textSolid(g, x, y, s, cls) {
  for (let i = 0; i < s.length; i++) {
    put(g, x + i, y, s[i], s[i] === ' ' ? 0 : cls);
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* glyphs *-*-*-*-*-*-*-*-*-*-*-*
// a: visual angle in degrees, + when the line climbs to the right; fx, fy: where it
// crosses the cell (0 top/left, 1 bottom/right). returns [glyph, row offset].
const ASPECT = { w: 0.6, h: 1.16 };   // cell width and height in em

function glyph(a, fx, fy, steepMin, curve) {
  const S = steepMin || 52;
  const A = Math.abs(a);
  if (A < (curve ? 7 : 9)) {
    // a level line always sits on an underscore, in the row whose floor is nearest
    return fy >= 0.45 ? ['_', 0] : ['_', -1];
  }
  if (A < 30) {
    if (fy >= 0.72) {
      return ['_', 0];
    }
    if (fy >= 0.52) {
      return ['.', 0];
    }
    if (fy >= 0.3) {
      return ['-', 0];
    }
    return [a > 0 ? '\'' : '`', 0];
  }
  if (A < S) {
    if (fy >= 0.5) {
      return ['.', 0];
    }
    return [a > 0 ? '\'' : '`', 0];
  }
  if (A < 77) {
    return [a > 0 ? '/' : '\\', 0];
  }
  return ['|', 0];
}

// the pen: walks the polyline in small steps. a gentle stretch gets one glyph per
// column, a steep one one glyph per row, so a slope never doubles its strokes. a
// straight edge between the two is drawn as stairs, _/ or \_, the way it is drawn by hand.
function stroke(g, pts, cls, closed, steepMin, curve) {
  const S = steepMin || (curve ? 52 : 60);
  const STAIR = curve ? 99 : 24;
  const P = closed ? pts.concat([pts[0]]) : pts;
  let cur = null;
  const flush = () => {
    if (!cur || cur.n === 0) {
      cur = null;
      return;
    }
    const mx = cur.sx / cur.n, my = cur.sy / cur.n;
    const x = Math.floor(mx), y = Math.floor(my);
    if (cur.mode === 's') {
      const a = Math.floor(cur.x0), b = Math.floor(cur.x1);
      if (cur.a > 0) {
        for (let k = a; k < b; k++) {
          put(g, k, y, '_', cls);
        }
        put(g, b, y, '/', cls);
      } else {
        put(g, a, y, '\\', cls);
        for (let k = a + 1; k <= b; k++) {
          put(g, k, y, '_', cls);
        }
      }
    } else {
      const [c, dy] = glyph(cur.a, mx - x, my - y, S, curve);
      put(g, x, y + dy, c, cls);
    }
    cur = null;
  };
  for (let i = 0; i + 1 < P.length; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx * ASPECT.w, dy * ASPECT.h);
    if (len < 1e-6) {
      continue;
    }
    let a = Math.atan2(-dy * ASPECT.h, dx * ASPECT.w) * 180 / Math.PI;
    if (a > 90) {
      a -= 180;
    }
    if (a <= -90) {
      a += 180;
    }
    const A = Math.abs(a);
    const mode = A >= S ? 'r' : A >= STAIR ? 's' : 'c';
    const steps = Math.max(1, Math.ceil(len / 0.09));
    for (let s = 0; s < steps; s++) {
      const x = x0 + dx * (s + 0.5) / steps, y = y0 + dy * (s + 0.5) / steps;
      const key = mode + (mode === 'c' ? Math.floor(x) : Math.floor(y));
      if (!cur || cur.key !== key) {
        flush();
        cur = { key, mode, sx: 0, sy: 0, n: 0, a, x0: x, x1: x };
      }
      cur.sx += x; cur.sy += y; cur.n++;
      cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x);
    }
  }
  flush();
}

// blank every cell whose centre lies inside the polygon
function fill(g, pts, ch, cls) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  const ys = Math.max(0, Math.floor(y0)), ye = Math.min(g.rows - 1, Math.ceil(y1));
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy)) {
        xs.push(a[0] + (cy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(g.cols - 1, Math.floor(xs[k + 1] - 0.5)); x++) {
        put(g, x, y, ch || ' ', cls || 0);
      }
    }
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* camera *-*-*-*-*-*-*-*-*-*-*-*
// world in cm, y up, the camera looks along +z after its yaw and pitch.
// f is in cells of width; cx, cy is where the optical axis lands on the grid.
function camera(pos, yaw, pitch, f, cx, cy) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const toCam = p => {
    let x = p[0] - pos[0], y = p[1] - pos[1], z = p[2] - pos[2];
    const x1 = cyw * x - syw * z, z1 = syw * x + cyw * z;
    const y2 = cp * y + sp * z1, z2 = -sp * y + cp * z1;
    return [x1, y2, z2];
  };
  const proj = p => {
    const c = toCam(p);
    const z = Math.max(c[2], 0.5);
    return [cx + f * c[0] / z, cy - f * c[1] / z * (ASPECT.w / ASPECT.h), z];
  };
  // the camera's axes in world coordinates, and the ray through a grid cell
  const R = [cyw, 0, -syw], U = [syw * sp, cp, cyw * sp], F = [syw * cp, -sp, cyw * cp];
  const ray = (col, row) => {
    const dx = (col - cx) / f, dy = -(row - cy) / (f * ASPECT.w / ASPECT.h);
    return [0, 1, 2].map(k => R[k] * dx + U[k] * dy + F[k]);
  };
  // where the ray through (col, row) meets the level plane y = Y0
  const onPlane = (col, row, Y0) => {
    const d = ray(col, row), k = (Y0 - pos[1]) / d[1];
    return [pos[0] + d[0] * k, Y0, pos[2] + d[2] * k];
  };
  return { pos, yaw, pitch, f, cx, cy, toCam, proj, ray, onPlane };
}

// the x that puts a point at (y, z) on grid column col, for a camera without yaw
function xAtCol(cam, col, y, z) {
  const zc = -Math.sin(cam.pitch) * (y - cam.pos[1]) + Math.cos(cam.pitch) * (z - cam.pos[2]);
  return cam.pos[0] + (col - cam.cx) * zc / cam.f;
}

// rotate a local point about y by r, then move it to o
function place(o, r) {
  const c = Math.cos(r), s = Math.sin(r);
  return p => [o[0] + c * p[0] + s * p[2], o[1] + p[1], o[2] - s * p[0] + c * p[2]];
}

// *-*-*-*-*-*-*-*-*-*-*-* scene list *-*-*-*-*-*-*-*-*-*-*-*
// every primitive carries its depth; the list is drawn far to near.
// a group keeps its items together in depth: the whole group sits at the depth of its
// anchor point, and inside it the items sort by their own depth
function scene() {
  const items = [];
  let grp = null;
  const add = it => {
    if (grp) {
      it.grp = grp;
    }
    items.push(it);
  };
  return {
    items,
    group(anchor) {
      grp = anchor ? { anchor } : null;
    },
    face(pts3, opt) {
      add({ kind: 'face', pts3, ...opt });
    },
    line(pts3, opt) {
      add({ kind: 'line', pts3, ...opt });
    },
    label(p3, s, opt) {
      add({ kind: 'label', pts3: [p3], s, ...opt });
    },
    custom(p3, fn, opt) {
      add({ kind: 'custom', pts3: [p3], fn, ...opt });
    },
  };
}

function newell(P) {
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

function render(g, sc, cam) {
  const list = [];
  for (const it of sc.items) {
    const pc = it.pts3.map(cam.proj);
    let z = 0;
    for (const p of pc) {
      z += p[2];
    }
    z = z / pc.length + (it.bias || 0);
    if (it.kind === 'face' && !it.twoSided) {
      // back faces drop out: the outward normal must point at the camera
      const n = newell(it.pts3), p0 = it.pts3[0];
      const v = [cam.pos[0] - p0[0], cam.pos[1] - p0[1], cam.pos[2] - p0[2]];
      if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] <= 0) {
        continue;
      }
    }
    let gz = z;
    if (it.grp) {
      if (it.grp.z === undefined || it.grp.cam !== cam) {
        it.grp.z = cam.proj(it.grp.anchor)[2];
        it.grp.cam = cam;
      }
      gz = it.grp.z;
    }
    list.push({ it, pc, z, gz });
  }
  list.sort((p, q) => (q.gz - p.gz) || (q.z - p.z));
  for (const { it, pc } of list) {
    const pts = pc.map(p => [p[0], p[1]]);
    if (it.kind === 'face') {
      if (!it.noFill) {
        fill(g, pts, it.fillCh, it.fillCls);
      }
      if (it.cls !== 0 && !it.skip) {
        stroke(g, pts, it.cls, true, it.steep, it.curve);
      } else if (it.cls !== 0) {
        // only the edges not skipped, each as its own run
        for (let i = 0; i < pts.length; i++) {
          if (!it.skip.includes(i)) {
            stroke(g, [pts[i], pts[(i + 1) % pts.length]], it.cls, false, it.steep, it.curve);
          }
        }
      }
      if (it.after) {
        it.after(g, pts);
      }
    } else if (it.kind === 'line') {
      stroke(g, pts, it.cls, !!it.closed, it.steep, it.curve);
    } else if (it.kind === 'label') {
      const [x, y] = pts[0];
      text(g, Math.round(x - (it.center ? it.s.length / 2 : 0)), Math.floor(y), it.s, it.cls);
    } else if (it.kind === 'custom') {
      it.fn(g, pts[0]);
    }
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* shapes *-*-*-*-*-*-*-*-*-*-*-*
// a box from local min/max corners, placed by T; faces wound so their outside is clockwise
function box(sc, T, a, b, opt) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(T);
  const F = {
    front: [3, 2, 1, 0], back: [6, 7, 4, 5], top: [7, 6, 2, 3],
    bottom: [0, 1, 5, 4], left: [7, 3, 0, 4], right: [2, 6, 5, 1],
  };
  const o = opt || {};
  const c = T([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  for (const k of Object.keys(F)) {
    if (o.skip && o.skip.includes(k)) {
      continue;
    }
    const fo = Object.assign({}, o, (o.faces && o.faces[k]) || {});
    let P = F[k].map(i => v[i]);
    const n = newell(P), m = P.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
    if (n[0] * (m[0] - c[0]) + n[1] * (m[1] - c[1]) + n[2] * (m[2] - c[2]) < 0) {
      P = P.reverse();
    }
    sc.face(P, fo);
  }
}

// the side walls between two outlines, each turned to face away from the centre c
function walls(sc, A, B, c, opt) {
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    let P = [A[i], A[j], B[j], B[i]];
    const n = newell(P), m = [(A[i][0] + A[j][0]) / 2, (A[i][1] + B[i][1]) / 2, (A[i][2] + A[j][2]) / 2];
    if (n[0] * (m[0] - c[0]) + n[1] * (m[1] - c[1]) + n[2] * (m[2] - c[2]) < 0) {
      P = P.reverse();
    }
    sc.face(P, opt);
  }
}

// a rounded rectangle in a local plane: returns points (u, v) around it
function roundRect(w, h, r, n) {
  const pts = [], k = n || 4;
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (Math.PI / 2) * i / k;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  corner(w - r, r, 1.5 * Math.PI);
  return pts;
}

function ellipse(rx, rz, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    pts.push([rx * Math.cos(a), rz * Math.sin(a)]);
  }
  return pts;
}

// *-*-*-*-*-*-*-*-*-*-*-* output *-*-*-*-*-*-*-*-*-*-*-*
const CLS = ['', 'i', 'm', 'd', 'a', 'f', 'l', 's', 'u', 'p', 't', 'w'];

function toHTML(g) {
  const out = [];
  for (let y = 0; y < g.rows; y++) {
    let row = '', run = -1, buf = '';
    for (let x = 0; x < g.cols; x++) {
      const c = g.ch[y * g.cols + x];
      const k = c === ' ' ? 0 : g.cl[y * g.cols + x];
      if (k !== run) {
        if (buf) {
          row += run > 0 ? `<b class="${CLS[run]}">${buf}</b>` : buf;
        }
        buf = ''; run = k;
      }
      buf += c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
    }
    if (buf) {
      row += run > 0 ? `<b class="${CLS[run]}">${buf}</b>` : buf;
    }
    out.push(row.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

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

// *-*-*-*-*-*-*-*-*-*-*-* what the screen shows *-*-*-*-*-*-*-*-*-*-*-*
// the terminal runs `dewfpga sim --wave` and surfer opens the waveform it wrote.
// every line and every value is from a real run of the cs223 lab 2 testbench.

const CMD = 'dewfpga sim --wave';
const PROMPT = 'lab2 % ';
const OUT = [
  [0.2, 'testbench: tb_room_monitor (it tests room_monitor)', MUTE],
  [0.45, 'iverilog -g2012 -I. -Itb -s tb_room_monitor -o room_monitor_sim cs223_lab2.sv tb/cs223_lab2_tb.sv', DIM],
  [0.75, 'VCD info: dumpfile tb_room_monitor.vcd opened for output.', DIM],
  [1.7, 'tb_room_monitor: 4096 cases, 0 errors', INK],
  [1.85, 'en=1 room=1 | alarm=1 lamps=00000010', DIM],
  [1.9, 'en=1 room=4 | alarm=1 lamps=00010000', DIM],
  [1.95, 'en=1 room=7 | alarm=1 lamps=10000000', DIM],
  [2.2, 'waveform: tb_room_monitor.vcd, simulated by Icarus Verilog 13.0 (stable), opened in Surfer 0.7.0', MUTE],
];

// sixteen steps of the testbench: rooms 0..7 with the lab enabled, then again disabled.
// the sensors read 10010010, so rooms 1, 4 and 7 raise the alarm while en is 1.
const STEPS = 16;
const SIG = (() => {
  const en = [], room = [], alarm = [], lamps = [], sensor = [];
  for (let i = 0; i < STEPS; i++) {
    const e = i < 8 ? 1 : 0, r = i % 8, s = 0x92;
    const a = e && ((s >> r) & 1) ? 1 : 0;
    en.push(e); room.push(r); sensor.push(s); alarm.push(a);
    lamps.push(a ? (1 << r) : 0);
  }
  const hex = v => v.toString(16).padStart(2, '0');
  return [
    { name: 'en', bit: true, v: en },
    { name: 'room[2:0]', v: room, f: v => String(v) },
    { name: 'sensor[7:0]', v: sensor, f: hex },
    { name: 'alarm', bit: true, v: alarm },
    { name: 'lamps[7:0]', v: lamps, f: hex },
  ];
})();

// the timeline of one loop, in seconds
const TL = { typeAt: 0.9, perChar: 0.13, enterGap: 0.35, openGap: 0.5, draw: 4.2, hold: 7.5, close: 1.2 };
const typeTimes = (() => {
  const t = [];
  let x = TL.typeAt;
  for (let i = 0; i < CMD.length; i++) {
    // a small pause after the tool's name and before the flag, like a hand
    x += TL.perChar * (CMD[i - 1] === ' ' ? 2.1 : (i % 3 === 1 ? 0.8 : 1.05));
    t.push(x);
  }
  return t;
})();
const T_ENTER = typeTimes[typeTimes.length - 1] + TL.enterGap;
const T_OPEN = T_ENTER + OUT[OUT.length - 1][0] + TL.openGap;
const T_DRAWN = T_OPEN + 0.4 + TL.draw;
const T_END = T_DRAWN + TL.hold + TL.close;

// which key is down at time t, and how far (0..1)
function keyAt(t) {
  const down = {};
  const hit = (label, at) => {
    const d = t - at;
    if (d > -0.02 && d < 0.11) {
      down[label] = 1;
    } else if (d >= 0.11 && d < 0.16) {
      down[label] = 0.4;
    }
  };
  typeTimes.forEach((at, i) => {
    hit(CMD[i] === ' ' ? ' ' : CMD[i], at);
  });
  hit('return', T_ENTER);
  return down;
}

// word wrap for terminal lines
function wrap(s, w) {
  const out = [];
  while (s.length > w) {
    out.push(s.slice(0, w));
    s = s.slice(w);
  }
  out.push(s);
  return out;
}

// a window: a frame of underscores and bars, the three lights, a title. returns the inner box
function windowFrame(g, x0, y0, x1, y1, title, cls) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      put(g, x, y, ' ', 0);
    }
  }
  text(g, x0 + 1, y0, '_'.repeat(x1 - x0 - 1), cls);
  for (let y = y0 + 1; y <= y1; y++) {
    put(g, x0, y, '|', cls);
    put(g, x1, y, '|', cls);
  }
  text(g, x0 + 1, y1, '_'.repeat(x1 - x0 - 1), cls);
  text(g, x0 + 2, y0 + 1, 'o o o', DIM);
  if (title) {
    const tx = Math.round((x0 + x1 - title.length) / 2);
    text(g, tx, y0 + 1, title, MUTE);
  }
  text(g, x0 + 1, y0 + 1, '', FAINT);
  text(g, x0 + 1, y0 + 2, '_'.repeat(x1 - x0 - 1), FAINT);
  return { x0: x0 + 2, y0: y0 + 3, x1: x1 - 2, y1: y1 - 1 };
}

// draw the screen's content into the cell box r at time t (seconds into the loop)
function drawScreen(g, r, t, opt) {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const small = W < 80;
  // the menu bar
  const menu = small ? ' terminal  shell  edit' : ' terminal   shell   edit   view   window   help';
  text(g, r.x0, r.y0, menu, FAINT);
  const clock = 'wed 4 nov  21:47';
  if (!small) {
    text(g, r.x1 - clock.length - 1, r.y0, clock, FAINT);
  }
  // the terminal, behind
  const tw = small ? W - 2 : Math.min(W - 4, Math.round(W * 0.62));
  const th = small ? Math.round(H * 0.55) : Math.round(H * 0.62);
  const term = windowFrame(g, r.x0 + 1, r.y0 + 2, r.x0 + 1 + tw, r.y0 + 2 + th, 'lab2 - zsh', DIM);
  const lines = [];
  lines.push([[PROMPT + 'ls', DIM]]);
  lines.push([['basys3_lab2.xdc   cs223_lab2.sv   tb', DIM]]);
  let typed = 0;
  for (const at of typeTimes) {
    if (t >= at) {
      typed++;
    }
  }
  const cursorOn = Math.floor(t * 2.2) % 2 === 0 || (typed > 0 && t < T_ENTER);
  const cmdLine = [[PROMPT, MUTE], [CMD.slice(0, typed), INK]];
  lines.push(cmdLine);
  const tw2 = term.x1 - term.x0;
  if (t >= T_ENTER) {
    for (const [dt, s, cls] of OUT) {
      if (t >= T_ENTER + dt) {
        for (const part of wrap(s, tw2)) {
          lines.push([[part, cls]]);
        }
      }
    }
  }
  const room = term.y1 - term.y0;
  const show = lines.slice(Math.max(0, lines.length - room));
  show.forEach((segs, i) => {
    let x = term.x0;
    for (const [s, cls] of segs) {
      text(g, x, term.y0 + i, s.slice(0, Math.max(0, term.x1 - x)), cls);
      x += s.length;
    }
    if (segs === cmdLine && t < T_ENTER + 0.05 && cursorOn) {
      put(g, x, term.y0 + i, '_', INK);
    }
  });
  // surfer, in front
  if (t < T_OPEN || t > T_END - TL.close * 0.3) {
    return;
  }
  const grow = Math.min(1, (t - T_OPEN) / 0.35);
  const nSig = small ? SIG.length - 1 : SIG.length;
  // the window is as wide as sixteen whole steps of the waveform need
  const lead = (small ? 9 : 13) + (small ? 0 : 6) + 1;
  const want = small ? W - 1 : Math.round(W * 0.74);
  const step = Math.max(2, Math.floor((want - 4 - lead) / STEPS));
  const fw = lead + STEPS * step + 5, fh = Math.min(H - 3, 3 + nSig * 3 + 3);
  const cx = small ? r.x0 + Math.round(W / 2) : r.x1 - Math.round(fw / 2) - 1;
  const cyy = r.y1 - Math.round(fh / 2) - 1;
  const gw = Math.max(8, Math.round(fw * (0.55 + 0.45 * grow))), gh = Math.max(4, Math.round(fh * (0.55 + 0.45 * grow)));
  const wx0 = cx - Math.round(gw / 2), wy0 = cyy - Math.round(gh / 2);
  const win = windowFrame(g, wx0, wy0, wx0 + gw, wy0 + gh, grow < 1 ? '' : 'tb_room_monitor.vcd', MUTE);
  if (grow < 1) {
    return;
  }
  drawWaves(g, win, t, small);
}

function drawWaves(g, w, t, small) {
  const nameW = small ? 9 : 13, valW = small ? 0 : 6;
  const x0 = w.x0 + nameW + valW + 1;
  const stepW = Math.max(2, Math.floor((w.x1 - x0) / STEPS));
  const progress = Math.max(0, Math.min(1, (t - T_OPEN - 0.4) / TL.draw));
  const head = progress * STEPS;
  // the marker: once drawn, it visits the steps that raise the alarm
  // it is dragged from one to the next, eases in, rests, moves on
  let marker = -1;
  if (t > T_DRAWN + 0.6) {
    const visits = [1, 4, 7, 12], ph = (t - T_DRAWN - 0.6) / 1.7;
    const i = Math.floor(ph), f = ph - i;
    const a = i === 0 ? STEPS - 1 : visits[(i - 1) % visits.length], b = visits[i % visits.length];
    const e = Math.min(1, f / 0.4), k = e * e * (3 - 2 * e);
    marker = a + (b - a) * k;
  }
  const at = marker >= 0 ? Math.min(STEPS - 1, Math.floor(marker + 0.5)) : Math.min(STEPS - 1, Math.floor(head));
  // header: names, values, the time ruler
  text(g, w.x0, w.y0, small ? 'name' : 'name', DIM);
  if (!small) {
    text(g, w.x0 + nameW, w.y0, 'value', DIM);
  }
  const tick = '.'.repeat(STEPS * stepW);
  text(g, x0, w.y0 + 1, tick, FAINT);
  let y = w.y0 + 3;
  const room = w.y1 - y;
  const sigs = small ? SIG.filter(s => s.name !== 'sensor[7:0]') : SIG;
  const rowH = s => (s.bit ? 2 : 2);
  for (const s of sigs) {
    if (y + 2 > w.y1) {
      break;
    }
    text(g, w.x0, y + 1, s.name.slice(0, nameW - 1), MUTE);
    if (!small) {
      const v = s.v[at];
      text(g, w.x0 + nameW, y + 1, s.bit ? String(v) : s.f(v), INK);
    }
    const end = Math.round(head * stepW);
    if (s.bit) {
      for (let i = 0; i < STEPS; i++) {
        for (let k = 0; k < stepW; k++) {
          const col = i * stepW + k;
          if (col >= end) {
            break;
          }
          const x = x0 + col, v = s.v[i], pv = i > 0 ? s.v[i - 1] : v;
          if (k === 0 && i > 0 && v !== pv) {
            put(g, x, y + 1, '|', WAVE);
            if (v) {
              put(g, x, y, ' ', 0);
            }
            continue;
          }
          put(g, x, v ? y : y + 1, '_', WAVE);
        }
      }
    } else {
      for (let i = 0; i < STEPS; i++) {
        const v = s.v[i], pv = i > 0 ? s.v[i - 1] : -1;
        const change = v !== pv;
        const lab = s.f(v);
        for (let k = 0; k < stepW; k++) {
          const col = i * stepW + k;
          if (col >= end) {
            break;
          }
          const x = x0 + col;
          if (k === 0 && change) {
            put(g, x, y + 1, i === 0 ? '<' : 'X', WAVE);
            continue;
          }
          put(g, x, y, '_', WAVE);
          put(g, x, y + 1, '_', WAVE);
        }
        // the value sits on the lower line, inside its step run
        if (change) {
          let j = i;
          while (j + 1 < STEPS && s.v[j + 1] === v) {
            j++;
          }
          const span = (j - i + 1) * stepW;
          const lx = x0 + i * stepW + Math.max(1, Math.floor((span - lab.length) / 2));
          if (lx + lab.length <= x0 + end) {
            text(g, lx, y + 1, lab, WAVE);
          }
        }
      }
    }
    y += rowH(s) + 1;
  }
  // the head of the drawing, or the marker afterwards
  const mx = marker >= 0 ? x0 + Math.round(marker * stepW + stepW / 2) : x0 + Math.round(head * stepW);
  if (progress < 1 || marker >= 0) {
    for (let yy = w.y0 + 2; yy < y - 1; yy++) {
      if (get(g, mx, yy) === ' ') {
        put(g, mx, yy, marker >= 0 ? ':' : '|', marker >= 0 ? MUTE : INK);
      }
    }
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* b: the macbook, from the chair *-*-*-*-*-*-*-*-*-*-*-*
// what you see sitting at the desk: the laptop close, its keys big under the screen,
// the board beside it on a short cable. the keys go down as the command is typed.

function layoutB(spec, mobile) {
  const C = mobile
    ? { x: 0, h: 46, pitch: 0.4, f: 1.3, cx: 0.5, cy: 0.16, lap: [-3, 40], board: [9, 29], boardYaw: 0 }
    : { x: 0, h: 40, pitch: 0.36, f: 1.0, cx: 0.5, cy: 0.17, lap: [-10, 40], board: [21, 46], boardYaw: 0 };
  const cols = spec.cols, rows = spec.rows, base = spec.base || cols, extra = cols - base;
  const cam = camera([C.x, C.h, 0], 0, C.pitch, C.f * base, C.cx * cols, C.cy * rows);
  const L = { cam, lap: [C.lap[0], 0, C.lap[1]], board: [C.board[0], 0, C.board[1]], boardYaw: C.boardYaw };
  if (!mobile) {
    const at = (frac, k, y, z) => xAtCol(cam, frac * base + k * extra, y, z);
    L.lap[0] = at(0.306, 0.3, 0, L.lap[2]);
    L.board[0] = at(0.84, 0.74, 0, L.board[2]);
  }
  return L;
}

function frameB(g, t, mobile, spec) {
  const L = layoutB(spec, mobile);
  const cam = L.cam;
  const sc = scene();
  const lap = addLaptop(sc, cam, L.lap, { pressed: keyAt(t) });
  const board = addBoard(sc, L.board, L.boardYaw, Object.assign({ switches: 0b0000000010010010, leds: 0 }, boardLod(cam, L.board, L.boardYaw)));
  // the cable: out of the laptop's right side, a loose loop on the desk, into the board
  const port = lap.port, plug = board.plug;
  if (mobile) {
    // on a phone the board lies in front of the laptop: the cable drops down to it
    addCable(sc, [port, [port[0] + 2.2, 0.3, port[2] - 0.6], [port[0] + 2.6, 0.3, plug[2] + 5], [plug[0] + 1.2, 0.3, plug[2] + 3.2], plug], { n: 24 });
  } else {
    addCable(sc, [port, [port[0] + 2.4, 0.3, port[2] + 0.4], [port[0] + 4.0, 0.3, port[2] + 3.2], [port[0] + 5.2, 0.3, plug[2] + 4.6],
      [plug[0] - 0.6, 0.3, plug[2] + 5.4], [plug[0] + 0.4, 0.3, plug[2] + 3.0], plug], { n: 28 });
  }
  const sp = lap.screen.map(cam.proj);
  const r = {
    x0: Math.ceil(Math.min(sp[0][0], sp[3][0])) + 1, x1: Math.floor(Math.max(sp[1][0], sp[2][0])) - 1,
    y0: Math.ceil(Math.min(sp[0][1], sp[1][1])) + 1, y1: Math.floor(Math.max(sp[2][1], sp[3][1])) - 1,
  };
  sc.custom(lap.T([0, 10, -0.02]), g2 => drawScreen(g2, r, t), { bias: -0.11 });
  // the notch sits over the menu bar
  sc.face(lap.notch, { cls: DIM, bias: -0.2, twoSided: true });
  render(g, sc, cam);
}

const LOOP_B = T_END;

// *-*-*-*-*-*-*-*-*-*-*-* how: the flow as you scroll *-*-*-*-*-*-*-*-*-*-*-*
// the hero's laptop, closer. the circuit is written, simulated, its waveform drawn, then
// flashed; the camera follows the cable down to the board and its leds answer. every
// frame is a function of how far the reader has scrolled, so scrolling back runs it back.

const FLOW_CODE = [
  'module room_monitor(input  logic [7:0] sensor,',
  '                    input  logic [2:0] room,',
  '                    input  logic       en,',
  '                    output logic       alarm,',
  '                    output logic [7:0] lamps);',
  '    logic selected;',
  '',
  '    // room picks the sensor of the selected room',
  '    mux8 m_mux8_selector (.d(sensor), .s(room), .y(selected));',
  '',
  '    // en = 0 -> alarm = 0, en = 1 -> alarm = selected sensor',
  '    mux2 m_mux2_enabler  (.d0(1\'b0), .d1(selected), .s(en), .y(alarm));',
  '',
  '    // the alarm turns the decoder on, room picks which lamp lights',
  '    dec3 m_dec3_activator(.en(alarm), .a(room), .q(lamps));',
  'endmodule',
];
// every line below is from a real run in the lab 2 folder
const FLOW_SIM = [
  ['testbench: tb_room_monitor (it tests room_monitor)', MUTE],
  ['VCD info: dumpfile tb_room_monitor.vcd opened for output.', DIM],
  ['tb_room_monitor: 4096 cases, 0 errors', INK],
  ['en=1 room=1 | alarm=1 lamps=00000010', DIM],
  ['en=1 room=4 | alarm=1 lamps=00010000', DIM],
  ['en=1 room=7 | alarm=1 lamps=10000000', DIM],
];
const FLOW_WAVE = [
  ['tb_room_monitor: 4096 cases, 0 errors', INK],
  ['waveform: tb_room_monitor.vcd, simulated by Icarus Verilog 13.0 (stable), opened in Surfer 0.7.0', MUTE],
];
const FLOW_FLASH = [
  ['pnr ok: 13 LUT, 0 FF, no clocked paths, timing not applicable   (full log: top_monitor.log)', MUTE],
  ['top_monitor.bit  2.2 MB', MUTE],
  ['Jtag frequency : requested 6.00MHz    -> real 6.00MHz', DIM],
  ['Open file DONE', DIM],
  ['Parse file DONE', DIM],
  ['load program', DIM],
];
const CMD_SIM = 'dewfpga sim tb_room_monitor';
const CMD_WAVE = 'dewfpga sim tb_room_monitor --wave';
const CMD_FLASH = 'dewfpga flash top_monitor';

// the stretches of the scroll
const FLOW = {
  intro: [0.0, 0.07], write: [0.07, 0.24], sim: [0.27, 0.4], wave: [0.43, 0.6], flash: [0.63, 0.76],
  glide: [0.775, 0.875], tilt: [0.875, 0.93], answer: [0.94, 1.0],
};
// the caption that goes with each stretch; -1 is the hero
const FLOW_STEPS = [[0.035, 0.255], [0.255, 0.415], [0.415, 0.615], [0.615, 1.01]];
const span = (p, [a, b]) => Math.max(0, Math.min(1, (p - a) / (b - a)));
const easeF = x => x * x * (3 - 2 * x);

// what a command line shows while it is being typed over a stretch of the scroll
function typedLine(cmd, k) {
  const n = Math.round(cmd.length * Math.max(0, Math.min(1, k)));
  return { text: cmd.slice(0, n), key: n > 0 && n < cmd.length ? cmd[n - 1] : null, done: n >= cmd.length };
}

function flowState(p) {
  const s = { p };
  const kw = span(p, FLOW.write);
  const total = FLOW_CODE.reduce((n, l) => n + l.length + 1, 0);
  s.codeChars = Math.round(total * kw);
  s.key = null;
  if (kw > 0 && kw < 1) {
    let n = s.codeChars;
    for (const line of FLOW_CODE) {
      if (n <= line.length) {
        s.key = n > 0 ? line[n - 1] : null;
        break;
      }
      n -= line.length + 1;
    }
  }
  const ks = span(p, FLOW.sim);
  s.sim = typedLine(CMD_SIM, ks / 0.4);
  s.simOut = ks <= 0.45 ? 0 : Math.ceil(FLOW_SIM.length * (ks - 0.45) / 0.5);
  const kv = span(p, FLOW.wave);
  s.wave = typedLine(CMD_WAVE, kv / 0.25);
  s.waveOut = kv <= 0.27 ? 0 : kv < 0.34 ? 1 : 2;
  s.waveOpen = kv > 0.3;
  s.waveDraw = Math.max(0, Math.min(1, (kv - 0.36) / 0.58));
  const kf = span(p, FLOW.flash);
  s.flash = typedLine(CMD_FLASH, kf / 0.28);
  s.flashOut = kf <= 0.32 ? 0 : Math.min(FLOW_FLASH.length, Math.ceil(FLOW_FLASH.length * (kf - 0.32) / 0.3));
  s.sram = Math.max(0, Math.min(1, (kf - 0.64) / 0.28));
  s.done = kf >= 0.96;
  for (const c of [s.sim, s.wave, s.flash]) {
    if (c.key && !s.key) {
      s.key = c.key;
    }
  }
  // the switches stay where the testbench's last case left them: sensors 10010010,
  // room 4, en on. once the camera is over the board the room switches move, 5 then 7
  const ka = span(p, FLOW.answer);
  const room = ka < 0.3 ? 4 : ka < 0.65 ? 5 : 7;
  const sensor = 0x92, en = 1;
  s.switches = (en << 11) | (room << 8) | sensor;
  const alarm = en && ((sensor >> room) & 1);
  s.leds = s.done ? ((alarm << 8) | (alarm ? 1 << room : 0)) : 0;
  s.step = FLOW_STEPS.findIndex(([a, b]) => p >= a && p < b);
  return s;
}

// the screen: the editor, the terminal under it, surfer over both
function flowScreen(g, r, s, small) {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  text(g, r.x0, r.y0, small ? ' code  terminal' : ' code   file   edit   view   terminal   help', FAINT);
  const eh = Math.round(H * (small ? 0.5 : 0.56));
  const ed = windowFrame(g, r.x0 + 1, r.y0 + 2, r.x1 - 1, r.y0 + 2 + eh, 'cs223_lab2.sv', DIM);
  let left = s.codeChars;
  const room = ed.y1 - ed.y0;
  const lines = [];
  for (const line of FLOW_CODE) {
    if (left <= 0) {
      break;
    }
    lines.push(line.slice(0, left));
    left -= line.length + 1;
  }
  const first = Math.max(0, lines.length - room);
  lines.slice(first).forEach((l, i) => {
    text(g, ed.x0, ed.y0 + i, String(first + i + 1).padStart(2, ' '), FAINT);
    text(g, ed.x0 + 4, ed.y0 + i, l.slice(0, ed.x1 - ed.x0 - 4), l.trim().startsWith('//') ? DIM : MUTE);
  });
  if (s.p < FLOW.write[1] + 0.01 && s.p > FLOW.intro[0] + 0.02) {
    const li = Math.max(0, lines.length - 1 - first);
    const last = lines.length ? lines[lines.length - 1].length : 0;
    put(g, ed.x0 + 4 + Math.min(last, ed.x1 - ed.x0 - 5), ed.y0 + li, '_', INK);
  }
  if (s.p >= FLOW.sim[0] - 0.01) {
    const ty0 = r.y0 + 2 + eh - (small ? 2 : 4);
    const tm = windowFrame(g, r.x0 + (small ? 1 : 6), ty0, r.x1 - (small ? 1 : 2), r.y1, 'lab2 - zsh', DIM);
    const out = [];
    const tw = tm.x1 - tm.x0;
    const push = (str, cls) => {
      for (const part of wrap(str, tw)) {
        out.push([part, cls]);
      }
    };
    out.push([[PROMPT, MUTE], [s.sim.text, INK]]);
    FLOW_SIM.slice(0, s.simOut).forEach(([str, cls]) => push(str, cls));
    if (s.p >= FLOW.wave[0]) {
      out.push([[PROMPT, MUTE], [s.wave.text, INK]]);
      FLOW_WAVE.slice(0, s.waveOut).forEach(([str, cls]) => push(str, cls));
    }
    if (s.p >= FLOW.flash[0]) {
      out.push([[PROMPT, MUTE], [s.flash.text, INK]]);
      FLOW_FLASH.slice(0, s.flashOut).forEach(([str, cls]) => push(str, cls));
      if (s.sram > 0) {
        const bar = Math.max(10, Math.min(40, tw - 24)), n = Math.round(bar * s.sram);
        push('Load SRAM: [' + '='.repeat(n) + ' '.repeat(bar - n) + '] ' + (s.sram * 100).toFixed(2) + '%', MUTE);
      }
      if (s.done) {
        push('Done', INK);
      }
    }
    const rows = tm.y1 - tm.y0;
    out.slice(Math.max(0, out.length - rows)).forEach((seg, i) => {
      if (Array.isArray(seg[0])) {
        let x = tm.x0;
        for (const [str, cls] of seg) {
          text(g, x, tm.y0 + i, str, cls);
          x += str.length;
        }
      } else {
        text(g, tm.x0, tm.y0 + i, seg[0], seg[1]);
      }
    });
  }
  // surfer, while the waveform is the step
  if (s.waveOpen && s.p < FLOW.flash[0]) {
    const nSig = small ? SIG.length - 1 : SIG.length;
    const lead = (small ? 9 : 13) + (small ? 0 : 6) + 1;
    const want = small ? W - 1 : Math.round(W * 0.8);
    const step = Math.max(2, Math.floor((want - 4 - lead) / STEPS));
    const fw = lead + STEPS * step + 5, fh = Math.min(H - 3, 3 + nSig * 3 + 2);
    const wx0 = r.x1 - fw - 1, wy0 = r.y1 - fh - 1;
    const win = windowFrame(g, wx0, wy0, wx0 + fw, wy0 + fh, 'tb_room_monitor.vcd', MUTE);
    drawWaves(g, win, T_OPEN + 0.4 + s.waveDraw * TL.draw, small);
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* camera *-*-*-*-*-*-*-*-*-*-*-*
// four framings: the hero's two-shot, the seat close to the screen, the two-shot again,
// the board on its cable. on a wide window the laptop and then the board sit in the
// left part of the frame, so the captions have the right part to themselves.
function flowKeys(spec, mobile) {
  const L = layoutB(Object.assign({}, spec, { base: spec.base || spec.cols }), mobile);
  const cols = spec.cols, rows = spec.rows;
  const lap = L.lap, b = L.board, pitch0 = L.cam.pitch, f = L.cam.f;
  const hero = { pos: L.cam.pos, pitch: pitch0, cx: L.cam.cx, cy: L.cam.cy };
  // the seat: dolly toward the middle of the screen until it is as wide as wanted, then
  // shift the lens so the screen lands where the composition wants it
  const probe = scene();
  const lp0 = addLaptop(probe, L.cam, lap, {});
  const scrC = lp0.screen.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
  const wantW = mobile ? 0.86 : 0.5, at = mobile ? [0.5, 0.5] : [0.3, 0.4];
  let k = 0, pos = hero.pos;
  for (let it = 0, lo = 0, hi = 0.8; it < 22; it++) {
    k = (lo + hi) / 2;
    pos = [0, 1, 2].map(i => hero.pos[i] + (scrC[i] - hero.pos[i]) * k);
    const c = camera(pos, 0, pitch0, f, 0, 0);
    const sc2 = scene();
    const lp = addLaptop(sc2, c, lap, {});
    const sp = lp.screen.map(c.proj);
    const w = Math.max(sp[1][0], sp[2][0]) - Math.min(sp[0][0], sp[3][0]);
    if (w / cols > wantW) {
      hi = k;
    } else {
      lo = k;
    }
  }
  const c0 = camera(pos, 0, pitch0, f, 0, 0);
  const sc3 = scene();
  const sp = addLaptop(sc3, c0, lap, {}).screen.map(c0.proj);
  const mx = (Math.min(sp[0][0], sp[3][0]) + Math.max(sp[1][0], sp[2][0])) / 2;
  const my = (Math.min(sp[0][1], sp[1][1]) + Math.max(sp[2][1], sp[3][1])) / 2;
  const seat = { pos, pitch: pitch0, cx: at[0] * cols - mx, cy: at[1] * rows - my };
  const along = (pitch, d) => [b[0] + (mobile ? 0 : 1), b[1] + d * Math.sin(pitch), b[2] - d * Math.cos(pitch)];
  const bx = mobile ? 0.5 : 0.36;
  const near = { pos: along(pitch0, mobile ? 26 : 30), pitch: pitch0, cx: bx * cols, cy: rows * 0.5 };
  return { L, hero, seat, near, along, bx };
}

function flowCamera(K, p, mobile, rows) {
  const lerp = (A, B, k) => ({
    pos: [0, 1, 2].map(i => A.pos[i] + (B.pos[i] - A.pos[i]) * k),
    pitch: A.pitch + (B.pitch - A.pitch) * k, cx: A.cx + (B.cx - A.cx) * k, cy: A.cy + (B.cy - A.cy) * k,
  });
  if (p < FLOW.glide[0]) {
    return lerp(K.hero, K.seat, easeF(span(p, FLOW.intro)));
  }
  if (p < FLOW.tilt[0]) {
    // from the seat straight along the desk to the board, as if the eye followed the cable
    return lerp(K.seat, K.near, easeF(span(p, FLOW.glide)));
  }
  // a short orbit round the board, enough to see its leds answer; the close-up is the
  // next section's
  const k = easeF(span(p, FLOW.tilt));
  const pitch = K.near.pitch + (0.66 - K.near.pitch) * k;
  return { pos: K.along(pitch, (mobile ? 26 : 30) - (mobile ? 4 : 3) * k), pitch, cx: K.near.cx, cy: rows * 0.5 };
}

function frameFlow(g, p, mobile, spec, K) {
  const L = K.L;
  const s = flowState(p);
  const v = flowCamera(K, p, mobile, spec.rows);
  const cam = camera(v.pos, 0, v.pitch, L.cam.f, v.cx, v.cy);
  const sc = scene();
  const pressed = s.key ? { [s.key === ' ' ? ' ' : s.key.toLowerCase()]: 1 } : {};
  const lp = addLaptop(sc, cam, L.lap, { pressed });
  const b = L.board;
  const board = addBoard(sc, b, L.boardYaw, Object.assign({ switches: s.switches, leds: s.leds, done: s.done }, boardLod(cam, b, L.boardYaw)));
  const port = lp.port, plug = board.plug;
  if (mobile) {
    addCable(sc, [port, [port[0] + 2.2, 0.3, port[2] - 0.6], [port[0] + 2.6, 0.3, plug[2] + 5], [plug[0] + 1.2, 0.3, plug[2] + 3.2], plug], { n: 24 });
  } else {
    addCable(sc, [port, [port[0] + 2.4, 0.3, port[2] + 0.4], [port[0] + 4.0, 0.3, port[2] + 3.2], [port[0] + 5.2, 0.3, plug[2] + 4.6],
      [plug[0] - 0.6, 0.3, plug[2] + 5.4], [plug[0] + 0.4, 0.3, plug[2] + 3.0], plug], { n: 28 });
  }
  const sp = lp.screen.map(cam.proj);
  const r = {
    x0: Math.ceil(Math.min(sp[0][0], sp[3][0])) + 1, x1: Math.floor(Math.max(sp[1][0], sp[2][0])) - 1,
    y0: Math.ceil(Math.min(sp[0][1], sp[1][1])) + 1, y1: Math.floor(Math.max(sp[2][1], sp[3][1])) - 1,
  };
  // a screen mostly out of the frame shows only its dark glass, no slivers of text
  const inside = (Math.min(r.x1, g.cols) - Math.max(r.x0, 0)) * (Math.min(r.y1, g.rows) - Math.max(r.y0, 0));
  const whole = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  if (r.x1 > 0 && r.y1 > 0 && r.x0 < g.cols && r.y0 < g.rows && inside / whole > 0.55 && v.pitch < L.cam.pitch + 0.02) {
    sc.custom(lp.T([0, 10, -0.02]), g2 => flowScreen(g2, r, s, r.x1 - r.x0 < 80), { bias: -0.11 });
    sc.face(lp.notch, { cls: DIM, bias: -0.2, twoSided: true });
  }
  render(g, sc, cam);
  return s;
}

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

// *-*-*-*-*-*-*-*-*-*-*-* the traces between the sections *-*-*-*-*-*-*-*-*-*-*-*
// a trace leaves the board through its pmod header, runs down the left margin, crosses the
// gap under the board through the chips of room_monitor in the order its signal goes
// (mux8, mux2, dec3, room_monitor), comes down the right margin past the cli, crosses back
// through the lab's other modules and ends at the coffee cup. it only stays in the margins
// and in the gaps between sections. a flipped switch sends a pulse down it; a chip lights
// as the pulse goes through it.

function chipArt(label, compact) {
  const w = Math.max(9, label.length + 5);
  const pins = ' ' + Array.from({ length: Math.floor((w - 1) / 2) }, () => '| ').join('').slice(0, w - 1);
  // on a phone the chip keeps the legs it stands on and leaves out the row on top
  const body = ['.' + '-'.repeat(w - 2) + '.', '( ' + label.padEnd(w - 3) + '|', '\'' + '-'.repeat(w - 2) + '\'', pins];
  return { rows: compact ? body : [pins].concat(body), w, label, lab: compact ? 1 : 2 };
}
// a transistor in its little black can, legs down; an electrolytic can; both stand on the trace
const PARTS = {
  q: { rows: [' ___ ', '|   |', '|___|', ' ||| '], w: 5 },
  c: { rows: [' _ ', '|=|', '|_|', '| |'], w: 3 },
};

function startPCB(opts) {
  const root = opts.root;
  let state = null, raf = 0;
  const pulses = [];

  function catmull(P, n) {
    const out = [];
    const Q = [P[0]].concat(P, [P[P.length - 1]]);
    for (let i = 1; i + 2 < Q.length; i++) {
      const p0 = Q[i - 1], p1 = Q[i], p2 = Q[i + 1], p3 = Q[i + 2];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }

  function build() {
    root.innerHTML = '';
    pulses.length = 0;
    const W = document.documentElement.clientWidth, mobile = W < 720;
    const sY = window.scrollY;
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top + sY, b: r.bottom + sY, w: r.width, h: r.height };
    };
    const boardSec = document.getElementById('board'), cliSec = document.getElementById('cli'), docsSec = document.getElementById('docs');
    const cup = document.getElementById('cup');
    const top = boardSec.offsetTop, bottom = rect(cup).b + 40;
    root.style.top = top + 'px';
    root.style.height = (bottom - top) + 'px';
    // the grid: small letters, so the parts can be small and detailed
    const pre = document.createElement('pre');
    const fs = mobile ? 9 : 10;
    pre.style.fontSize = fs + 'px';
    pre.style.lineHeight = (fs * 1.16) + 'px';
    root.appendChild(pre);
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(50);
    probe.style.cssText = 'position:absolute;visibility:hidden';
    pre.appendChild(probe);
    const cw = probe.getBoundingClientRect().width / 50, lh = fs * 1.16;
    probe.remove();
    const cols = Math.floor(W / cw), rows = Math.ceil((bottom - top) / lh);
    const g = makeGrid(cols, rows);
    const cx = x => x / cw, cy = y => (y - top) / lh;
    const gut = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gut'));
    const xL = cx(gut * 0.5), xR = cx(W - gut * 0.5);
    // what the trace must keep clear of: every block of content, a cell around it
    const keep = [];
    for (const el of document.querySelectorAll('#board .boardwrap, #board .txt, #cli .head, #cli .line, #cli .hcli, #cli .grp, #docs .head, #docs .paper, #docs .docs-grid, #thanks p, #cup')) {
      const r = rect(el);
      keep.push([cx(r.l) - 1, cy(r.t) - 0.6, cx(r.r) + 1, cy(r.b) + 0.6]);
    }
    const free = (x, y) => !keep.some(k => x >= k[0] && x <= k[2] && y >= k[1] && y <= k[3]);
    // the gaps the trace crosses: from the bottom of one section's content to the top of the next
    const boardB = Math.max(rect(document.querySelector('#board .scroller')).b, rect(document.querySelector('#board .txt')).b);
    const gapA = [cy(boardB), cy(rect(cliSec.querySelector('.head')).t)];
    const cliB = Math.max(...[...cliSec.querySelectorAll('.grp')].map(e => rect(e).b));
    const gapB = [cy(cliB), cy(rect(docsSec.querySelector('.head')).t)];
    // a level trace sits on the floor of its row: give it the middle of the row
    // on a phone the gap is short: the line runs just above the next heading, the parts rise from it
    const lineIn = gp => (mobile ? Math.floor(gp[1] - 1.7) : Math.round(gp[0] + (gp[1] - gp[0]) * 0.5)) + 0.5;
    const yA = lineIn(gapA), yB = lineIn(gapB);
    // where it starts: out of the board's left pmod header, or under the board on a phone
    let start;
    const bw = document.getElementById('boardWrap');
    if (!mobile && opts.pmod) {
      const p = opts.pmod();
      start = [[cx(p.x) - 0.5, cy(p.y)], [cx(p.x) - 2, cy(p.y) + 0.4]];
    } else {
      const r = rect(document.querySelector('#board .scroller'));
      start = [[xL + 3, cy(r.b) + 0.6], [xL + 1, cy(r.b) + 1.6]];
    }
    // the parts on the two crossings, in the order the pulse meets them, each on its own row:
    // [name, where along the crossing, rows below the crossing's line]
    const A = mobile ? [['mux8', 0.14, 0], ['dec3', 0.44, 0], ['room_monitor', 0.78, 0]]
      : [['mux8', 0.12, 0], ['r', 0.25, 2], ['mux2', 0.36, 2], ['dec3', 0.52, 1], ['q', 0.64, 3], ['room_monitor', 0.8, 1]];
    const B = mobile ? [['top_mux', 0.2, 0], ['c', 0.43, 0], ['mux4', 0.62, 0], ['dec2', 0.86, 0]]
      : [['top_mux', 0.14, 1], ['c', 0.27, 0], ['mux4', 0.39, 2], ['r', 0.52, 3], ['dec2', 0.63, 1], ['top_decoder', 0.8, 0]];
    const widthOf = name => (name === 'r' ? 7 : PARTS[name] ? PARTS[name].w : chipArt(name, mobile).w);
    // a crossing: level under each part, and between two parts a 45 degree jog to the next
    // part's row, the way a trace is routed on a board
    const crossing = (x0, x1, y, parts, dir) => {
      const pts = [];
      let row = y;
      parts.forEach(([name, f, off]) => {
        const x = x0 + (x1 - x0) * f, half = widthOf(name) / 2 + 2, r = y + off;
        const enter = x - dir * half;
        if (r !== row) {
          pts.push([enter - dir * 2 * Math.abs(r - row), row]);
        }
        pts.push([enter, r], [x + dir * half, r]);
        row = r;
      });
      if (row !== y) {
        const last = pts[pts.length - 1][0];
        pts.push([last + dir * 3, row], [last + dir * (3 + 2 * Math.abs(row - y)), y]);
      }
      return pts;
    };
    const cupR = rect(cup);
    const yEnd = Math.floor(cy(cupR.b) - 1.2) + 0.5;
    const sx = start[0][0], sy = Math.floor(start[0][1]) + 0.5;
    const P = [
      [sx, sy], [xL + 1, sy + (sx - xL - 1) / 2],
      [xL, sy + (sx - xL) / 2 + 1],
      [xL, yA - 3], [xL + 6, yA],
      ...crossing(xL + 6, xR - 6, yA, A, 1),
      [xR - 6, yA], [xR, yA + 3],
      [xR, yB - 3], [xR - 6, yB],
      ...crossing(xR - 6, xL + 6, yB, B, -1),
      [xL + 6, yB], [xL, yB + 3],
      [xL, yEnd - 3], [xL + 6, yEnd], [cx(cupR.l) + 0.2, yEnd],
    ];
    const path = P.filter((p, i, a2) => i === 0 || Math.hypot(p[0] - a2[i - 1][0], p[1] - a2[i - 1][1]) > 0.3);
    stroke(g, path, TRACE, false, 62, false);
    for (const k of keep) {
      for (let y = Math.max(0, Math.floor(k[1])); y <= Math.min(rows - 1, Math.ceil(k[3])); y++) {
        for (let x = Math.max(0, Math.floor(k[0])); x <= Math.min(cols - 1, Math.ceil(k[2])); x++) {
          put(g, x, y, ' ', 0);
        }
      }
    }
    // vias where it turns
    for (const [x, y] of [[xL, yA - 3], [xR, yA + 3], [xR, yB - 3], [xL, yB + 3], [xL, yEnd - 3]]) {
      if (free(x, y)) {
        put(g, x, Math.floor(y), 'o', DIM);
      }
    }
    // the parts: chips stand on the trace with their lower pins, a resistor sits in it
    const parts = [];
    const placeParts = (list, x0, x1, y0, dir) => {
      for (const [name, f, off] of list) {
        const x = x0 + (x1 - x0) * f, y = y0 + off;
        if (name === 'r') {
          const art = '-(|||)-';
          const rx = Math.round(x - art.length / 2), ry = Math.floor(y);
          text(g, rx, ry, art.replace('|||', '   '), DIM);
          parts.push({ kind: 'r', x: rx + 2, y: ry, art: '|||' });
          continue;
        }
        const art = PARTS[name] || chipArt(name, mobile);
        const px = Math.round(x - art.w / 2), py = Math.floor(y) - art.rows.length + 1;
        // a part that would touch a block of content stays off the board
        const hit = keep.some(k => px + art.w >= k[0] && px <= k[2] && py + art.rows.length >= k[1] && py <= k[3]);
        if (!hit) {
          parts.push({ kind: PARTS[name] ? name : 'chip', x: px, y: py, art, name });
        }
      }
    };
    placeParts(A, xL + 6, xR - 6, yA, 1);
    placeParts(B, xR - 6, xL + 6, yB, -1);
    pre.innerHTML = toHTML(g);
    // each part its own small element, so it can light when the pulse goes through it
    for (const p of parts) {
      const el = document.createElement('pre');
      el.className = 'part';
      el.style.fontSize = fs + 'px';
      el.style.lineHeight = lh + 'px';
      el.style.left = (p.x * cw) + 'px';
      el.style.top = (p.y * lh) + 'px';
      if (p.kind === 'r') {
        // the colour bands of a 1 kilo-ohm resistor: brown, black, red
        el.innerHTML = '<b style="color:#9a6a45">|</b><b style="color:#5a5a5a">|</b><b class="s">|</b>';
      } else {
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        el.innerHTML = p.art.rows.map((r, i) => {
          if (p.kind === 'chip' && i === p.art.lab) {
            return esc(r.slice(0, 2)) + '<span class="lab">' + esc(r.slice(2, 2 + p.name.length)) + '</span>' + esc(r.slice(2 + p.name.length));
          }
          return '<span class="' + (i === p.art.rows.length - 1 || i === 0 ? 'pin' : '') + '">' + esc(r) + '</span>';
        }).join('\n');
      }
      root.appendChild(el);
      p.el = el;
    }
    // the order the pulse walks: the cells of the trace from the pmod to the cup
    const seq = [];
    const seen = new Set();
    for (let i = 0; i + 1 < path.length; i++) {
      const [x0, y0] = path[i], [x1, y1] = path[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3));
      for (let k = 0; k < n; k++) {
        const x = Math.floor(x0 + (x1 - x0) * k / n), y = Math.floor(y0 + (y1 - y0) * k / n);
        const key = x + ',' + y;
        if (!seen.has(key) && x >= 0 && y >= 0 && x < cols && y < rows && g.ch[y * cols + x] !== ' ') {
          seen.add(key);
          seq.push([x, y, g.ch[y * cols + x]]);
        }
      }
    }
    // the parts a pulse meets: the step of the walk under each
    for (const p of parts) {
      const mx = p.kind === 'r' ? p.x + 1 : p.x + Math.floor(p.art.w / 2);
      const my = p.kind === 'r' ? p.y : p.y + p.art.rows.length - 1;
      let best = -1, bd = 1e9;
      seq.forEach(([x, y], i) => {
        const d = Math.abs(x - mx) + 2 * Math.abs(y - my);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      p.at = best;
    }
    const layer = document.createElement('div');
    root.appendChild(layer);
    state = { seq, parts, cw, lh, layer, top, gapA, gapB, yA, yB, rows, cols };
    // a crossing seen for the first time gets its own pulse
    if ('IntersectionObserver' in window && !opts.reduce()) {
      for (const [y, key] of [[yA, 'a'], [yB, 'b']]) {
        const mark = document.createElement('div');
        mark.style.cssText = 'position:absolute;left:0;width:1px;height:1px;top:' + (y * lh) + 'px';
        root.appendChild(mark);
        const io = new IntersectionObserver(es => {
          if (es.some(e => e.isIntersecting)) {
            io.disconnect();
            const i0 = seq.findIndex(([x, yy]) => Math.abs(yy - y) < 1.5);
            send(Math.max(0, i0 - 8));
          }
        }, { rootMargin: '0px 0px -30% 0px' });
        io.observe(mark);
      }
    }
  }

  // a pulse: six cells of the trace in the colour of a signal at 1, walking to the cup
  function send(from) {
    if (!state || opts.reduce() || pulses.length > 3) {
      return;
    }
    pulses.push({ i: from || 0, t: performance.now(), spans: [] });
    if (!raf) {
      raf = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    raf = 0;
    const { seq, parts, cw, lh, layer } = state;
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];
      const head = Math.floor(p.i + (now - p.t) / 1000 * 95);
      if (head - 6 >= seq.length) {
        p.spans.forEach(s => s.remove());
        pulses.splice(k, 1);
        continue;
      }
      while (p.spans.length < 6) {
        const s = document.createElement('span');
        s.className = 'pulse';
        layer.appendChild(s);
        p.spans.push(s);
      }
      p.spans.forEach((s, j) => {
        const c = seq[head - j];
        if (!c) {
          s.style.display = 'none';
          return;
        }
        s.style.display = '';
        s.style.left = (c[0] * cw) + 'px';
        s.style.top = (c[1] * lh) + 'px';
        s.style.fontSize = state.fsz;
        s.textContent = c[2];
      });
      for (const part of parts) {
        if (part.at >= 0 && part.at <= head && part.at > head - 4) {
          part.el.classList.add('hot');
          clearTimeout(part.timer);
          part.timer = setTimeout(() => part.el.classList.remove('hot'), 520);
        }
      }
    }
    if (pulses.length) {
      raf = requestAnimationFrame(tick);
    }
  }

  function rebuild() {
    build();
    if (state) {
      const f = parseFloat(root.querySelector('pre').style.fontSize);
      state.fsz = f + 'px';
      state.layer.style.cssText = 'position:absolute;inset:0;font-family:var(--mono);font-size:' + f + 'px;line-height:' + (f * 1.16) + 'px';
    }
  }

  return { build: rebuild, send, nearest: yPage => (state ? state.seq.findIndex(([, y]) => y * state.lh + state.top >= yPage) : 0) };
}

// *-*-*-*-*-*-*-*-*-*-*-* the page *-*-*-*-*-*-*-*-*-*-*-*
// sizes every grid to the window, runs the hero, follows the scroll through the flow,
// keeps the words of the stage off the drawing, wakes the board and the copy buttons.

function charAdvance(pre) {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(50);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
  pre.appendChild(probe);
  const adv = probe.getBoundingClientRect().width / 50 / 100;
  probe.remove();
  return adv;
}

function setGrid(pre, cols, rows, fs, adv) {
  pre.style.fontSize = fs.toFixed(3) + 'px';
  pre.style.lineHeight = (fs * 1.16).toFixed(3) + 'px';
  pre.style.width = (cols * adv * fs).toFixed(1) + 'px';
  pre.style.height = (rows * fs * 1.16).toFixed(1) + 'px';
}

// the ink of a grid: the rightmost inked column in a band of rows, the first inked row
// right of a column
function inkRight(g, y0, y1, xMax) {
  let m = -1;
  for (let y = Math.max(0, y0); y < Math.min(g.rows, y1); y++) {
    for (let x = Math.min(g.cols, xMax) - 1; x > m; x--) {
      if (g.ch[y * g.cols + x] !== ' ') {
        m = x;
        break;
      }
    }
  }
  return m;
}
function inkTop(g, x0) {
  for (let y = 0; y < g.rows; y++) {
    for (let x = Math.max(0, x0); x < g.cols; x++) {
      if (g.ch[y * g.cols + x] !== ' ') {
        return y;
      }
    }
  }
  return g.rows;
}

function boot() {
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const how = document.getElementById('how'), stage = how.querySelector('.stage');
  const scene = document.getElementById('scene'), hero = document.getElementById('hero'), caps = document.getElementById('caps');
  const stepBtns = [...caps.querySelectorAll('.steps button')], capEls = [...caps.querySelectorAll('.cap')];
  const nav = document.querySelector('nav.top');
  const hcli = document.getElementById('hcli'), cliHome = document.querySelector('#cli .cli-cols');
  const H0 = window.HOME || {};
  let M = null, lastP = -1, lastK = -1, t0 = performance.now(), heroMode = true;

  const pcb = startPCB({ root: document.getElementById('pcb'), reduce, pmod: () => board.pmod() });
  const board = startBoard({
    pre: document.getElementById('boardPre'), layer: document.getElementById('boardLayer'),
    readout: { sw: document.getElementById('rSw'), led: document.getElementById('rLed'), seg: document.getElementById('rSeg'), an: document.getElementById('rAn') },
    reduce, onFlip: () => pcb.send(0),
  });
  window.__pcb = pcb;

  function size() {
    const W = innerWidth, H = innerHeight, mobile = W < 720;
    const gut = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gut'));
    const navH = nav.getBoundingClientRect().height;
    const adv = charAdvance(scene);
    let spec, fs;
    // the scene shares the frame of the nav and the sections, so their edges line up
    const ncs = getComputedStyle(nav);
    const availW = nav.clientWidth - parseFloat(ncs.paddingLeft) - parseFloat(ncs.paddingRight);
    if (mobile) {
      spec = { cols: 124, rows: 90, base: 124 };
      // the scene and its words under it fit what the browser shows: on a phone the toolbar
      // takes the bottom of the screen
      // (a window not yet sized, as when safari is still opening, counts as tall enough)
      const wf = availW / (124 * adv);
      fs = H > 420 ? Math.max(wf * 0.6, Math.min(wf, (H - navH - 176) / (90 * 1.16))) : wf;
    } else {
      fs = Math.min(availW / (300 * adv), (H - navH - 10) / (88 * 1.16));
      const cols = Math.max(300, Math.min(480, Math.floor(availW / (adv * fs))));
      spec = { cols, rows: 88, base: 300 };
    }
    setGrid(scene, spec.cols, spec.rows, fs, adv);
    const cw = adv * fs, lh = fs * 1.16, preW = spec.cols * cw, preH = spec.rows * lh;
    // the scene sits in the middle of the height the nav leaves; a phone keeps it high,
    // its words go under it
    const left = (W - preW) / 2, top = mobile ? navH : navH + Math.max(0, Math.round((H - navH - preH) / 2 - 6));
    scene.style.left = left + 'px';
    scene.style.top = top + 'px';
    const K = flowKeys(spec, mobile);
    M = { mobile, spec, fs, adv, cw, lh, left, top, K, navH, gut, preW, preH };
    // the words of the stage: on a phone under the drawing, on a wider window in the part
    // of the frame the drawing leaves empty, measured from the drawing itself
    if (mobile) {
      const y = top + preH + 14;
      for (const el of [hero, caps]) {
        el.style.left = gut + 'px';
        el.style.top = y + 'px';
        el.style.width = (W - 2 * gut) + 'px';
        el.style.maxWidth = 'none';
      }
    } else {
      const g = makeGrid(spec.cols, spec.rows);
      frameB(g, T_DRAWN, false, spec);
      // the laptop's right edge above the desk, and the top of what lies right of it
      const lapR = inkRight(g, 0, Math.round(spec.rows * 0.5), Math.round(spec.cols * 0.75));
      const x0 = lapR + 8, yTop = inkTop(g, x0);
      hero.style.left = (left + x0 * cw) + 'px';
      hero.style.width = Math.min(560, (spec.cols - x0 - 4) * cw) + 'px';
      hero.style.maxWidth = 'none';
      hero.style.top = (top + Math.max(4, Math.round(spec.rows * 0.1)) * lh) + 'px';
      hero.dataset.room = Math.round((yTop - spec.rows * 0.1) * lh);
      M.heroFloor = top + yTop * lh;
      // the captions: right of the laptop at the seat and of the board at the end
      let right = 0;
      for (const p of [0.2, 0.5, 0.7, 0.935, 1.0]) {
        const g2 = makeGrid(spec.cols, spec.rows);
        frameFlow(g2, p, false, spec, K);
        // only the band of rows the captions take: the cable may peek in below it
        right = Math.max(right, inkRight(g2, Math.round(spec.rows * 0.22), Math.round(spec.rows * 0.78), spec.cols));
      }
      const cx = left + (right + 7) * cw;
      caps.style.left = cx + 'px';
      caps.style.width = Math.max(300, Math.min(600, W - gut - cx)) + 'px';
      caps.style.top = '';
      M.capsLeft = cx;
      // and above whatever the drawing puts under them: the cable on the desk
      const capCol = right + 6;
      let floor = spec.rows;
      for (const p of [0.2, 0.5, 0.7]) {
        const g3 = makeGrid(spec.cols, spec.rows);
        frameFlow(g3, p, false, spec, K);
        floor = Math.min(floor, inkTop(g3, capCol));
      }
      M.capsFloor = top + floor * lh - 28;
    }
    placeCaps();
    placeCli();
    // the board: as wide as its column, drawn finer than the desk
    const bwrap = document.querySelector('#board .wrap'), bcs = getComputedStyle(bwrap);
    const inner = bwrap.clientWidth - parseFloat(bcs.paddingLeft) - parseFloat(bcs.paddingRight);
    const colW = W < 900 ? inner : (inner - parseFloat(bcs.columnGap)) * (W < 1200 ? 3 / 5 : 7 / 11);
    // on a phone the board is drawn wider than the screen, so two switches sit a finger apart
    const bcols = mobile ? 150 : 168, bw2 = mobile ? colW * 1.75 : colW;
    const brows = board.rowsFor(bcols, mobile);
    // the whole board in one window's height, switches included
    const bfs = Math.min(bw2 / (bcols * adv), mobile ? 99 : (H - 120) / (brows * 1.16));
    const bpre = document.getElementById('boardPre'), layer = document.getElementById('boardLayer');
    setGrid(bpre, bcols, brows, bfs, adv);
    layer.style.fontSize = bfs.toFixed(3) + 'px';
    layer.style.lineHeight = (bfs * 1.16).toFixed(3) + 'px';
    board.size({ cols: bcols, rows: brows, cw: adv * bfs, lh: bfs * 1.16, small: false, mobile });
    const scroller = document.getElementById('boardScroller');
    if (mobile) {
      scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    }
    lastP = -1;
    lastK = -1;
    if (reduce()) {
      stills();
    }
  }

  // the cli under the hero's lines, when it fits between them and the drawing: the gap
  // between its commands closes up to a few pixels on a short window; where it still does not
  // fit (a phone, a short or narrow window) it stands at the top of the cli section
  function placeCli() {
    hero.appendChild(hcli);
    hcli.style.removeProperty('--hg');
    hcli.style.removeProperty('line-height');
    if (!M.mobile) {
      // in the stage's own frame, so a window resized further down the page measures the same
      const hb = () => hcli.getBoundingClientRect().bottom - stage.getBoundingClientRect().top;
      const n = hcli.children.length - 1;
      // the gap closes first, then the lines come a little closer
      for (const [lh, least] of [[1.3, 4], [1.2, 3]]) {
        hcli.style.lineHeight = lh;
        hcli.style.removeProperty('--hg');
        const spare = M.heroFloor - 10 - hb();
        const gap = Math.min(10, 10 + spare / n);
        if (gap >= least) {
          hcli.style.setProperty('--hg', gap.toFixed(1) + 'px');
          if (lh === 1.3) {
            hcli.style.removeProperty('line-height');
          }
          return;
        }
      }
      hcli.style.removeProperty('line-height');
      hcli.style.removeProperty('--hg');
    }
    cliHome.parentNode.insertBefore(hcli, cliHome);
  }

  // the caption block sits in the middle of the frame's height, or under the drawing on a phone
  function placeCaps() {
    if (!M || M.mobile) {
      return;
    }
    const h = caps.getBoundingClientRect().height;
    const mid = M.top + M.preH * 0.42 - h / 2;
    caps.style.top = Math.max(M.navH, Math.min(mid, (M.capsFloor || 1e9) - h)) + 'px';
  }

  function progress() {
    const r = how.getBoundingClientRect();
    return Math.max(0, Math.min(1, -r.top / (how.offsetHeight - innerHeight)));
  }

  function drawHero(t) {
    const g = makeGrid(M.spec.cols, M.spec.rows);
    frameB(g, t, M.mobile, M.spec);
    scene.innerHTML = toHTML(g);
  }

  function drawFlow(p) {
    const g = makeGrid(M.spec.cols, M.spec.rows);
    const s = frameFlow(g, p, M.mobile, M.spec, M.K);
    scene.innerHTML = toHTML(g);
    return s;
  }

  const ALT = H0.alt || [];
  const ALT0 = scene.getAttribute('aria-label');
  function setStep(i) {
    scene.setAttribute('aria-label', i >= 0 && ALT[i] ? ALT[i] : ALT0);
    stepBtns.forEach((b, k) => b.classList.toggle('on', k === i));
    capEls.forEach((c, k) => c.classList.toggle('on', k === i));
    placeCaps();
  }

  // the words fade with the scroll: the hero's lines leave as the camera moves in, the
  // captions come; on a wide window they step aside while the camera crosses the desk
  function fades(p) {
    const heroO = 1 - span(p, [0.004, 0.035]);
    let capO = span(p, [0.03, 0.065]);
    if (!M.mobile) {
      capO *= 1 - span(p, [0.765, 0.79]) + span(p, [0.895, 0.925]);
    }
    hero.style.opacity = heroO.toFixed(3);
    hero.style.visibility = heroO < 0.01 ? 'hidden' : 'visible';
    caps.style.opacity = Math.min(1, capO).toFixed(3);
    caps.style.visibility = capO < 0.01 ? 'hidden' : 'visible';
  }

  // on the home the nav's cli and docs lead to the home's own sections, the pages are one link further
  nav.querySelectorAll('a.c-cli, a.c-docs').forEach(a => a.addEventListener('click', e => {
    const t = document.getElementById(a.classList.contains('c-cli') ? 'cli' : 'docs');
    if (!t || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    t.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#' + t.id);
  }));
  stepBtns.forEach((b, i) => b.addEventListener('click', () => {
    const [a, c] = FLOW_STEPS[i];
    const p = i === 3 ? 0.75 : a + (c - a) * 0.85;
    scrollTo({ top: how.offsetTop + p * (how.offsetHeight - innerHeight), behavior: reduce() ? 'auto' : 'smooth' });
  }));

  // *-*-*-*-*-*-*-*-*-*-*-* less motion *-*-*-*-*-*-*-*-*-*-*-*
  // the hero still, with its waveform drawn; the four steps one under the other
  function stills() {
    drawHero(T_DRAWN + 1.2);
    hero.style.opacity = 1;
    const box = document.getElementById('stills');
    box.innerHTML = '';
    [0.235, 0.395, 0.595, 1.0].forEach((p, i) => {
      const fig = document.createElement('figure');
      const pre = document.createElement('pre');
      pre.setAttribute('aria-hidden', 'true');
      pre.style.color = 'var(--dim)';
      pre.style.overflow = 'hidden';
      const cols = M.mobile ? 124 : 300, rows = M.mobile ? 90 : 88;
      const spec = { cols, rows, base: cols };
      const K = flowKeys(spec, M.mobile);
      const g = makeGrid(cols, rows);
      frameFlow(g, p, M.mobile, spec, K);
      pre.innerHTML = toHTML(g);
      fig.appendChild(pre);
      fig.appendChild(capEls[i].cloneNode(true));
      box.appendChild(fig);
      const w = fig.getBoundingClientRect().width * (M.mobile ? 1 : 7 / 11);
      setGrid(pre, cols, rows, w / (cols * M.adv), M.adv);
    });
  }

  window.__freeze = t => {
    window.__frozen = true;
    drawHero(t / 1000);
  };

  size();
  sizeTerms();
  pcb.build();
  wireCopy(pcb);
  if (reduce()) {
    return;
  }
  const tick = now => {
    const r = how.getBoundingClientRect();
    if (r.bottom > 0 && !window.__frozen) {
      const p = progress();
      if (p < 0.004) {
        if (!heroMode) {
          heroMode = true;
          t0 = now;
        }
        const t = ((now - t0) / 1000) % LOOP_B, k = Math.floor(t * 12);
        if (k !== lastK) {
          lastK = k;
          drawHero(k / 12);
        }
        if (lastP !== 0) {
          lastP = 0;
          fades(0);
          setStep(-1);
        }
      } else if (Math.abs(p - lastP) > 0.0003 || heroMode) {
        heroMode = false;
        lastK = -1;
        lastP = p;
        const s = drawFlow(p);
        setStep(s.step);
        fades(p);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // lay out again whenever the window settles: a resize, the toolbar of a phone coming or
  // going, the page coming back from the cache, and once everything has loaded
  let rt = null;
  const relayout = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      size();
      sizeTerms();
      pcb.build();
    }, 120);
  };
  addEventListener('resize', relayout);
  addEventListener('pageshow', relayout);
  addEventListener('load', relayout);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', relayout);
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* the terminals of the cli *-*-*-*-*-*-*-*-*-*-*-*
// drawn the way the windows on the laptop's screen are: a bar of underscores, the three
// lights, the title, a comment over each command, a copy at the end of its line
// the comments come with the page, in its language (docs/home/build.py)
const TERMS = (() => {
  const C = (window.HOME && window.HOME.terms) || {};
  const c = k => C[k] || k;
  return {
    // the install line itself is in the hero, with the four commands of the flow
    install: { title: '~ - zsh', lines: [
      ['#', c('check')], ['%', 'dewfpga check'],
    ] },
    write: { title: '~ - zsh', lines: [
      ['#', c('new')], ['%', 'dewfpga new blink'], [],
      ['#', c('vscode')], ['%', 'dewfpga vscode'],
    ] },
    // damla's own guide, in her order
    waveform: { title: 'lab2 - zsh', lines: [
      ['#', c('waves')], [],
      ['#', c('tops')], ['%', 'dewfpga sim top_mux --wave'], [],
      ['#', c('tbs')], ['%', 'dewfpga sim tb_mux2 --wave=browser'], [],
      ['#', c('both')], ['%', 'dewfpga sim top_mux --wave=both'],
    ] },
  };
})();
const COPY = (window.HOME && window.HOME.copy) || ['copy', 'done', 'copied', 'select'];

function wordWrap(str, w, indent) {
  const out = [];
  let line = '';
  for (const word of str.split(' ')) {
    if (line && (line + ' ' + word).length > w) {
      out.push(line);
      line = indent + word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  out.push(line);
  return out;
}

function drawTerm(pre, T, maxCols) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cw2 = Math.max(COPY[0].length, COPY[1].length) + 2;
  const want = Math.max(...T.lines.map(l => (l[1] || '').length + 2 + (l[0] === '%' ? cw2 : 0))) + 4;
  const cols = Math.max(28, maxCols >= want ? maxCols : maxCols), inner = cols - 4;
  const F = t => '<b class="d" aria-hidden="true">' + t + '</b>';
  const row = html => F('|') + ' ' + html + ' ' + F('|');
  const out = [];
  out.push(' ' + F('_'.repeat(cols - 2)) + ' ');
  const tl = T.title, tx = Math.max(8, Math.round((cols - tl.length) / 2));
  out.push(F('|') + ' ' + F('o o o') + ' '.repeat(tx - 7) + '<b class="m" aria-hidden="true">' + esc(tl) + '</b>' + ' '.repeat(Math.max(1, cols - 1 - tx - tl.length)) + F('|'));
  out.push(F('|' + '_'.repeat(cols - 2) + '|'));
  out.push(row(' '.repeat(inner)));
  for (const [k, txt] of T.lines) {
    if (!k) {
      out.push(row(' '.repeat(inner)));
      continue;
    }
    if (k === '#') {
      const parts = wordWrap('# ' + txt, inner, '  ');
      parts.forEach(pt => out.push(row('<b class="c">' + esc(pt.padEnd(inner)) + '</b>')));
      continue;
    }
    // a command: the prompt, the command (wrapped when the window is narrow), copy at the end
    const room = inner - 2 - cw2;
    const pieces = [];
    let rest = txt;
    while (rest.length > room) {
      // break after a slash or at a space, never inside a word
      let cut = -1;
      for (let j = room; j > room * 0.4; j--) {
        if (rest[j - 1] === '/' || rest[j] === ' ') {
          cut = j;
          break;
        }
      }
      if (cut < 0) {
        cut = room;
      }
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, '');
    }
    pieces.push(rest);
    pieces.forEach((pc, i) => {
      const last = i === pieces.length - 1;
      const head = i === 0 ? '<b class="p" aria-hidden="true">%</b> ' : '  ';
      const pad = ' '.repeat(Math.max(0, inner - 2 - pc.length - (last ? cw2 : 0)));
      const code = '<code' + (i === 0 ? ' data-cmd="' + esc(txt) + '"' : '') + '>' + esc(pc) + '</code>';
      out.push(row(head + code + pad + (last ? '  <button class="copy" type="button" data-cmd="' + esc(txt) + '">' + COPY[0].padEnd(cw2 - 2) + '</button>' : '')));
    });
  }
  out.push(row(' '.repeat(inner)));
  out.push(F('|' + '_'.repeat(cols - 2) + '|'));
  pre.innerHTML = out.join('\n');
}

function sizeTerms() {
  const terms = [...document.querySelectorAll('pre.term')];
  if (!terms.length) {
    return;
  }
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(50);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  terms[0].appendChild(probe);
  const adv = probe.getBoundingClientRect().width / 50;
  probe.remove();
  // every window as wide as its column, so a column of windows lines up
  for (const t of terms) {
    const col = t.closest('.cli-col');
    drawTerm(t, TERMS[t.dataset.g], Math.floor(col.getBoundingClientRect().width / adv));
  }
  const paper = document.getElementById('paper');
  if (paper) {
    drawPaper(paper);
  }
}

// *-*-*-*-*-*-*-*-*-*-*-* the guide, drawn *-*-*-*-*-*-*-*-*-*-*-*
// the first page of the guide as it prints: its title and its sections, a corner folded
const GUIDE = ['what do you need before you start', 'how do you install it in one line', 'how do you build the chain by hand',
  'what is in the project folder', 'how do you use it for your own lab', 'how do you set up vs code',
  'which errors does the cli stop with', 'what can it not do', 'which versions were tested'];
function drawPaper(pre) {
  const W = 46, esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const L = [];
  const row = (txt, cls) => '<b class="d">|</b>  ' + (cls ? '<b class="' + cls + '">' : '') + esc(txt.padEnd(W - 5)) + (cls ? '</b>' : '') + '<b class="d">|</b>';
  L.push(' <b class="d">' + '_'.repeat(W - 7) + '</b>');
  L.push('<b class="d">|' + ' '.repeat(W - 7) + '|\\</b>');
  L.push('<b class="d">|</b>  <b class="i">' + esc('how do you run cs223 labs'.padEnd(W - 9)) + '</b><b class="d">|_\\</b>');
  L.push(row('on a mac without vivado?', 'i'));
  L.push(row(''));
  L.push(row('damla su bilge', 'f'));
  L.push(row(''));
  GUIDE.forEach(t => L.push(row(t, 'm')));
  L.push(row(''));
  L.push(row('cs223_mac_setup.pdf', 'f'));
  L.push('<b class="d">|' + '_'.repeat(W - 3) + '|</b>');
  pre.innerHTML = L.join('\n');
}

// the copy buttons: the command next to it, as typed, without the prompt
function wireCopy(pcb) {
  document.addEventListener('click', async e => {
    const b = e.target.closest('.copy');
    if (!b) {
      return;
    }
    if (pcb) {
      pcb.send(Math.max(0, pcb.nearest(b.getBoundingClientRect().top + scrollY)));
    }
    {
      const code = b.dataset.cmd || b.parentElement.querySelector('code').textContent;
      let ok = false;
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try {
          ok = document.execCommand('copy');
        } catch (e2) {
          ok = false;
        }
        ta.remove();
      }
      const was = b.textContent;
      b.textContent = ok ? COPY[2] : COPY[3];
      if (b.closest('pre.term, .hcli')) {
        b.textContent = (ok ? COPY[1] : COPY[3]).slice(0, was.length).padEnd(was.length);
      }
      b.classList.add('done');
      setTimeout(() => {
        b.textContent = was;
        b.classList.remove('done');
      }, 1400);
    }
  });
}

(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot);
