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
    const left0 = (W - preW) / 2, top0 = mobile ? navH : navH + Math.max(0, Math.round((H - navH - preH) / 2 - 6));
    // on a wider window the drawing sits a little left of and below the middle, so the cable
    // keeps clear of the hero's lines; the words stay where the middle puts them
    const dx = mobile ? 0 : Math.round(6 * cw);
    const dy = mobile ? 0 : Math.max(0, Math.min(Math.round(2 * lh), H - (top0 + preH) - 2));
    const left = left0 - dx, top = top0 + dy;
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
      hero.style.left = (left0 + x0 * cw) + 'px';
      hero.style.width = Math.min(560, (spec.cols - x0 - 4) * cw) + 'px';
      hero.style.maxWidth = 'none';
      M.heroTop = top0 + Math.max(4, Math.round(spec.rows * 0.1)) * lh;
      hero.style.top = M.heroTop + 'px';
      hero.dataset.room = Math.round((yTop - spec.rows * 0.1) * lh + dy);
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
  // fit (a phone, a short or narrow window) it stays where the page has it, at the top of the
  // cli section, so a page whose script has not run (or is an older copy) never lays it on the
  // drawing
  function placeCli() {
    hero.appendChild(hcli);
    hcli.style.removeProperty('--hg');
    hcli.style.removeProperty('line-height');
    if (!M.mobile) {
      // in the stage's own frame, so a window resized further down the page measures the same
      const hb = () => hcli.getBoundingClientRect().bottom - stage.getBoundingClientRect().top;
      const n = hcli.children.length - 1;
      // the words rise a few lines first (never under the nav), then the gap closes, then the
      // lines come a little closer; the cable keeps at least 40px under the last command
      const clear = Math.max(40, 4 * M.lh);
      for (const up of [0, 2, 4, 6]) {
        const t = M.heroTop - up * M.lh;
        if (t < M.navH + 8) {
          break;
        }
        hero.style.top = t + 'px';
        for (const [lh, least] of [[1.3, 4], [1.2, 3]]) {
          hcli.style.lineHeight = lh;
          hcli.style.removeProperty('--hg');
          const spare = M.heroFloor - clear - hb();
          const gap = Math.min(10, 10 + spare / n);
          if (gap >= least) {
            hcli.style.setProperty('--hg', gap.toFixed(1) + 'px');
            if (lh === 1.3) {
              hcli.style.removeProperty('line-height');
            }
            return;
          }
        }
      }
      hero.style.top = M.heroTop + 'px';
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
    // the install line itself is in the hero, with three commands of the flow
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
      ['#', c('browser')], ['%', 'dewfpga sim top_monitor --wave=browser'], [],
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
