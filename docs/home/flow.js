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
