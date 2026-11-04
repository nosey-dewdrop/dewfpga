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
