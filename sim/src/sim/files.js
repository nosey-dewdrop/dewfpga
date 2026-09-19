// a small multi-file editor model shared by the board and testbench pages.
// files: ordered {name: text}. one codemirror per file, created on first show.
import { makeEditor } from './editor.js';

export class Files {
  constructor({ bar, host, onRun, fixed = [], onChange = () => {} }) {
    this.bar = bar; this.host = host; this.onRun = onRun; this.onChange = onChange;
    this.fixed = fixed;            // names that can not be removed or renamed (e.g. design.sv, tb.sv, basys3.xdc)
    this.editors = new Map();      // name -> editor
    this.order = [];
    this.active = null;
    this.addBtn = document.createElement('button');
    this.addBtn.textContent = '+ file';
    this.addBtn.title = 'add another .sv file (one module per file, like a real project)';
    this.addBtn.addEventListener('click', () => this.add(this._freshName()));
  }
  load(map) {
    for (const [name, ed] of this.editors) { ed.view.destroy(); }
    this.editors.clear(); this.order = [];
    for (const [name, text] of Object.entries(map)) this._create(name, text);
    this.show(this.order[0]);
    this._renderTabs();
  }
  _create(name, text) {
    const div = document.createElement('div');
    div.className = 'editor'; div.hidden = true; this.host.appendChild(div);
    const ed = makeEditor(div, text, { onRun: this.onRun, lang: name.endsWith('.xdc') ? 'plain' : 'verilog' });
    ed.el = div;
    this.editors.set(name, ed); this.order.push(name);
  }
  _freshName() { let i = 2; while (this.editors.has(`m${i}.sv`)) i++; return `m${i}.sv`; }
  add(name, text = `// ${name}\nmodule ${name.replace(/\.sv$/, '')}(\n);\nendmodule\n`) {
    if (this.editors.has(name)) return;
    this._create(name, text);
    // keep .sv files together, before the fixed non-source tabs (basys3.xdc, tb.sv)
    const tail = this.order.filter((n) => this.fixed.includes(n) && !/^design\.sv$/.test(n));
    this.order = [...this.order.filter((n) => !tail.includes(n)), ...tail];
    this.show(name); this._renderTabs(); this.onChange();
  }
  remove(name) {
    if (this.fixed.includes(name) || !this.editors.has(name)) return;
    const ed = this.editors.get(name); ed.view.destroy(); ed.el.remove();
    this.editors.delete(name); this.order = this.order.filter((n) => n !== name);
    if (this.active === name) this.show(this.order[0]);
    this._renderTabs(); this.onChange();
  }
  rename(oldName, newName) {
    newName = newName.trim();
    if (!newName || newName === oldName || this.editors.has(newName) || this.fixed.includes(oldName)) return;
    if (!/^[\w.-]+\.(sv|v)$/.test(newName)) return;
    const ed = this.editors.get(oldName);
    this.editors.delete(oldName); this.editors.set(newName, ed);
    this.order = this.order.map((n) => (n === oldName ? newName : n));
    if (this.active === oldName) this.active = newName;
    this._renderTabs(); this.onChange();
  }
  show(name) {
    if (!this.editors.has(name)) return;
    this.active = name;
    for (const [n, ed] of this.editors) ed.el.hidden = n !== name;
    this._renderTabs();
  }
  get(name) { return this.editors.get(name); }
  text(name) { const e = this.editors.get(name); return e ? e.text : ''; }
  set(name, text) { const e = this.editors.get(name); if (e) e.text = text; }
  // {name: text} for the .sv/.v files only, in tab order
  sources() { const o = {}; for (const n of this.order) if (/\.(sv|v)$/.test(n)) o[n] = this.text(n); return o; }
  all() { const o = {}; for (const n of this.order) o[n] = this.text(n); return o; }
  _renderTabs() {
    this.bar.innerHTML = '';
    for (const name of this.order) {
      const b = document.createElement('button');
      b.className = 'ftab' + (name === this.active ? ' on' : ''); b.textContent = name; b.dataset.tab = name;
      b.addEventListener('click', () => this.show(name));
      if (!this.fixed.includes(name)) {
        b.title = 'double-click to rename';
        b.addEventListener('dblclick', () => {
          const inp = document.createElement('input'); inp.value = name; inp.className = 'ftab-input'; inp.size = Math.max(6, name.length);
          b.replaceWith(inp); inp.focus(); inp.select();
          const done = () => { this.rename(name, inp.value); this._renderTabs(); };
          inp.addEventListener('blur', done); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = name; inp.blur(); } });
        });
      }
      this.bar.appendChild(b);
      if (!this.fixed.includes(name) && name === this.active) {
        const x = document.createElement('button'); x.className = 'ftab-x'; x.textContent = 'remove'; x.title = `remove ${name}`;
        x.addEventListener('click', () => this.remove(name)); this.bar.appendChild(x);
      }
    }
    this.bar.appendChild(this.addBtn);
  }
}
