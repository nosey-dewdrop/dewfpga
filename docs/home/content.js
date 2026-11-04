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
