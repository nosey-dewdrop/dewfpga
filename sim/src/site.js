// shared across tabs: palette, glyph field, active tab. no framework.
import './style.css';

const PALS = ['night', 'white'];
function setPal(p) {
  document.body.className = `pal-${p}`;
  document.querySelectorAll('#pal button').forEach((b) => b.classList.toggle('on', b.dataset.pal === p));
  try { localStorage.setItem('cs223.pal', p); } catch { /* ignore */ }
}
let pal = 'night';
try { pal = localStorage.getItem('cs223.pal') || pal; } catch { /* ignore */ }
if (!PALS.includes(pal)) pal = 'night';
setPal(pal);
document.querySelectorAll('#pal button').forEach((b) => b.addEventListener('click', () => setPal(b.dataset.pal)));

// active tab from the path
const page = location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('nav.tabs a').forEach((a) => {
  const target = a.getAttribute('href');
  a.classList.toggle('on', target === page || (page === 'index.html' && target === './') || (page === '' && target === './'));
});

// deterministic glyph field: seeded, so nothing jumps between visits
const field = document.getElementById('glyphs');
if (field) {
  let seed = 223;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const glyphs = ['*', '+', '·', '.', '-', '·', '*'];
  for (let i = 0; i < 80; i++) {
    const s = document.createElement('span');
    s.className = 'glyph';
    s.textContent = glyphs[i % glyphs.length];
    s.style.left = `${rnd() * 100}%`;
    s.style.top = `${rnd() * 100}%`;
    s.style.animationDelay = `${rnd() * 3.4}s`;
    field.appendChild(s);
  }
}

// typed hero line, one per page
const typed = document.querySelector('[data-typed]');
if (typed) {
  const text = typed.dataset.typed;
  typed.textContent = '';
  const cur = document.createElement('span'); cur.className = 'cur'; cur.textContent = '_';
  typed.after(cur);
  let i = 0;
  const step = () => { typed.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(step, 28 + (text[i] === ' ' ? 40 : 0)); };
  setTimeout(step, 250);
}
