// dewfpga waveform viewer: the wave window Vivado opens after Run Simulation, for a .vcd.
// One file, no dependencies: `dewfpga wave` inlines it into a page for the browser, the VS Code extension loads it
// into a webview. Black wave area, green traces, buses as hexagons with their value, X in red, Z in blue, a yellow
// cursor whose time and values the Value column shows, blue markers, Scope and Objects panes to add any signal.
(function (root) {
  'use strict';

  // *-*-*-*-*-*-*-*-*-*-*-* vcd parser *-*-*-*-*-*-*-*-*-*-*-*
  const UNIT_S = { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 };

  // the whole file: scopes (a tree), variables (name, width, declared range, type), and per id code the value
  // changes as two parallel arrays, times in the file's ticks and values as strings ('0', '1', 'x', 'z', or the full
  // width of a vector, left-extended the way the VCD standard says).
  function parseVcd(text) {
    const n = text.length;
    let i = 0;
    function skipWs() {
      while (i < n && text.charCodeAt(i) <= 32) {
        i++;
      }
    }
    function word() {
      skipWs();
      const s = i;
      while (i < n && text.charCodeAt(i) > 32) {
        i++;
      }
      return text.slice(s, i);
    }
    function untilEnd() {
      const words = [];
      for (;;) {
        const w = word();
        if (w === '' || w === '$end') {
          break;
        }
        words.push(w);
      }
      return words;
    }
    const top = { name: '', type: 'root', children: [], vars: [], parent: null, path: '' };
    let scope = top;
    const sigs = new Map();
    const vars = [];
    let tick = 1e-9, timescale = '1ns';
    for (;;) {
      const w = word();
      if (w === '') {
        break;
      }
      if (w === '$enddefinitions') {
        untilEnd();
        break;
      }
      if (w === '$timescale') {
        const m = /^(\d+)(s|ms|us|ns|ps|fs)$/.exec(untilEnd().join(''));
        if (m) {
          tick = Number(m[1]) * UNIT_S[m[2]];
          timescale = m[1] + ' ' + m[2];
        }
        continue;
      }
      if (w === '$scope') {
        const ws = untilEnd();
        const sc = { name: ws[1] || '?', type: ws[0] || 'module', children: [], vars: [], parent: scope };
        sc.path = scope.path ? scope.path + '.' + sc.name : sc.name;
        scope.children.push(sc);
        scope = sc;
        continue;
      }
      if (w === '$upscope') {
        untilEnd();
        if (scope.parent) {
          scope = scope.parent;
        }
        continue;
      }
      if (w === '$var') {
        const ws = untilEnd();
        const type = ws[0] || 'wire', width = Math.max(1, Number(ws[1]) || 1), code = ws[2];
        let name = ws[3] || code, range = ws.slice(4).join('');
        const inName = /^(.*?)(\[[^\]]*\])$/.exec(name);
        if (!range && inName) {
          name = inName[1];
          range = inName[2];
        }
        let msb = width - 1, lsb = 0;
        const rm = /^\[(-?\d+)(?::(-?\d+))?\]$/.exec(range);
        if (rm && rm[2] !== undefined) {
          msb = Number(rm[1]);
          lsb = Number(rm[2]);
        }
        const real = type === 'real' || type === 'realtime';
        if (!sigs.has(code)) {
          sigs.set(code, { width: width, real: real, t: [], v: [] });
        }
        const v = { code: code, name: name, range: width > 1 || (rm && rm[2] === undefined) ? range : '', width: width,
          msb: msb, lsb: lsb, type: type, real: real, scope: scope, path: (scope.path ? scope.path + '.' : '') + name };
        scope.vars.push(v);
        vars.push(v);
        continue;
      }
      if (w[0] === '$') {
        untilEnd();
      }
    }
    let t = 0, end = 0, truncated = false;
    function push(code, val) {
      const s = sigs.get(code);
      if (!s) {
        return;
      }
      if (!s.real) {
        val = val.toLowerCase();
        if (val.length < s.width) {
          const pad = val[0] === 'x' || val[0] === 'z' ? val[0] : '0';
          val = pad.repeat(s.width - val.length) + val;
        } else if (val.length > s.width) {
          val = val.slice(val.length - s.width);
        }
      }
      const k = s.t.length - 1;
      if (k >= 0 && s.t[k] === t) {
        s.v[k] = val;
        if (k > 0 && s.v[k - 1] === val) {
          s.t.pop();
          s.v.pop();
        }
        return;
      }
      if (k >= 0 && s.v[k] === val) {
        return;
      }
      s.t.push(t);
      s.v.push(val);
    }
    while (i < n) {
      skipWs();
      if (i >= n) {
        break;
      }
      const c = text.charCodeAt(i);
      if (c === 35) {
        const w = word();
        const tt = Number(w.slice(1));
        if (!Number.isNaN(tt)) {
          t = tt;
          if (t > end) {
            end = t;
          }
        }
        continue;
      }
      if (c === 36) {
        const w = word();
        if (w === '$comment') {
          if (/limit/i.test(untilEnd().join(' '))) {
            truncated = true;
          }
        }
        continue;
      }
      if (c === 98 || c === 66 || c === 114 || c === 82 || c === 115 || c === 83) {
        const w = word();
        const code = word();
        push(code, w.slice(1));
        continue;
      }
      const w = word();
      push(w.slice(1), w[0]);
    }
    return { top: top, vars: vars, sigs: sigs, end: end, tick: tick, timescale: timescale, truncated: truncated };
  }

  // *-*-*-*-*-*-*-*-*-*-*-* values and radix *-*-*-*-*-*-*-*-*-*-*-*
  const RADIX = [
    ['bin', 'Binary'], ['hex', 'Hexadecimal'], ['oct', 'Octal'],
    ['udec', 'Unsigned Decimal'], ['sdec', 'Signed Decimal'], ['ascii', 'ASCII'],
  ];

  function groups(v, size, digits) {
    let out = '';
    for (let e = v.length; e > 0; e -= size) {
      const part = v.slice(Math.max(0, e - size), e);
      if (/^x+$/.test(part)) {
        out = 'X' + out;
      } else if (/^z+$/.test(part)) {
        out = 'Z' + out;
      } else if (/[xz]/.test(part)) {
        out = 'X' + out;
      } else {
        out = digits[parseInt(part, 2)] + out;
      }
    }
    return out;
  }

  // the text a value shows in a radix: what the Value column and a bus segment print
  function format(v, width, radix, real) {
    if (v === undefined || v === null) {
      return '';
    }
    if (real) {
      return String(Number(v));
    }
    if (width === 1 && radix !== 'ascii') {
      return v.toUpperCase();
    }
    if (radix === 'bin') {
      return v.toUpperCase();
    }
    if (radix === 'oct') {
      return groups(v, 3, '01234567');
    }
    if (radix === 'udec' || radix === 'sdec') {
      if (/^z+$/.test(v)) {
        return 'Z';
      }
      if (/[xz]/.test(v)) {
        return 'X';
      }
      let num = BigInt('0b' + v);
      if (radix === 'sdec' && v[0] === '1') {
        num -= 1n << BigInt(width);
      }
      return num.toString();
    }
    if (radix === 'ascii') {
      let s = '';
      for (let e = v.length; e > 0; e -= 8) {
        const part = v.slice(Math.max(0, e - 8), e);
        const code = /[xz]/.test(part) ? 63 : parseInt(part, 2);
        s = (code >= 32 && code < 127 ? String.fromCharCode(code) : '.') + s;
      }
      return s;
    }
    return groups(v, 4, '0123456789abcdef');
  }

  // how a value is drawn: 1, 0, X (any unknown bit), Z (every bit floating), or a known bus value
  function level(v) {
    if (v === '1' || v === 'h') {
      return 1;
    }
    if (v === '0' || v === 'l') {
      return 0;
    }
    if (/^z+$/.test(v)) {
      return 'z';
    }
    if (/[xzuw-]/.test(v)) {
      return 'x';
    }
    return 'v';
  }

  // the last change at or before t, -1 when t is before the first one
  function indexAt(ts, t) {
    let lo = 0, hi = ts.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) {
        at = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return at;
  }

  // *-*-*-*-*-*-*-*-*-*-*-* time text *-*-*-*-*-*-*-*-*-*-*-*
  const UNITS = [['s', 1], ['ms', 1e-3], ['us', 1e-6], ['ns', 1e-9], ['ps', 1e-12], ['fs', 1e-15]];

  // the unit every time is shown in: ns as Vivado shows them, a larger one for a long run, a smaller one when the
  // file's own tick is finer and the whole run is shorter than a nanosecond
  function pickUnit(endSeconds) {
    if (endSeconds >= 1e-2) {
      return ['ms', 1e-3];
    }
    if (endSeconds >= 1e-4) {
      return ['us', 1e-6];
    }
    if (endSeconds > 0 && endSeconds < 1e-9) {
      return ['ps', 1e-12];
    }
    return ['ns', 1e-9];
  }

  function group3(intText) {
    return intText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function timeText(x, decimals, unit) {
    const neg = x < 0;
    const fixed = Math.abs(x).toFixed(decimals);
    const dot = fixed.indexOf('.');
    const whole = group3(dot < 0 ? fixed : fixed.slice(0, dot));
    return (neg ? '-' : '') + whole + (dot < 0 ? '' : fixed.slice(dot)) + ' ' + unit;
  }

  // *-*-*-*-*-*-*-*-*-*-*-* icons *-*-*-*-*-*-*-*-*-*-*-*
  const ICON = {
    zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4M7 5v4"/>',
    zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4"/>',
    zoomFit: '<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3M5 8h6M6.5 6.5 5 8l1.5 1.5M9.5 6.5 11 8l-1.5 1.5"/>',
    start: '<path d="M3 3v10M13 3 6 8l7 5z"/>',
    end: '<path d="M13 3v10M3 3l7 5-7 5z"/>',
    prevEdge: '<path d="M15 12h-4V4H8M6 8H1M3.5 5.5 1 8l2.5 2.5"/>',
    nextEdge: '<path d="M1 12h4V4h3M10 8h5M12.5 5.5 15 8l-2.5 2.5"/>',
    marker: '<path d="M5 14V2l7 3-7 3M11 11h4M13 9v4"/>',
    prevMarker: '<path d="M8 14V2l6 3-6 3M5 8H1M3 6 1 8l2 2"/>',
    nextMarker: '<path d="M3 14V2l6 3-6 3M11 11h4M13 9l2 2-2 2"/>',
    clearMarkers: '<path d="M5 14V2l7 3-7 3M10 10l4 4M14 10l-4 4"/>',
    snap: '<path d="M3 2v6a5 5 0 0 0 10 0V2h-3v6a2 2 0 0 1-4 0V2zM3 5h3M10 5h3"/>',
    panes: '<path d="M2 3h12v10H2zM6 3v10"/>',
  };
  function icon(name) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) {
      e.className = cls;
    }
    if (html !== undefined) {
      e.innerHTML = html;
    }
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // *-*-*-*-*-*-*-*-*-*-*-* colors *-*-*-*-*-*-*-*-*-*-*-*
  // Vivado's wave window: black, green, red for X, a yellow cursor, blue markers
  const C = {
    bg: '#000000', wave: '#00e600', text: '#f0f0f0', x: '#ff3030', xFill: 'rgba(255, 48, 48, 0.28)',
    z: '#3d9bff', cursor: '#ffeb3b', marker: '#4d8dff', grid: '#161616', rowSel: 'rgba(38, 79, 120, 0.45)',
    rulerBg: '#0b0b0b', rulerText: '#c8c8c8', tickMajor: '#5a5a5a', tickMinor: '#333333',
  };

  const ROW = 22;

  // *-*-*-*-*-*-*-*-*-*-*-* the viewer *-*-*-*-*-*-*-*-*-*-*-*
  // mount(host, opts): opts.name (the file's name), opts.store ({load(), save(config)} or null), opts.vcd (text).
  // Returns { load(text, name) }: a new run of the same testbench keeps the signals, their radix, the markers and
  // the zoom, as Vivado keeps the wave configuration when the simulation is relaunched.
  function mount(host, opts) {
    opts = opts || {};
    const store = opts.store || null;
    const S = {
      data: null, name: opts.name || 'waveform', entries: [], rows: [], sel: new Set(), anchor: -1,
      view: [0, 1], cursor: 0, markers: [], snap: true, scope: null, filter: '', nameW: 210, valW: 96, nextId: 1,
      panes: true, hover: null,
    };

    host.classList.add('dw');
    host.tabIndex = 0;
    host.innerHTML = '';
    const topbar = el('div', 'dw-top');
    const panesBtn = el('button', 'dw-btn dw-panes-btn', icon('panes'));
    panesBtn.title = 'Show or hide the Scope and Objects panes';
    const title = el('div', 'dw-title');
    const info = el('div', 'dw-info');
    topbar.append(panesBtn, title, info);

    const main = el('div', 'dw-main');
    const side = el('aside', 'dw-side');
    const scopePane = el('section', 'dw-pane dw-scope');
    scopePane.append(el('h3', '', 'Scope'));
    const tree = el('div', 'dw-tree');
    scopePane.append(tree);
    const objPane = el('section', 'dw-pane dw-objects');
    objPane.append(el('h3', '', 'Objects'));
    const search = el('input', 'dw-search');
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search objects');
    const objHead = el('div', 'dw-obj dw-obj-head', '<span>Name</span><span>Value</span><span>Data Type</span>');
    const objList = el('div', 'dw-objlist');
    objPane.append(search, objHead, objList);
    side.append(scopePane, objPane);

    const win = el('section', 'dw-win');
    const tab = el('div', 'dw-tab');
    const body = el('div', 'dw-body');
    const tools = el('div', 'dw-tools');
    const grid = el('div', 'dw-grid');
    const head = el('div', 'dw-head');
    const hName = el('div', 'dw-h dw-h-name', '<span>Name</span><i class="dw-split" data-col="name"></i>');
    const hVal = el('div', 'dw-h dw-h-val', '<span>Value</span><i class="dw-split" data-col="val"></i>');
    const ruler = el('canvas', 'dw-ruler');
    head.append(hName, hVal, ruler);
    const scroll = el('div', 'dw-scroll');
    const rowsEl = el('div', 'dw-rows');
    const waveWrap = el('div', 'dw-wavewrap');
    const canvas = el('canvas', 'dw-canvas');
    waveWrap.append(canvas);
    scroll.append(rowsEl, waveWrap);
    const hbar = el('div', 'dw-hbar');
    const thumb = el('div', 'dw-thumb');
    hbar.append(thumb);
    grid.append(head, scroll, hbar);
    body.append(tools, grid);
    win.append(tab, body);
    main.append(side, win);
    const status = el('div', 'dw-status');
    const tip = el('div', 'dw-tip');
    const menu = el('div', 'dw-menu');
    host.append(topbar, main, status, tip, menu);

    const TOOLS = [
      ['zoomIn', 'Zoom In (+, or ⌘/Ctrl + wheel)', function () { zoomBy(0.5); }],
      ['zoomOut', 'Zoom Out (−)', function () { zoomBy(2); }],
      ['zoomFit', 'Zoom Fit (F)', function () { fit(); }],
      null,
      ['start', 'Go To Time 0 (Home)', function () { setCursor(0, true); }],
      ['end', 'Go To Last Time (End)', function () { setCursor(S.data ? S.data.end : 0, true); }],
      ['prevEdge', 'Previous Transition (←)', function () { jumpEdge(-1); }],
      ['nextEdge', 'Next Transition (→)', function () { jumpEdge(1); }],
      null,
      ['marker', 'Add Marker (M)', function () { addMarker(); }],
      ['prevMarker', 'Previous Marker', function () { jumpMarker(-1); }],
      ['nextMarker', 'Next Marker', function () { jumpMarker(1); }],
      ['clearMarkers', 'Delete All Markers', function () { S.markers = []; save(); draw(); }],
      null,
      ['snap', 'Snap to Transition (S)', function () { S.snap = !S.snap; snapBtn.classList.toggle('on', S.snap); save(); }],
    ];
    let snapBtn = null;
    for (const t of TOOLS) {
      if (!t) {
        tools.append(el('span', 'dw-tool-gap'));
        continue;
      }
      const b = el('button', 'dw-btn', icon(t[0]));
      b.title = t[1];
      b.setAttribute('aria-label', t[1]);
      b.dataset.tool = t[0];
      b.addEventListener('click', function () {
        t[2]();
        host.focus({ preventScroll: true });
      });
      tools.append(b);
      if (t[0] === 'snap') {
        snapBtn = b;
        b.classList.add('on');
      }
    }

    // *-*-*-*-*-*-*-*-*-*-*-* entries and rows *-*-*-*-*-*-*-*-*-*-*-*
    // an entry is a signal added to the wave window; a row is what is drawn: an entry, or one bit of an expanded bus
    function entryFor(v) {
      return { id: S.nextId++, v: v, radix: v.type === 'integer' ? 'sdec' : 'hex', expanded: false, bits: null };
    }

    function rebuildRows() {
      S.rows = [];
      for (const e of S.entries) {
        S.rows.push({ e: e, bit: -1 });
        if (e.expanded && e.v.width > 1 && !e.v.real) {
          for (let k = 0; k < e.v.width; k++) {
            S.rows.push({ e: e, bit: k });
          }
        }
      }
    }

    // a row's changes: the variable's own, or (one bit of a bus) the times that bit changes
    function series(row) {
      const s = S.data.sigs.get(row.e.v.code);
      if (row.bit < 0) {
        return s;
      }
      if (!row.e.bits) {
        row.e.bits = [];
      }
      if (!row.e.bits[row.bit]) {
        const t = [], v = [];
        for (let k = 0; k < s.t.length; k++) {
          const c = s.v[k][row.bit];
          if (v.length && v[v.length - 1] === c) {
            continue;
          }
          t.push(s.t[k]);
          v.push(c);
        }
        row.e.bits[row.bit] = { width: 1, real: false, t: t, v: v };
      }
      return row.e.bits[row.bit];
    }

    function bitIndex(v, k) {
      const step = v.msb >= v.lsb ? -1 : 1;
      return v.msb + step * k;
    }

    function rowLabel(row) {
      const v = row.e.v;
      if (row.bit >= 0) {
        return '[' + bitIndex(v, row.bit) + ']';
      }
      return v.name + (v.range || '');
    }

    function valueAt(row, t) {
      const s = series(row);
      const k = indexAt(s.t, t);
      return k < 0 ? undefined : s.v[k];
    }

    function rowValueText(row, t) {
      const s = series(row);
      const v = valueAt(row, t);
      return format(v, s.width, row.e.radix, s.real);
    }

    // *-*-*-*-*-*-*-*-*-*-*-* config: what survives a reload *-*-*-*-*-*-*-*-*-*-*-*
    function config() {
      return {
        v: 2, rows: S.entries.map(function (e) { return { path: e.v.path, radix: e.radix, expanded: e.expanded }; }),
        markers: S.markers.slice(), view: S.view.slice(), cursor: S.cursor, snap: S.snap,
        nameW: S.nameW, valW: S.valW, panes: S.panes, scope: S.scope ? S.scope.path : null,
      };
    }
    let saveTimer = 0;
    function save() {
      if (!store) {
        return;
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          store.save(config());
        } catch (err) {
          // a page opened from a file, in a private window, may refuse storage: the viewer works without it
        }
      }, 150);
    }
    function loadConfig() {
      if (!store) {
        return null;
      }
      try {
        const c = store.load();
        return c && c.v === 2 ? c : null;
      } catch (err) {
        return null;
      }
    }

    // what a first open shows, as Vivado does: the signals of the testbench's own scope, in the file's order
    function defaultEntries(d) {
      let sc = d.top;
      while (sc.vars.length === 0 && sc.children.length > 0) {
        const withVars = sc.children.find(function (c) { return c.vars.length > 0; });
        sc = withVars || sc.children[0];
      }
      const pick = sc.vars.filter(function (v) { return v.type !== 'parameter' && !/^errors?$/i.test(v.name); });
      return { scope: sc, entries: (pick.length ? pick : sc.vars).slice(0, 200).map(entryFor) };
    }

    function findScope(path) {
      function walk(sc) {
        if (sc.path === path) {
          return sc;
        }
        for (const c of sc.children) {
          const f = walk(c);
          if (f) {
            return f;
          }
        }
        return null;
      }
      return path === null ? null : walk(S.data.top);
    }

    function load(text, name) {
      let d;
      try {
        d = parseVcd(text);
      } catch (err) {
        tab.textContent = name || S.name;
        status.textContent = 'This file could not be read as a VCD: ' + err.message;
        return;
      }
      const first = S.data === null;
      S.data = d;
      S.name = name || S.name;
      const byPath = new Map(d.vars.map(function (v) { return [v.path, v]; }));
      const keep = first ? loadConfig() : config();
      S.entries = [];
      if (keep && keep.rows && keep.rows.length) {
        for (const r of keep.rows) {
          const v = byPath.get(r.path);
          if (v) {
            const e = entryFor(v);
            e.radix = r.radix || e.radix;
            e.expanded = !!r.expanded;
            S.entries.push(e);
          }
        }
      }
      const def = defaultEntries(d);
      if (S.entries.length === 0) {
        S.entries = def.entries;
      }
      S.scope = (keep && keep.scope !== undefined && findScope(keep.scope)) || def.scope;
      S.markers = keep && keep.markers ? keep.markers.filter(function (m) { return m >= 0 && m <= Math.max(d.end, 1); }) : [];
      if (keep) {
        S.snap = keep.snap !== false;
        S.nameW = keep.nameW || S.nameW;
        S.valW = keep.valW || S.valW;
        if (keep.panes === false || keep.panes === true) {
          S.panes = keep.panes;
        }
      }
      snapBtn.classList.toggle('on', S.snap);
      S.sel = new Set();
      S.anchor = -1;
      rebuildRows();
      const end = Math.max(d.end, 1);
      if (keep && keep.view && keep.view[1] > keep.view[0] && keep.view[0] < end) {
        S.view = [Math.max(0, keep.view[0]), Math.min(keep.view[1], end * 1.0)];
        if (S.view[1] <= S.view[0]) {
          S.view = [0, end];
        }
      } else {
        S.view = [0, end];
      }
      S.cursor = keep && typeof keep.cursor === 'number' && keep.cursor <= d.end ? keep.cursor : d.end;
      S.unit = pickUnit(d.end * d.tick);
      tab.textContent = S.name;
      title.innerHTML = '<b>' + esc(S.name) + '</b>';
      const sigCount = d.vars.length;
      info.textContent = timeText(0, 0, S.unit[0]).replace(/ .*/, '') + ' – ' + tText(d.end) + ' · ' + sigCount +
        ' signal' + (sigCount === 1 ? '' : 's') + ' · timescale ' + d.timescale;
      if (d.truncated) {
        info.textContent += ' · the file stopped growing at its size limit, so the end is cut';
      }
      host.classList.toggle('dw-nopanes', !S.panes);
      layout();
      renderTree();
      renderObjects();
      renderRows();
      draw();
      save();
    }

    // *-*-*-*-*-*-*-*-*-*-*-* time <-> x *-*-*-*-*-*-*-*-*-*-*-*
    function tText(t, decimals) {
      const x = (t * S.data.tick) / S.unit[1];
      return timeText(x, decimals === undefined ? 3 : decimals, S.unit[0]);
    }
    function waveW() {
      return canvas.clientWidth || 1;
    }
    function tToX(t) {
      return ((t - S.view[0]) / (S.view[1] - S.view[0])) * waveW();
    }
    function xToT(x) {
      return S.view[0] + (x / waveW()) * (S.view[1] - S.view[0]);
    }
    function clampView(t0, t1) {
      const end = Math.max(S.data.end, 1);
      let span = Math.max(t1 - t0, Math.min(end, 4));
      span = Math.min(span, end);
      t0 = Math.max(0, Math.min(t0, end - span));
      S.view = [t0, t0 + span];
    }
    function zoomBy(k, atT) {
      if (!S.data) {
        return;
      }
      const [t0, t1] = S.view;
      let c = atT;
      if (c === undefined) {
        c = S.cursor >= t0 && S.cursor <= t1 ? S.cursor : (t0 + t1) / 2;
      }
      clampView(c - (c - t0) * k, c + (t1 - c) * k);
      save();
      draw();
    }
    function fit() {
      if (!S.data) {
        return;
      }
      S.view = [0, Math.max(S.data.end, 1)];
      save();
      draw();
    }
    function reveal(t) {
      const [t0, t1] = S.view;
      if (t < t0 || t > t1) {
        const span = t1 - t0;
        clampView(t - span / 2, t + span / 2);
      }
    }
    function setCursor(t, show) {
      if (!S.data) {
        return;
      }
      S.cursor = Math.max(0, Math.min(Math.round(t), S.data.end));
      if (show) {
        reveal(S.cursor);
      }
      save();
      draw();
    }

    // the transition nearest x on a row, within a few pixels; otherwise the time under x
    function snapAt(row, x) {
      const t = xToT(x);
      if (!S.snap || !row) {
        return t;
      }
      const s = series(row);
      const k = indexAt(s.t, t);
      let best = t, bestPx = 7;
      for (const j of [k, k + 1]) {
        if (j >= 0 && j < s.t.length) {
          const px = Math.abs(tToX(s.t[j]) - x);
          if (px < bestPx) {
            bestPx = px;
            best = s.t[j];
          }
        }
      }
      return best;
    }

    function selectedRows() {
      const list = S.rows.filter(function (r) { return S.sel.has(rowKey(r)); });
      return list.length ? list : S.rows.slice(0, 0);
    }
    function rowKey(r) {
      return r.e.id + ':' + r.bit;
    }

    function jumpEdge(dir) {
      if (!S.data) {
        return;
      }
      let rows = selectedRows();
      if (rows.length === 0) {
        rows = S.rows;
      }
      let best = null;
      for (const r of rows) {
        const s = series(r);
        const k = indexAt(s.t, S.cursor);
        let t = null;
        if (dir > 0) {
          if (k + 1 < s.t.length) {
            t = s.t[k + 1];
          }
        } else if (k >= 0) {
          t = s.t[k] < S.cursor ? s.t[k] : (k > 0 ? s.t[k - 1] : null);
        }
        if (t !== null && (best === null || (dir > 0 ? t < best : t > best))) {
          best = t;
        }
      }
      if (best !== null) {
        setCursor(best, true);
      }
    }

    function addMarker() {
      if (!S.data || S.markers.indexOf(S.cursor) >= 0) {
        return;
      }
      S.markers.push(S.cursor);
      S.markers.sort(function (a, b) { return a - b; });
      save();
      draw();
    }
    function jumpMarker(dir) {
      const list = dir > 0 ? S.markers.filter(function (m) { return m > S.cursor; })
        : S.markers.filter(function (m) { return m < S.cursor; }).reverse();
      if (list.length) {
        setCursor(list[0], true);
      }
    }

    // *-*-*-*-*-*-*-*-*-*-*-* scope and objects panes *-*-*-*-*-*-*-*-*-*-*-*
    function renderTree() {
      tree.innerHTML = '';
      function walk(sc, depth) {
        const it = el('div', 'dw-node' + (S.scope === sc ? ' on' : ''));
        it.style.paddingLeft = (6 + depth * 14) + 'px';
        it.innerHTML = '<span class="dw-node-ic">' + (sc.type === 'module' ? '▣' : '◇') + '</span>' + esc(sc.name);
        it.title = sc.path + ' (' + sc.type + ')';
        it.addEventListener('click', function () {
          S.scope = sc;
          renderTree();
          renderObjects();
          save();
        });
        it.addEventListener('contextmenu', function (ev) {
          ev.preventDefault();
          openMenu(ev.clientX, ev.clientY, [
            ['Add to Wave Window', function () { addVars(sc.vars.filter(function (v) { return v.type !== 'parameter' && !/^errors?$/i.test(v.name); })); }],
          ]);
        });
        tree.append(it);
        for (const c of sc.children) {
          if (!hiddenScope(c)) {
            walk(c, depth + 1);
          }
        }
      }
      for (const c of S.data.top.children) {
        if (!hiddenScope(c)) {
          walk(c, 0);
        }
      }
    }

    // the scopes Icarus makes for a for loop's variable ($ivl_for_loop3): not part of the design, Vivado shows none
    function hiddenScope(sc) {
      return /^\$ivl_/.test(sc.name);
    }

    function typeText(v) {
      if (v.real) {
        return 'Real';
      }
      return (v.type === 'integer' ? 'Integer' : v.width > 1 ? 'Array' : 'Logic') + (v.range && v.width > 1 ? ' ' + v.range : '');
    }

    function renderObjects() {
      objList.innerHTML = '';
      if (!S.scope) {
        return;
      }
      const q = S.filter.toLowerCase();
      for (const v of S.scope.vars) {
        if ((q && v.name.toLowerCase().indexOf(q) < 0) || /^errors?$/i.test(v.name)) {
          continue;
        }
        const it = el('div', 'dw-obj');
        it.draggable = true;
        const s = S.data.sigs.get(v.code);
        const k = indexAt(s.t, S.cursor);
        const val = format(k < 0 ? undefined : s.v[k], v.width, v.type === 'integer' ? 'sdec' : 'hex', v.real);
        it.innerHTML = '<span class="dw-obj-name">' + esc(v.name + (v.range || '')) + '</span><span class="dw-obj-val">' +
          esc(val) + '</span><span class="dw-obj-type">' + esc(typeText(v)) + '</span>';
        it.title = v.path + ': double-click, or drag into the wave window, to add it';
        it.addEventListener('dblclick', function () { addVars([v]); });
        it.addEventListener('dragstart', function (ev) {
          ev.dataTransfer.setData('text/x-dewwave', v.path);
          ev.dataTransfer.effectAllowed = 'copy';
        });
        it.addEventListener('contextmenu', function (ev) {
          ev.preventDefault();
          openMenu(ev.clientX, ev.clientY, [['Add to Wave Window', function () { addVars([v]); }]]);
        });
        objList.append(it);
      }
      if (!objList.firstChild) {
        objList.append(el('div', 'dw-empty', q ? 'No object matches.' : 'No objects in this scope.'));
      }
    }

    function addVars(list, at) {
      const added = list.map(entryFor);
      if (at === undefined || at < 0 || at > S.entries.length) {
        S.entries = S.entries.concat(added);
      } else {
        S.entries.splice.apply(S.entries, [at, 0].concat(added));
      }
      rebuildRows();
      S.sel = new Set(added.map(function (e) { return e.id + ':-1'; }));
      renderRows();
      draw();
      save();
    }

    // *-*-*-*-*-*-*-*-*-*-*-* name and value columns *-*-*-*-*-*-*-*-*-*-*-*
    function renderRows() {
      rowsEl.innerHTML = '';
      S.rows.forEach(function (r, idx) {
        const it = el('div', 'dw-row' + (S.sel.has(rowKey(r)) ? ' sel' : '') + (r.bit >= 0 ? ' bit' : ''));
        it.dataset.idx = idx;
        const v = r.e.v;
        const bus = r.bit < 0 && v.width > 1 && !v.real;
        const exp = bus ? '<span class="dw-exp">' + (r.e.expanded ? '▾' : '▸') + '</span>' : '<span class="dw-exp"></span>';
        const ic = '<svg class="dw-ic" viewBox="0 0 14 10" aria-hidden="true"><path d="' +
          (bus ? 'M0.5 5 2.5 1h9l2 4-2 4h-9z' : 'M0 8.5h4v-7h5v7h5') + '"/></svg>';
        it.innerHTML = '<div class="dw-n">' + exp + ic + '<span class="dw-label">' + esc(rowLabel(r)) +
          '</span></div><div class="dw-v"></div>';
        it.title = v.path + (r.bit >= 0 ? '[' + bitIndex(v, r.bit) + ']' : '');
        rowsEl.append(it);
      });
      if (S.rows.length === 0) {
        rowsEl.append(el('div', 'dw-empty dw-norows', 'Add signals from Objects: double-click one, or drag it here.'));
      }
      updateValues();
      sizeScroll();
    }

    function updateValues() {
      const cells = rowsEl.querySelectorAll('.dw-row');
      cells.forEach(function (it) {
        const r = S.rows[Number(it.dataset.idx)];
        const v = it.querySelector('.dw-v');
        const text = S.data ? rowValueText(r, S.cursor) : '';
        v.textContent = text;
        v.classList.toggle('x', /X/.test(text) && !/^[0-9a-f]/i.test(text.replace(/X/g, '')) ? true : text === 'X');
        v.classList.toggle('z', text === 'Z');
      });
    }

    function rowAt(clientY) {
      const r = rowsEl.getBoundingClientRect();
      const idx = Math.floor((clientY - r.top) / ROW);
      return idx >= 0 && idx < S.rows.length ? idx : -1;
    }

    function selectRow(idx, ev) {
      const key = rowKey(S.rows[idx]);
      if (ev && (ev.metaKey || ev.ctrlKey)) {
        if (S.sel.has(key)) {
          S.sel.delete(key);
        } else {
          S.sel.add(key);
        }
        S.anchor = idx;
      } else if (ev && ev.shiftKey && S.anchor >= 0) {
        S.sel = new Set();
        const a = Math.min(S.anchor, idx), b = Math.max(S.anchor, idx);
        for (let k = a; k <= b; k++) {
          S.sel.add(rowKey(S.rows[k]));
        }
      } else {
        S.sel = new Set([key]);
        S.anchor = idx;
      }
      renderRows();
      draw();
    }

    function toggleExpand(e) {
      if (e.v.width <= 1 || e.v.real) {
        return;
      }
      e.expanded = !e.expanded;
      rebuildRows();
      renderRows();
      draw();
      save();
    }

    function removeSelected() {
      const ids = new Set(selectedRows().filter(function (r) { return r.bit < 0; }).map(function (r) { return r.e.id; }));
      if (ids.size === 0) {
        return;
      }
      S.entries = S.entries.filter(function (e) { return !ids.has(e.id); });
      S.sel = new Set();
      rebuildRows();
      renderRows();
      draw();
      save();
    }

    function setRadix(radix) {
      for (const r of selectedRows()) {
        r.e.radix = radix;
      }
      renderRows();
      draw();
      renderObjects();
      save();
    }

    function rowMenu(ev, idx) {
      if (!S.sel.has(rowKey(S.rows[idx]))) {
        selectRow(idx);
      }
      const r = S.rows[idx];
      const items = [];
      const radixNow = r.e.radix;
      items.push(['Radix', null]);
      for (const [key, label] of RADIX) {
        items.push([(radixNow === key ? '✓ ' : ' ') + label, function () { setRadix(key); }, 'sub']);
      }
      if (r.e.v.width > 1 && !r.e.v.real && r.bit < 0) {
        items.push(['-']);
        items.push([r.e.expanded ? 'Collapse' : 'Expand', function () { toggleExpand(r.e); }]);
      }
      items.push(['-']);
      items.push(['Add Marker at Cursor', addMarker]);
      items.push(['Delete', removeSelected]);
      openMenu(ev.clientX, ev.clientY, items);
    }

    let rowDrag = null;
    rowsEl.addEventListener('pointerdown', function (ev) {
      const idx = rowAt(ev.clientY);
      if (idx < 0 || ev.button !== 0) {
        return;
      }
      if (ev.target.classList.contains('dw-exp') && S.rows[idx].bit < 0) {
        toggleExpand(S.rows[idx].e);
        return;
      }
      if (!S.sel.has(rowKey(S.rows[idx])) || ev.shiftKey || ev.metaKey || ev.ctrlKey) {
        selectRow(idx, ev);
      }
      rowDrag = { y: ev.clientY, idx: idx, moving: false };
    });
    rowsEl.addEventListener('dblclick', function (ev) {
      const idx = rowAt(ev.clientY);
      if (idx >= 0 && S.rows[idx].bit < 0) {
        toggleExpand(S.rows[idx].e);
      }
    });
    rowsEl.addEventListener('contextmenu', function (ev) {
      const idx = rowAt(ev.clientY);
      if (idx >= 0) {
        ev.preventDefault();
        rowMenu(ev, idx);
      }
    });
    const dropLine = el('div', 'dw-drop');
    scroll.append(dropLine);
    function entryIndexAt(clientY) {
      const idx = rowAt(clientY);
      const r = rowsEl.getBoundingClientRect();
      if (idx < 0) {
        return clientY < r.top ? 0 : S.entries.length;
      }
      const e = S.rows[idx].e;
      let at = S.entries.indexOf(e);
      if (clientY - r.top - idx * ROW > ROW / 2 && S.rows[idx].bit < 0 && !e.expanded) {
        at++;
      }
      return at;
    }
    function showDrop(at) {
      let y = 0;
      for (let k = 0; k < S.rows.length; k++) {
        if (S.rows[k].bit < 0 && S.entries.indexOf(S.rows[k].e) === at) {
          break;
        }
        y += ROW;
      }
      dropLine.style.top = y + 'px';
      dropLine.style.display = 'block';
    }
    window.addEventListener('pointermove', function (ev) {
      if (!rowDrag) {
        return;
      }
      if (!rowDrag.moving && Math.abs(ev.clientY - rowDrag.y) > 4) {
        rowDrag.moving = true;
      }
      if (rowDrag.moving) {
        showDrop(entryIndexAt(ev.clientY));
      }
    });
    window.addEventListener('pointerup', function (ev) {
      if (rowDrag && rowDrag.moving) {
        const at = entryIndexAt(ev.clientY);
        const moving = new Set(selectedRows().map(function (r) { return r.e; }));
        const before = S.entries.slice(0, at).filter(function (e) { return !moving.has(e); });
        const after = S.entries.slice(at).filter(function (e) { return !moving.has(e); });
        S.entries = before.concat(S.entries.filter(function (e) { return moving.has(e); }), after);
        rebuildRows();
        renderRows();
        draw();
        save();
      } else if (rowDrag && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
        const idx = rowAt(ev.clientY);
        if (idx >= 0 && S.sel.size > 1) {
          selectRow(idx);
        }
      }
      rowDrag = null;
      dropLine.style.display = 'none';
    });
    scroll.addEventListener('dragover', function (ev) {
      if (Array.prototype.indexOf.call(ev.dataTransfer.types, 'text/x-dewwave') >= 0) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
        showDrop(entryIndexAt(ev.clientY));
      }
    });
    scroll.addEventListener('dragleave', function () { dropLine.style.display = 'none'; });
    scroll.addEventListener('drop', function (ev) {
      const path = ev.dataTransfer.getData('text/x-dewwave');
      dropLine.style.display = 'none';
      if (!path) {
        return;
      }
      ev.preventDefault();
      const v = S.data.vars.find(function (x) { return x.path === path; });
      if (v) {
        addVars([v], entryIndexAt(ev.clientY));
      }
    });

    // *-*-*-*-*-*-*-*-*-*-*-* menu and tooltip *-*-*-*-*-*-*-*-*-*-*-*
    function openMenu(x, y, items) {
      menu.innerHTML = '';
      for (const it of items) {
        if (it[0] === '-') {
          menu.append(el('div', 'dw-menu-sep'));
          continue;
        }
        if (it[1] === null) {
          menu.append(el('div', 'dw-menu-head', esc(it[0])));
          continue;
        }
        const b = el('button', 'dw-menu-item' + (it[2] ? ' ' + it[2] : ''), esc(it[0]));
        b.addEventListener('click', function () {
          closeMenu();
          it[1]();
        });
        menu.append(b);
      }
      menu.style.display = 'block';
      const hr = host.getBoundingClientRect();
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(x - hr.left, hr.width - mw - 4)) + 'px';
      menu.style.top = Math.max(4, Math.min(y - hr.top, hr.height - mh - 4)) + 'px';
    }
    function closeMenu() {
      menu.style.display = 'none';
    }
    document.addEventListener('pointerdown', function (ev) {
      if (!menu.contains(ev.target)) {
        closeMenu();
      }
    }, true);

    // *-*-*-*-*-*-*-*-*-*-*-* drawing *-*-*-*-*-*-*-*-*-*-*-*
    function fitCanvas(cv, w, h) {
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return g;
    }

    function niceStep(raw) {
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      const m = raw / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    }

    function drawRuler(W) {
      const H = ruler.clientHeight || 36;
      const g = fitCanvas(ruler, W, H);
      g.fillStyle = C.rulerBg;
      g.fillRect(0, 0, W, H);
      if (!S.data) {
        return;
      }
      const toUnit = S.data.tick / S.unit[1];
      const spanU = (S.view[1] - S.view[0]) * toUnit;
      const step = niceStep((spanU * 110) / Math.max(W, 1));
      const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
      const minor = step / 5;
      g.font = '11px ' + FONT;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      const u0 = S.view[0] * toUnit, u1 = S.view[1] * toUnit;
      for (let u = Math.floor(u0 / minor) * minor; u <= u1 + minor; u += minor) {
        const x = Math.round(((u - u0) / (u1 - u0)) * W) + 0.5;
        const major = Math.abs(u / step - Math.round(u / step)) < 1e-6;
        g.strokeStyle = major ? C.tickMajor : C.tickMinor;
        g.beginPath();
        g.moveTo(x, H - (major ? 10 : 5));
        g.lineTo(x, H);
        g.stroke();
        if (major) {
          g.fillStyle = C.rulerText;
          g.fillText(timeText(Math.round(u / step) * step, decimals, S.unit[0]), x + 3, H - 12);
        }
      }
      // markers, then the cursor on top: their time in a box at the ruler's top, as Vivado labels them
      g.font = '11px ' + FONT;
      g.textBaseline = 'middle';
      const box = function (t, fill, ink) {
        const x = tToX(t);
        if (x < -1 || x > W + 1) {
          return;
        }
        const label = tText(t);
        const w = g.measureText(label).width + 10;
        const bx = Math.max(0, Math.min(x - w / 2, W - w));
        g.fillStyle = fill;
        g.fillRect(bx, 1, w, 15);
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.fillText(label, bx + w / 2, 9);
        g.fillStyle = fill;
        g.fillRect(Math.round(x), 16, 1, H - 16);
      };
      for (const m of S.markers) {
        box(m, C.marker, '#ffffff');
      }
      box(S.cursor, C.cursor, '#000000');
    }

    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    function drawBit(g, s, y0, W) {
      const hi = y0 + 4.5, lo = y0 + ROW - 5.5, mid = (hi + lo) / 2;
      const ts = s.t, vs = s.v;
      let k = indexAt(ts, S.view[0]);
      if (k < 0) {
        k = 0;
      }
      const yOf = function (lv) { return lv === 1 ? hi : lv === 0 ? lo : mid; };
      const endX = tToX(S.data.end);
      let prevY = null;
      g.lineWidth = 1.5;
      while (k < ts.length) {
        const xa = Math.max(-2, tToX(ts[k]));
        if (xa > W + 2) {
          break;
        }
        let next = k + 1;
        let xb = next < ts.length ? tToX(ts[next]) : endX;
        // many changes inside one pixel: one green block, the way a dense clock looks zoomed out
        if (xb - xa < 1 && next < ts.length) {
          const tEndPx = xToT(xa + 1);
          let j = indexAt(ts, tEndPx);
          if (j <= k) {
            j = k + 1;
          }
          const xj = j < ts.length ? tToX(ts[j]) : endX;
          g.fillStyle = C.wave;
          g.fillRect(xa, hi, Math.max(1, xj - xa), lo - hi);
          prevY = null;
          k = j;
          continue;
        }
        xb = Math.min(xb, W + 2);
        const lv = level(vs[k]);
        if (lv === 'x') {
          g.fillStyle = C.xFill;
          g.fillRect(xa, hi, xb - xa, lo - hi);
          g.strokeStyle = C.x;
          g.beginPath();
          g.moveTo(xa, hi);
          g.lineTo(xb, hi);
          g.moveTo(xa, lo);
          g.lineTo(xb, lo);
          if (xa > 0) {
            g.moveTo(xa, hi);
            g.lineTo(xa, lo);
          }
          g.stroke();
          prevY = null;
        } else {
          const y = yOf(lv);
          g.strokeStyle = lv === 'z' ? C.z : C.wave;
          g.beginPath();
          if (prevY !== null && prevY !== y) {
            g.moveTo(xa, prevY);
            g.lineTo(xa, y);
          } else {
            g.moveTo(xa, y);
          }
          g.lineTo(xb, y);
          g.stroke();
          prevY = lv === 'z' ? null : y;
        }
        k = next;
      }
    }

    function drawBus(g, s, y0, W, radix) {
      const hi = y0 + 4.5, lo = y0 + ROW - 5.5, mid = (hi + lo) / 2;
      const ts = s.t, vs = s.v;
      let k = indexAt(ts, S.view[0]);
      if (k < 0) {
        k = 0;
      }
      const endX = tToX(S.data.end);
      g.lineWidth = 1;
      g.font = '11px ' + FONT;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      while (k < ts.length) {
        const xa = tToX(ts[k]);
        if (xa > W + 2) {
          break;
        }
        let next = k + 1;
        const xbRaw = next < ts.length ? tToX(ts[next]) : endX;
        if (xbRaw - xa < 2 && next < ts.length) {
          const j0 = indexAt(ts, xToT(xa + 2));
          const j = j0 <= k ? k + 1 : j0;
          const xj = j < ts.length ? tToX(ts[j]) : endX;
          g.fillStyle = C.wave;
          g.fillRect(xa, hi, Math.max(1, xj - xa), lo - hi);
          k = j;
          continue;
        }
        const xb = xbRaw;
        const lv = level(vs[k]);
        const color = lv === 'x' ? C.x : lv === 'z' ? C.z : C.wave;
        g.strokeStyle = color;
        if (lv === 'z') {
          g.beginPath();
          g.moveTo(xa, mid);
          g.lineTo(xb, mid);
          g.stroke();
        } else {
          const e = Math.min(3, (xb - xa) / 2);
          const a = Math.max(xa, -10), b = Math.min(xb, W + 10);
          g.beginPath();
          g.moveTo(xa, mid);
          g.lineTo(xa + e, hi);
          g.lineTo(Math.max(a, xb - e), hi);
          g.lineTo(xb, mid);
          g.lineTo(Math.max(a, xb - e), lo);
          g.lineTo(xa + e, lo);
          g.closePath();
          if (lv === 'x') {
            g.fillStyle = C.xFill;
            g.fill();
          }
          g.stroke();
          // the value, centred in the part of the segment that is on screen
          const va = Math.max(a, 0) + 4, vb = Math.min(b, W) - 4;
          if (vb - va > 8) {
            let label = format(vs[k], s.width, radix, s.real);
            let w = g.measureText(label).width;
            if (w > vb - va) {
              while (label.length > 1 && g.measureText(label + '…').width > vb - va) {
                label = label.slice(0, -1);
              }
              label = label.length > 1 || w <= vb - va ? label + '…' : '';
              w = g.measureText(label).width;
            }
            if (label && w <= vb - va + 1) {
              g.fillStyle = lv === 'x' ? '#ffd0d0' : C.text;
              g.fillText(label, (va + vb) / 2, mid + 0.5);
            }
          }
        }
        k = next;
      }
    }

    function draw() {
      if (!S.data) {
        return;
      }
      const W = Math.max(1, waveWrap.clientWidth);
      const H = Math.max(1, scroll.clientHeight);
      drawRuler(W);
      const g = fitCanvas(canvas, W, H);
      canvas.style.top = '0px';
      g.fillStyle = C.bg;
      g.fillRect(0, 0, W, H);
      const top = scroll.scrollTop;
      const first = Math.floor(top / ROW), last = Math.min(S.rows.length - 1, Math.ceil((top + H) / ROW));
      // grid at the ruler's major ticks, faint
      const toUnit = S.data.tick / S.unit[1];
      const spanU = (S.view[1] - S.view[0]) * toUnit;
      const step = niceStep((spanU * 110) / W);
      g.fillStyle = C.grid;
      for (let u = Math.ceil((S.view[0] * toUnit) / step) * step; u <= S.view[1] * toUnit; u += step) {
        g.fillRect(Math.round(((u - S.view[0] * toUnit) / spanU) * W), 0, 1, H);
      }
      const endX = tToX(S.data.end);
      if (endX < W) {
        g.fillStyle = '#0a0a0a';
        g.fillRect(Math.max(0, endX), 0, W - endX, H);
      }
      for (let k = first; k <= last; k++) {
        const r = S.rows[k];
        if (!r) {
          continue;
        }
        const y0 = k * ROW - top;
        if (S.sel.has(rowKey(r))) {
          g.fillStyle = C.rowSel;
          g.fillRect(0, y0, W, ROW);
        }
        const s = series(r);
        if (s.width === 1 && !s.real) {
          drawBit(g, s, y0, W);
        } else {
          drawBus(g, s, y0, W, r.e.radix);
        }
      }
      for (const m of S.markers) {
        const x = Math.round(tToX(m));
        if (x >= 0 && x <= W) {
          g.fillStyle = C.marker;
          g.fillRect(x, 0, 1, H);
        }
      }
      const cx = Math.round(tToX(S.cursor));
      if (cx >= 0 && cx <= W) {
        g.fillStyle = C.cursor;
        g.fillRect(cx, 0, 1, H);
      }
      updateValues();
      renderObjectValues();
      drawStatus();
      drawScrollbar();
    }

    function renderObjectValues() {
      const items = objList.querySelectorAll('.dw-obj');
      if (!S.scope || items.length === 0) {
        return;
      }
      const q = S.filter.toLowerCase();
      const vars = S.scope.vars.filter(function (v) { return (!q || v.name.toLowerCase().indexOf(q) >= 0) && !/^errors?$/i.test(v.name); });
      items.forEach(function (it, k) {
        const v = vars[k];
        if (!v) {
          return;
        }
        const s = S.data.sigs.get(v.code);
        const j = indexAt(s.t, S.cursor);
        it.querySelector('.dw-obj-val').textContent = format(j < 0 ? undefined : s.v[j], v.width, v.type === 'integer' ? 'sdec' : 'hex', v.real);
      });
    }

    function drawStatus() {
      const parts = ['<span class="dw-st-c">Cursor ' + esc(tText(S.cursor)) + '</span>'];
      if (S.markers.length) {
        let near = S.markers[0];
        for (const m of S.markers) {
          if (Math.abs(m - S.cursor) < Math.abs(near - S.cursor)) {
            near = m;
          }
        }
        parts.push('<span class="dw-st-m">Marker ' + esc(tText(near)) + '</span>');
        parts.push('<span>Δ ' + esc(tText(Math.abs(S.cursor - near))) + '</span>');
      }
      parts.push('<span class="dw-st-v">View ' + esc(tText(S.view[0], 0)) + ' – ' + esc(tText(S.view[1], 0)) + '</span>');
      status.innerHTML = parts.join('');
    }

    function drawScrollbar() {
      const end = Math.max(S.data.end, 1);
      const W = hbar.clientWidth;
      const w = Math.max(24, ((S.view[1] - S.view[0]) / end) * W);
      const x = (S.view[0] / end) * (W - w) / Math.max(1e-9, 1 - (S.view[1] - S.view[0]) / end || 1);
      thumb.style.width = Math.min(W, w) + 'px';
      thumb.style.left = (S.view[1] - S.view[0] >= end ? 0 : Math.max(0, Math.min(W - w, x))) + 'px';
    }

    function sizeScroll() {
      const h = Math.max(S.rows.length * ROW, 1);
      rowsEl.style.height = h + 'px';
      waveWrap.style.height = h + 'px';
    }

    function layout() {
      host.style.setProperty('--dw-name', S.nameW + 'px');
      host.style.setProperty('--dw-val', S.valW + 'px');
      host.style.setProperty('--dw-row', ROW + 'px');
    }

    // *-*-*-*-*-*-*-*-*-*-*-* pointer and keys on the waves *-*-*-*-*-*-*-*-*-*-*-*
    let waveDrag = null;
    function waveX(ev) {
      return ev.clientX - canvas.getBoundingClientRect().left;
    }
    canvas.addEventListener('pointerdown', function (ev) {
      if (!S.data || ev.button !== 0) {
        return;
      }
      host.focus({ preventScroll: true });
      const idx = rowAt(ev.clientY);
      if (idx >= 0) {
        selectRow(idx, ev);
      }
      canvas.setPointerCapture(ev.pointerId);
      waveDrag = { idx: idx };
      setCursor(snapAt(S.rows[idx], waveX(ev)));
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!S.data) {
        return;
      }
      const x = waveX(ev);
      if (waveDrag) {
        setCursor(snapAt(S.rows[waveDrag.idx], x));
      }
      const idx = rowAt(ev.clientY);
      if (idx >= 0 && !waveDrag) {
        const r = S.rows[idx];
        const t = xToT(x);
        tip.innerHTML = '<b>' + esc(r.e.v.path + (r.bit >= 0 ? '[' + bitIndex(r.e.v, r.bit) + ']' : '')) + '</b> = ' +
          esc(rowValueText(r, t) || '—') + '<br><span>' + esc(tText(t)) + '</span>';
        const hr = host.getBoundingClientRect();
        tip.style.display = 'block';
        const tw = tip.offsetWidth;
        tip.style.left = Math.min(ev.clientX - hr.left + 14, hr.width - tw - 6) + 'px';
        tip.style.top = (ev.clientY - hr.top + 16) + 'px';
      } else {
        tip.style.display = 'none';
      }
    });
    canvas.addEventListener('pointerup', function () { waveDrag = null; });
    canvas.addEventListener('pointerleave', function () { tip.style.display = 'none'; });
    canvas.addEventListener('contextmenu', function (ev) {
      const idx = rowAt(ev.clientY);
      if (idx >= 0) {
        ev.preventDefault();
        rowMenu(ev, idx);
      }
    });

    // the ruler: click puts the cursor there, a drag along it zooms into the dragged range
    let rulerDrag = null;
    ruler.addEventListener('pointerdown', function (ev) {
      if (!S.data || ev.button !== 0) {
        return;
      }
      ruler.setPointerCapture(ev.pointerId);
      rulerDrag = { x: ev.clientX - ruler.getBoundingClientRect().left, moved: false };
    });
    ruler.addEventListener('pointermove', function (ev) {
      if (!rulerDrag) {
        return;
      }
      const x = ev.clientX - ruler.getBoundingClientRect().left;
      if (Math.abs(x - rulerDrag.x) > 4) {
        rulerDrag.moved = true;
        draw();
        const g = ruler.getContext('2d');
        g.fillStyle = 'rgba(255, 235, 59, 0.25)';
        g.fillRect(Math.min(x, rulerDrag.x), 0, Math.abs(x - rulerDrag.x), ruler.clientHeight);
      }
    });
    ruler.addEventListener('pointerup', function (ev) {
      if (!rulerDrag) {
        return;
      }
      const x = ev.clientX - ruler.getBoundingClientRect().left;
      if (rulerDrag.moved) {
        const a = xToT(Math.min(x, rulerDrag.x)), b = xToT(Math.max(x, rulerDrag.x));
        clampView(a, b);
        save();
        draw();
      } else {
        setCursor(xToT(x));
      }
      rulerDrag = null;
    });

    scroll.addEventListener('wheel', function (ev) {
      if (!S.data) {
        return;
      }
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const t = xToT(Math.max(0, waveX(ev)));
        zoomBy(Math.exp(ev.deltaY * 0.01), t);
        return;
      }
      const dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX;
      if (Math.abs(dx) > Math.abs(ev.deltaY) || ev.shiftKey) {
        ev.preventDefault();
        const span = S.view[1] - S.view[0];
        clampView(S.view[0] + (dx / waveW()) * span, S.view[1] + (dx / waveW()) * span);
        save();
        draw();
      }
    }, { passive: false });
    scroll.addEventListener('scroll', function () { draw(); });

    let barDrag = null;
    hbar.addEventListener('pointerdown', function (ev) {
      if (!S.data) {
        return;
      }
      hbar.setPointerCapture(ev.pointerId);
      const r = thumb.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right) {
        const span = S.view[1] - S.view[0];
        const page = ev.clientX < r.left ? -span : span;
        clampView(S.view[0] + page, S.view[1] + page);
        save();
        draw();
        return;
      }
      barDrag = { x: ev.clientX, t0: S.view[0] };
    });
    hbar.addEventListener('pointermove', function (ev) {
      if (!barDrag) {
        return;
      }
      const end = Math.max(S.data.end, 1);
      const span = S.view[1] - S.view[0];
      const dt = ((ev.clientX - barDrag.x) / Math.max(1, hbar.clientWidth - thumb.offsetWidth)) * (end - span);
      clampView(barDrag.t0 + dt, barDrag.t0 + dt + span);
      draw();
    });
    hbar.addEventListener('pointerup', function () {
      if (barDrag) {
        save();
      }
      barDrag = null;
    });

    // column splitters in the header: the Name and Value columns are as wide as the student drags them
    head.addEventListener('pointerdown', function (ev) {
      const sp = ev.target.closest('.dw-split');
      if (!sp) {
        return;
      }
      ev.preventDefault();
      const col = sp.dataset.col;
      const x0 = ev.clientX, w0 = col === 'name' ? S.nameW : S.valW;
      function move(e2) {
        const w = Math.max(col === 'name' ? 80 : 50, Math.min(600, w0 + e2.clientX - x0));
        if (col === 'name') {
          S.nameW = w;
        } else {
          S.valW = w;
        }
        layout();
        draw();
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        save();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    search.addEventListener('input', function () {
      S.filter = search.value;
      renderObjects();
    });
    panesBtn.addEventListener('click', function () {
      S.panes = !S.panes;
      host.classList.toggle('dw-nopanes', !S.panes);
      save();
      requestAnimationFrame(draw);
    });

    host.addEventListener('keydown', function (ev) {
      if (!S.data || ev.target === search) {
        return;
      }
      const k = ev.key;
      const mod = ev.metaKey || ev.ctrlKey;
      let done = true;
      if (k === '+' || k === '=') {
        zoomBy(0.5);
      } else if (k === '-' || k === '_') {
        zoomBy(2);
      } else if ((k === 'f' || k === 'F') && !mod) {
        fit();
      } else if (k === 'Home') {
        setCursor(0, true);
      } else if (k === 'End') {
        setCursor(S.data.end, true);
      } else if (k === 'ArrowRight') {
        jumpEdge(1);
      } else if (k === 'ArrowLeft') {
        jumpEdge(-1);
      } else if ((k === 'm' || k === 'M') && !mod) {
        addMarker();
      } else if ((k === 's' || k === 'S') && !mod) {
        S.snap = !S.snap;
        snapBtn.classList.toggle('on', S.snap);
        save();
      } else if (k === 'Delete' || k === 'Backspace') {
        removeSelected();
      } else if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (S.rows.length) {
          const cur = S.rows.findIndex(function (r) { return S.sel.has(rowKey(r)); });
          const nxt = Math.max(0, Math.min(S.rows.length - 1, cur < 0 ? 0 : cur + (k === 'ArrowDown' ? 1 : -1)));
          selectRow(nxt, ev.shiftKey ? { shiftKey: true } : null);
        }
      } else if (k === 'a' && mod) {
        S.sel = new Set(S.rows.map(rowKey));
        renderRows();
        draw();
      } else if (k === 'Escape') {
        closeMenu();
        S.sel = new Set();
        renderRows();
        draw();
      } else {
        done = false;
      }
      if (done) {
        ev.preventDefault();
      }
    });

    let raf = 0;
    new ResizeObserver(function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }).observe(grid);

    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      S.panes = false;
      S.nameW = 118;
      S.valW = 64;
    }
    if (opts.vcd !== undefined) {
      load(opts.vcd, opts.name);
    }
    return { load: load, state: S };
  }

  // *-*-*-*-*-*-*-*-*-*-*-* hosts *-*-*-*-*-*-*-*-*-*-*-*
  // the page `dewfpga wave` writes: the file is inlined, the wave configuration kept in the browser per testbench
  function mountPage(host, vcd, name, key) {
    const id = 'dewfpga-wave:' + (key || name);
    const store = {
      load: function () { return JSON.parse(localStorage.getItem(id) || 'null'); },
      save: function (c) { localStorage.setItem(id, JSON.stringify(c)); },
    };
    return mount(host, { vcd: vcd, name: name, store: store });
  }

  // the VS Code custom editor: the extension posts the file's text, again whenever the file changes on disk
  // (a new run), and keeps the wave configuration per file in the workspace
  function mountVsCode(host) {
    const api = acquireVsCodeApi();
    let viewer = null, pending = null;
    const store = {
      load: function () { return pending; },
      save: function (c) { api.setState(c); api.postMessage({ type: 'config', config: c }); },
    };
    window.addEventListener('message', function (ev) {
      const m = ev.data || {};
      if (m.type !== 'load') {
        return;
      }
      if (!viewer) {
        pending = m.config || api.getState() || null;
        viewer = mount(host, { name: m.name, store: store });
      }
      viewer.load(m.text, m.name);
    });
    api.postMessage({ type: 'ready' });
  }

  root.DewWave = { parseVcd: parseVcd, format: format, mount: mount, mountPage: mountPage, mountVsCode: mountVsCode };
})(typeof window !== 'undefined' ? window : globalThis);
