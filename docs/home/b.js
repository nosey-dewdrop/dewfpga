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
