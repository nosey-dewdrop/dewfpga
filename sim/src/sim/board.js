// the basys3 rev c, drawn from the digilent reference manual callout figure.
// inputs come from clicks, outputs get painted. class names are the api the page and tests use.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
// bottom row geometry: ld15 / sw15 leftmost, like the real board
const COL_X = (i) => 96 + (15 - i) * 54;
const LED_Y = 452, SW_Y = 480;
// pushbutton cross (lower right)
const BTN = { btnU: [772, 292], btnL: [722, 342], btnC: [772, 342], btnR: [822, 342], btnD: [772, 392] };
// seven-segment geometry for one digit (a b c d e f g), 34 wide x 54 tall, slight italic via skew
const SEG = {
  0: [5, 0, 24, 5], 1: [29, 5, 5, 21], 2: [29, 29, 5, 21], 3: [5, 50, 24, 5],
  4: [0, 29, 5, 21], 5: [0, 5, 5, 21], 6: [5, 25, 24, 5],
};
const DISP_X = 150, DISP_Y = 334, DIGIT_STEP = 52;

export class Board {
  constructor(svg, onInput) {
    this.svg = svg;
    this.onInput = onInput;
    this.state = { sw: new Array(16).fill(0), btn: { btnU: 0, btnD: 0, btnL: 0, btnR: 0, btnC: 0 } };
    this.led = new Array(16).fill(0);
    this.digits = [0, 0, 0, 0];
    this._build();
  }
  _t(x, y, str, cls, parent, anchor) {
    const t = el('text', { x, y, class: cls }, parent || this.svg);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    return t;
  }
  _header(x, y, cols, rows, parent) {
    // black female pin header, cols x rows, 2.54 mm ≈ 10 units
    const g = el('g', {}, parent || this.svg);
    el('rect', { x, y, width: cols * 10 + 4, height: rows * 10 + 4, rx: 1, class: 'b-hdr' }, g);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) el('rect', { x: x + 4 + c * 10, y: y + 4 + r * 10, width: 4, height: 4, class: 'b-pin' }, g);
    return g;
  }
  _chip(x, y, w, h, lines, parent) {
    const g = el('g', {}, parent || this.svg);
    el('rect', { x, y, width: w, height: h, rx: 2, class: 'b-chip' }, g);
    el('circle', { cx: x + 8, cy: y + 8, r: 2.5, class: 'b-chip-dot' }, g);
    lines.forEach((l, i) => this._t(x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * 13, l, 'b-chip-txt', g, 'middle'));
    return g;
  }
  _build() {
    const s = this.svg;
    s.setAttribute('viewBox', '-30 -10 1060 640');
    s.innerHTML = '';
    // ---- pcb ----
    el('rect', { x: 0, y: 0, width: 1000, height: 620, rx: 8, class: 'b-pcb' }, s);
    for (const [x, y] of [[26, 26], [974, 26], [26, 594], [974, 594]]) {
      el('circle', { cx: x, cy: y, r: 10, class: 'b-hole-ring' }, s);
      el('circle', { cx: x, cy: y, r: 6, class: 'b-hole' }, s);
    }
    // faint trace texture: a few silkscreen reference lines like the real board's group outlines
    el('rect', { x: 66, y: 438, width: 868, height: 132, rx: 2, class: 'b-outline' }, s);
    el('rect', { x: DISP_X - 12, y: DISP_Y - 12, width: 232, height: 90, rx: 2, class: 'b-outline' }, s);
    el('rect', { x: 690, y: 262, width: 166, height: 168, rx: 2, class: 'b-outline' }, s);

    // ---- top edge, left to right ----
    // power switch sw16 + power good led + ext power header
    const pwr = el('g', {}, s);
    el('rect', { x: 52, y: 14, width: 30, height: 46, rx: 2, class: 'b-swbody' }, pwr);
    el('rect', { x: 57, y: 19, width: 20, height: 16, rx: 1, class: 'b-swknob on' }, pwr);
    this._t(67, 74, 'POWER', 'b-silk', pwr, 'middle');
    this._t(67, 6, 'ON', 'b-silk b-silk-xs', pwr, 'middle');
    this.pwr = el('rect', { x: 96, y: 30, width: 10, height: 6, rx: 1, class: 'b-smdled b-pwrled' }, pwr);
    this._t(101, 50, 'LD20', 'b-silk b-silk-xs', pwr, 'middle');
    this._header(120, 22, 1, 2, pwr); this._t(128, 60, 'J6', 'b-silk b-silk-xs', pwr, 'middle');
    this._t(128, 70, 'EXT', 'b-silk b-silk-xs', pwr, 'middle');
    // jumper jp2 power select
    this._header(160, 22, 1, 3, pwr); el('rect', { x: 158, y: 22, width: 12, height: 22, rx: 2, class: 'b-jumper' }, pwr);
    this._t(166, 70, 'JP2', 'b-silk b-silk-xs', pwr, 'middle');
    // micro usb j4 (prog/uart)
    el('rect', { x: 200, y: -4, width: 56, height: 30, rx: 5, class: 'b-metal' }, s);
    el('rect', { x: 214, y: 6, width: 28, height: 8, rx: 3, class: 'b-metal-in' }, s);
    this._t(228, 42, 'USB PROG/UART', 'b-silk b-silk-xs', s, 'middle');
    el('rect', { x: 268, y: 6, width: 8, height: 5, rx: 1, class: 'b-smdled' }, s); this._t(272, 22, 'LD18 TX', 'b-silk b-silk-xs', s, 'middle');
    el('rect', { x: 268, y: 28, width: 8, height: 5, rx: 1, class: 'b-smdled' }, s); this._t(272, 44, 'LD17 RX', 'b-silk b-silk-xs', s, 'middle');
    // vga j1 (db15)
    const vga = el('g', {}, s);
    el('path', { d: 'M395 -6 h180 l-14 66 h-152 z', class: 'b-metal' }, vga);
    el('path', { d: 'M418 12 h134 l-9 36 h-116 z', class: 'b-vga-in' }, vga);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5 - (r === 2 ? 1 : 0); c++) el('circle', { cx: 434 + c * 24 + r * 6, cy: 22 + r * 10, r: 2.2, class: 'b-pin' }, vga);
    el('circle', { cx: 405, cy: 30, r: 9, class: 'b-metal-in' }, vga); el('circle', { cx: 565, cy: 30, r: 9, class: 'b-metal-in' }, vga);
    this._t(485, 74, 'VGA', 'b-silk', vga, 'middle');
    // usb host j2 (type a)
    el('rect', { x: 636, y: -6, width: 78, height: 54, rx: 3, class: 'b-metal' }, s);
    el('rect', { x: 646, y: 8, width: 58, height: 22, rx: 1, class: 'b-metal-in' }, s);
    el('rect', { x: 650, y: 12, width: 50, height: 6, class: 'b-usb-tongue' }, s);
    this._t(675, 62, 'USB HOST', 'b-silk b-silk-xs', s, 'middle');
    el('rect', { x: 722, y: 60, width: 8, height: 5, rx: 1, class: 'b-smdled' }, s); this._t(726, 76, 'LD16 BUSY', 'b-silk b-silk-xs', s, 'middle');
    // programming mode jumper jp1
    this._header(740, 18, 3, 1, s); el('rect', { x: 740, y: 16, width: 22, height: 14, rx: 2, class: 'b-jumper' }, s);
    this._t(757, 46, 'JP1', 'b-silk b-silk-xs', s, 'middle');
    this._t(757, 56, 'QSPI USB JTAG', 'b-silk b-silk-xs', s, 'middle');
    // config reset (red) and done led
    el('rect', { x: 796, y: 14, width: 24, height: 24, rx: 2, class: 'b-btnbase' }, s);
    el('circle', { cx: 808, cy: 26, r: 7, class: 'b-btn-red' }, s);
    this._t(808, 52, 'PROG', 'b-silk b-silk-xs', s, 'middle');
    this.done = el('rect', { x: 840, y: 22, width: 10, height: 6, rx: 1, class: 'b-smdled b-doneled' }, s);
    this._t(845, 42, 'DONE', 'b-silk b-silk-xs', s, 'middle');

    // ---- pmods: jb + xadc on the left, ja + jc on the right ----
    const pmod = (x, y, label) => { this._header(x, y, 2, 6, s); this._t(x + 12, y + 80, label, 'b-silk', s, 'middle'); };
    pmod(-24, 116, 'JB'); pmod(-24, 300, 'JXADC'); pmod(1000, 116, 'JA'); pmod(1000, 300, 'JC');

    // ---- center: chips and logos ----
    this._chip(432, 190, 150, 150, ['XILINX', 'ARTIX-7', 'XC7A35T', 'CPG236', ''], s);
    this._t(507, 370, 'U1', 'b-silk b-silk-xs', s, 'middle');
    this._chip(222, 96, 62, 40, ['FTDI', 'FT2232'], s);
    this._chip(608, 122, 44, 44, ['QSPI', 'FLASH'], s);
    this._chip(604, 196, 60, 40, ['ADP', 'PWR'], s);
    // 100 mhz oscillator
    el('rect', { x: 372, y: 236, width: 40, height: 22, rx: 3, class: 'b-metal' }, s);
    this.clkDot = el('rect', { x: 378, y: 242, width: 8, height: 4, class: 'b-clk' }, s);
    this._t(392, 272, 'CLK 100MHz', 'b-silk b-silk-xs', s, 'middle');
    this._t(392, 282, 'W5', 'b-silk b-silk-xs', s, 'middle');
    // logos as silkscreen text (no vendor artwork)
    el('rect', { x: 236, y: 188, width: 134, height: 38, rx: 2, class: 'b-logo-box' }, s);
    this._t(303, 213, 'DIGILENT', 'b-logo', s, 'middle');
    this._t(303, 240, 'www.digilentinc.com', 'b-silk b-silk-xs', s, 'middle');
    this._t(690, 220, 'XILINX', 'b-silk', s);
    this._t(690, 236, 'UNIVERSITY PROGRAM', 'b-silk b-silk-xs', s);
    this._t(510, 396, 'BASYS 3', 'b-wordmark', s, 'middle');
    this._t(510, 416, 'REV C', 'b-silk b-silk-xs', s, 'middle');
    this._t(236, 300, 'LINEAR', 'b-silk', s);
    this._t(236, 314, 'TECHNOLOGY', 'b-silk b-silk-xs', s);
    // small passives for texture (deterministic)
    for (let i = 0; i < 12; i++) el('rect', { x: 436 + i * 12, y: 176, width: 8, height: 4, class: 'b-passive' }, s);
    for (let i = 0; i < 12; i++) el('rect', { x: 436 + i * 12, y: 348, width: 8, height: 4, class: 'b-passive' }, s);
    for (let i = 0; i < 10; i++) el('rect', { x: 418, y: 196 + i * 14, width: 4, height: 8, class: 'b-passive' }, s);
    for (let i = 0; i < 10; i++) el('rect', { x: 592, y: 196 + i * 14, width: 4, height: 8, class: 'b-passive' }, s);
    for (let i = 0; i < 8; i++) el('rect', { x: 300 + i * 12, y: 150, width: 8, height: 4, class: 'b-passive' }, s);
    for (let i = 0; i < 6; i++) el('rect', { x: 690 + i * 12, y: 190, width: 8, height: 4, class: 'b-passive' }, s);

    // ---- four digit seven segment display ----
    const disp = el('g', { transform: `translate(${DISP_X} ${DISP_Y})` }, s);
    el('rect', { x: 0, y: 0, width: 208, height: 66, rx: 2, class: 'b-disp' }, disp);
    this.segEls = [];
    for (let d = 0; d < 4; d++) {
      const gd = el('g', { transform: `translate(${10 + d * DIGIT_STEP} 6) skewX(-6)` }, disp);
      const segs = [];
      for (let k = 0; k < 7; k++) { const [x, y, w, h] = SEG[k]; segs.push(el('rect', { x, y, width: w, height: h, rx: 1, class: 'b-seg' }, gd)); }
      segs.push(el('circle', { cx: 40, cy: 53, r: 2.6, class: 'b-seg' }, gd));
      this.segEls.push(segs);
    }
    for (let d = 0; d < 4; d++) this._t(DISP_X + 27 + d * DIGIT_STEP, DISP_Y + 82, `AN${3 - d}`, 'b-silk b-silk-xs', s, 'middle');
    this._t(DISP_X - 4, DISP_Y - 18, 'CA…CG, DP', 'b-silk b-silk-xs', s);

    // ---- pushbuttons ----
    this.btnEls = {}; this._btnPress = {};
    for (const [name, [x, y]] of Object.entries(BTN)) {
      const g = el('g', { class: 'b-btn', 'data-btn': name }, s);
      el('rect', { x: x - 14, y: y - 14, width: 28, height: 28, rx: 2, class: 'b-btnbase' }, g);
      for (const [dx, dy] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) el('circle', { cx: x + dx, cy: y + dy, r: 1.6, class: 'b-pin' }, g);
      const cap = el('circle', { cx: x, cy: y, r: 8, class: 'b-btn-cap' }, g);
      this.btnEls[name] = cap;
      const LBL = { btnU: [x, y - 20, 'middle'], btnD: [x, y + 28, 'middle'], btnL: [x - 18, y + 26, 'middle'], btnR: [x + 18, y + 26, 'middle'], btnC: [x, y + 26, 'middle'] };
      const [lx, ly, la] = LBL[name];
      this.btnLbl = this.btnLbl || {};
      this.btnLbl[name] = this._t(lx, ly, name.toUpperCase(), 'b-silk b-silk-xs', g, la);
      const press = (v) => (e) => {
        if (e) e.preventDefault();
        if (this.state.btn[name] === v) return;
        this.state.btn[name] = v;
        cap.classList.toggle('on', !!v);
        this.onInput(name, 0, v);
      };
      g.addEventListener('pointerdown', press(1));
      g.addEventListener('pointerup', press(0));
      g.addEventListener('pointerleave', press(0));
      g.addEventListener('pointercancel', press(0));
      this._btnPress[name] = press;
    }

    // ---- leds and slide switches ----
    this.ledEls = []; this.swEls = [];
    for (let i = 0; i < 16; i++) {
      const x = COL_X(i);
      this._t(x, LED_Y - 8, `LD${i}`, 'b-silk b-silk-xs', s, 'middle');
      this.ledEls.push(el('rect', { x: x - 6, y: LED_Y, width: 12, height: 7, rx: 1, class: 'b-led' }, s));
      const g = el('g', { class: 'b-sw', 'data-sw': i }, s);
      el('rect', { x: x - 13, y: SW_Y, width: 26, height: 72, rx: 2, class: 'b-swbody' }, g);
      el('rect', { x: x - 9, y: SW_Y + 6, width: 18, height: 60, rx: 1, class: 'b-swslot' }, g);
      const knob = el('rect', { x: x - 8, y: SW_Y + 38, width: 16, height: 24, rx: 1, class: 'b-swknob' }, g);
      this.swEls.push(knob);
      this._t(x, SW_Y + 88, `SW${i}`, 'b-silk b-silk-xs', g, 'middle');
      g.addEventListener('click', () => this.toggleSwitch(i));
    }
    this._t(66, 434, 'ON', 'b-silk b-silk-xs', s, 'end');
    this.labelLayer = el('g', { class: 'b-labels' }, s);
  }
  toggleSwitch(i) {
    const v = this.state.sw[i] ? 0 : 1;
    this.state.sw[i] = v;
    this.swEls[i].setAttribute('y', v ? SW_Y + 8 : SW_Y + 38);
    this.swEls[i].classList.toggle('on', !!v);
    this.onInput('sw', i, v);
  }
  pressButton(name, v) { this._btnPress[name](v)(); }
  setLed(i, v) {
    if (this.led[i] === v) return;
    this.led[i] = v;
    this.ledEls[i].classList.toggle('on', v === 1);
    this.ledEls[i].classList.toggle('x', v === 0);
  }
  // digit 0 = an0 (rightmost). mask bit k = segment k lit (active-low already resolved)
  setDigit(digit, mask) {
    if (this.digits[digit] === mask) return;
    this.digits[digit] = mask;
    const segs = this.segEls[3 - digit];
    for (let k = 0; k < 8; k++) segs[k].classList.toggle('on', !!(mask & (1 << k)));
  }
  clearOutputs() {
    for (let i = 0; i < 16; i++) this.setLed(i, -1);
    for (let d = 0; d < 4; d++) this.setDigit(d, 0);
  }
  setPower(on) { this.pwr.classList.toggle('on', !!on); this.done.classList.toggle('on', !!on); }
  tickClock(on) { this.clkDot.classList.toggle('on', !!on); }
  // your port names, printed on the silkscreen next to the thing they are wired to
  setLabels(map) {
    this.labelLayer.innerHTML = '';
    for (const [n, t] of Object.entries(this.btnLbl)) { t.textContent = n.toUpperCase(); t.setAttribute('class', 'b-silk b-silk-xs'); }
    const put = (x, y, txt, anchor) => this._t(x, y, txt, 'b-port', this.labelLayer, anchor);
    for (const [port, entries] of Object.entries(map)) {
      for (const e of entries) {
        const name = entries.length > 1 ? `${port}[${e.bit}]` : port;
        if (e.element === 'led') put(COL_X(e.index), LED_Y + 20, name, 'middle');
        else if (e.element === 'sw') put(COL_X(e.index), SW_Y + 100, name, 'middle');
        else if (e.element in BTN) { const t = this.btnLbl[e.element]; t.textContent = name; t.setAttribute('class', 'b-port'); }
        else if (e.element === 'clk') put(392, 296, name, 'middle');
        else if (e.element === 'an') put(DISP_X + 27 + (3 - e.index) * DIGIT_STEP, DISP_Y + 94, name, 'middle');
      }
      const f = entries[0];
      if (f && (f.element === 'seg' || f.element === 'dp')) put(DISP_X + 208 - (f.element === 'dp' ? 90 : 0), DISP_Y - 18, `${port}${f.element === 'seg' ? '[6:0]' : ''}`, 'end');
    }
  }
}
