// *-*-*-*-*-*-*-*-*-*-*-* two pictures in the sections' empty room *-*-*-*-*-*-*-*-*-*-*-*
// beside the cli's line about the install, dewfpga's 0.3 gb as one box beside vivado's 50 to
// 100 gb (amd's figure) as a pile of the same boxes, one box per 0.3 gb; above the board, the
// moment of a flash: the cable's plug goes into the prog port, openFPGALoader's bar fills as
// it really prints it, and the done led lights. each plays once when it comes into view.

const SIDE_E = { cols: 106, rows: 11 };
// the pile, row by row from the floor up, each row set a little off the one under it the way
// boxes settle: 333 boxes of 0.3 gb are 100 gb, the first 167 of them 50
const PILE = [46, 45, 44, 42, 40, 37, 33, 24, 15, 7];
const PILE_AT = [0, 1, 2, 4, 5, 7, 9, 14, 19, 23];
function drawSize(g, k) {
  const base = 9, x0 = 14;
  text(g, 1, base, '[]', INK);
  text(g, 4, base, 'dewfpga', MUTE);
  text(g, 4, base + 1, '0.3 gb', FAINT);
  const total = PILE.reduce((a, b) => a + b, 0);
  const shown = Math.round(total * k);
  let n = 0;
  PILE.forEach((w, r) => {
    for (let i = 0; i < w && n < shown; i++) {
      n++;
      text(g, x0 + PILE_AT[r] + i * 2, base - r, '[]', n <= 167 ? DIM : FAINT);
    }
  });
  if (k >= 1) {
    text(g, x0 + 58, 0, 'vivado', MUTE);
    text(g, x0 + 58, 1, '50 to 100 gb', FAINT);
  }
}

const SIDE_F = { cols: 96, rows: 8 };
function drawFlash(g, k) {
  // the edge of the board: its prog port in the wall, its done led
  const bx = 40;
  text(g, bx + 1, 0, '_'.repeat(30), DIM);
  for (let y = 1; y <= 4; y++) {
    put(g, bx, y, '|', DIM);
    put(g, bx + 31, y, '|', DIM);
  }
  text(g, bx + 1, 4, '_'.repeat(30), DIM);
  text(g, bx - 1, 2, '[_]', MUTE);
  text(g, bx + 3, 2, 'PROG', FAINT);
  const done = k >= 0.97;
  text(g, bx + 17, 2, done ? '*' : '.', done ? LED : DIM);
  text(g, bx + 19, 2, 'DONE', done ? MUTE : FAINT);
  text(g, bx + 24, 3, 'BASYS3', FAINT);
  // the cable from the mac, its plug sliding into the port
  const kp = Math.min(1, k / 0.22), px = Math.round(bx - 17 + 12 * kp);
  stroke(g, catmullV([[0.5, 1.6], [7, 3.4], [15, 3.7], [px - 3, 2.9], [px - 0.6, 2.5]], 8), DIM, false, 52, true);
  text(g, px, 2, '[##]', MUTE);
  put(g, px + 4, 2, '=', kp >= 1 ? INK : DIM);
  // openFPGALoader's own line, its bar of 50 filling, then its done
  if (k > 0.25) {
    const f = Math.min(1, (k - 0.25) / 0.68), nb = Math.round(50 * f);
    text(g, 0, 6, 'Load SRAM: [', MUTE);
    for (let i = 0; i < nb; i++) {
      put(g, 12 + i, 6, '=', LED);
    }
    text(g, 62, 6, '] ' + (f * 100).toFixed(2) + '%', MUTE);
  }
  if (done) {
    text(g, 0, 7, 'Done', INK);
  }
}

function startSide(opts) {
  const reduce = opts.reduce;
  const items = [
    { spec: SIDE_E, draw: drawSize, ms: 2600, where: opts.size },
    { spec: SIDE_F, draw: drawFlash, ms: 3400, where: opts.flash },
  ].map(it => {
    const pre = document.createElement('pre');
    pre.className = 'side';
    pre.setAttribute('aria-hidden', 'true');
    it.where.root.appendChild(pre);
    return Object.assign(it, { pre, k: reduce() ? 1 : 0, played: false });
  });
  const paint = it => {
    const g = makeGrid(it.spec.cols, it.spec.rows);
    it.draw(g, it.k);
    it.pre.innerHTML = toHTML(g);
  };
  const play = it => {
    if (it.played || reduce()) {
      return;
    }
    it.played = true;
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / it.ms);
      // a few frames a second, as the board's own lights would
      const q = Math.round(k * 24) / 24;
      if (q !== it.k) {
        it.k = q;
        paint(it);
      }
      if (k < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        play(items.find(it => it.pre === e.target));
      }
    }), { rootMargin: '0px 0px -20% 0px' });
    items.forEach(it => io.observe(it.pre));
  } else {
    items.forEach(it => {
      it.k = 1;
    });
  }

  // each in the room its section leaves: a box in page pixels, or nothing when it is too small
  function size(adv) {
    for (const it of items) {
      const r = it.where.room();
      const fs = r ? Math.min(11, r.w / (it.spec.cols * adv), r.h / (it.spec.rows * 1.16)) : 0;
      if (fs < 8) {
        it.pre.style.display = 'none';
        continue;
      }
      it.pre.style.display = '';
      it.pre.style.left = r.x + 'px';
      it.pre.style.top = r.y + 'px';
      setGrid(it.pre, it.spec.cols, it.spec.rows, fs, adv);
      paint(it);
    }
  }
  return { size, rects: () => items.filter(it => it.pre.style.display !== 'none').map(it => it.pre) };
}
