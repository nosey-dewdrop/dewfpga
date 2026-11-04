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
