// the file tabs over one editor host. names are free: any path the command line would read (.sv .v .svh .vh
// .xdc .mem), with folders kept (src/top.sv). nothing is fixed, nothing is renamed behind the student's back.
import { makeEditor } from './editor.js';
import { pathProblem, kindOf, toRecord, validateImport, encodeRecord } from './project.js';

export class Files {
  constructor({ bar, host, tree, onRun, onChange }) {
    this.bar = bar; this.host = host; this.tree = tree; this.closedFolders = new Set(); this.onRun = onRun; this.onChange = onChange || (() => {});
    this.editors = new Map(); this.records = new Map(); this.order = []; this.active = null;
    this.addBtn = document.createElement('button'); this.addBtn.className = 'ftab-add'; this.addBtn.textContent = '+ file';
    this.addBtn.addEventListener('click', () => { try { const n = this._freshName(); this.add(n, ''); this.show(n); this._startRename(n); } catch (e) { this.onChange('error', e.message); } });
  }
  // records: [{path, text, eol, bom, raw}] in order
  load(records, active) {
    for (const ed of this.editors.values()) ed.view.destroy();
    this.host.replaceChildren(); this.editors.clear(); this.records.clear(); this.order = [];
    for (const r of records) this._create(r);
    if (this.tree && records.some(r => r.path.includes('/'))) this.tree.open = true;
    this.show(active && this.records.has(active) ? active : this.order[0]);
  }
  _create(r) {
    const div = document.createElement('div'); div.className = 'editor'; div.hidden = true; this.host.appendChild(div);
    const kind = kindOf(r.path);
    const ed = makeEditor(div, r.text, { onRun: this.onRun, lang: kind === 'xdc' || kind === 'mem' ? 'plain' : 'verilog', onEdit: () => this._edited(r.path) });
    ed.el = div; this.editors.set(r.path, ed); this.records.set(r.path, { ...r }); this.order.push(r.path);
  }
  _edited(path) { const r = this.records.get(path); if (r) r.raw = null; this.onChange('edit', path); }
  _freshName() { for (let i = 1; ; i++) { const n = `m${i}.sv`; if (!this.records.has(n)) return n; } }
  add(path, text = '') {
    const why = pathProblem(path); if (why) throw new Error(why);
    if (this.records.has(path)) throw new Error(`${path} is already in the workspace`);
    validateImport([...this.all().map(r => ({path:r.path,bytes:encodeRecord(r)})), {path,text}]);
    this._create(toRecord(path, null, text));
    const i = this.order.indexOf(this.active); if (i >= 0 && i < this.order.length - 2) { this.order.pop(); this.order.splice(i + 1, 0, path); }
    this._renderTabs(); this.onChange('add', path); return path;
  }
  remove(path) {
    const ed = this.editors.get(path); if (!ed) return;
    ed.view.destroy(); ed.el.remove(); this.editors.delete(path); this.records.delete(path);
    this.order = this.order.filter((n) => n !== path);
    if (this.active === path) this.show(this.order[0] || null); else this._renderTabs();
    this.onChange('remove', path);
  }
  rename(from, to) {
    if (from === to) return true;
    const why = pathProblem(to); if (why) { this.onChange('error', why); return false; }
    if (this.records.has(to)) { this.onChange('error', `${to} is already in the workspace`); return false; }
    const ed = this.editors.get(from), r = this.records.get(from); if (!ed) return false;
    try { validateImport(this.all().map(r => ({path:r.path === from ? to : r.path,bytes:encodeRecord(r)}))); }
    catch (e) { this.onChange('error', e.message); return false; }
    const text = ed.text; this.editors.delete(from); this.records.delete(from);
    ed.view.destroy(); ed.el.remove();
    const i = this.order.indexOf(from); this.order.splice(i, 1);
    this._create({ ...r, path: to, text, raw: kindOf(to) === kindOf(from) ? r.raw : null });
    this.order.splice(i, 0, this.order.pop());
    if (this.active === from) this.active = to;
    this.show(this.active); this.onChange('rename', `${from} -> ${to}`); return true;
  }
  show(path) {
    if (path !== null && !this.editors.has(path)) return;
    const changed = this.active !== path; this.active = path;
    for (const [n, ed] of this.editors) ed.el.hidden = n !== path;
    this._renderTabs();
    if (changed) this.onChange('active', path);
  }
  get(path) { return this.editors.get(path); }
  has(path) { return this.records.has(path); }
  text(path) { const ed = this.editors.get(path); return ed ? ed.text : ''; }
  set(path, text) { const ed = this.editors.get(path); if (ed) { ed.text = text; this._edited(path); } }
  // every file as a record with the live text (raw bytes kept only while untouched)
  records_() { return this.order.map((p) => ({ ...this.records.get(p), text: this.text(p) })); }
  all() { return this.records_(); }
  byKind(kind) { const o = {}; for (const p of this.order) if (kindOf(p) === kind) o[p] = this.text(p); return o; }
  sources() { return this.byKind('source'); }
  _startRename(name) {
    const b = this.bar.querySelector(`.ftab[data-tab="${CSS.escape(name)}"]`); if (b) b.dispatchEvent(new Event('dblclick'));
  }
  _renderTabs() {
    this.bar.replaceChildren();
    for (const name of this.order) {
      const b = document.createElement('button'); b.className = 'ftab' + (name === this.active ? ' on' : ''); b.textContent = name; b.dataset.tab = name; b.title = name;
      b.addEventListener('click', () => this.show(name));
      b.addEventListener('dblclick', () => {
        const inp = document.createElement('input'); inp.className = 'ftab-input'; inp.value = name; inp.setAttribute('aria-label', 'file name'); inp.size = Math.max(8, name.length + 2);
        b.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const finish = (commit) => { if (done) return; done = true; if (!commit || !this.rename(name, inp.value.trim())) this._renderTabs(); };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
        inp.addEventListener('blur', () => finish(true));
      });
      this.bar.appendChild(b);
      if (name === this.active && this.order.length > 1) {
        const x = document.createElement('button'); x.className = 'ftab-x'; x.textContent = 'remove'; x.title = `remove ${name}`;
        x.addEventListener('click', () => this.remove(name)); this.bar.appendChild(x);
      }
    }
    this.bar.appendChild(this.addBtn);
    this._renderTree();
  }
  _renderTree() {
    if (!this.tree) return;
    const host = this.tree.querySelector('.filetree-items'); host.replaceChildren();
    const root = { dirs:new Map(), files:[] };
    for (const path of this.order) {
      const parts = path.split('/'); let node = root;
      for (const part of parts.slice(0,-1)) {
        if (!node.dirs.has(part)) node.dirs.set(part,{dirs:new Map(),files:[]});
        node = node.dirs.get(part);
      }
      node.files.push(path);
    }
    const draw = (node, parent, prefix='') => {
      for (const [name, child] of [...node.dirs].sort(([a],[b]) => a.localeCompare(b))) {
        const key = prefix + name + '/', folder = document.createElement('details');
        folder.className = 'filetree-folder'; folder.dataset.folder = key; folder.open = !this.closedFolders.has(key);
        const title = document.createElement('summary'); title.textContent = name; folder.appendChild(title);
        folder.addEventListener('toggle', () => { if (folder.isConnected) { if (folder.open) this.closedFolders.delete(key); else this.closedFolders.add(key); } });
        draw(child,folder,key); parent.appendChild(folder);
      }
      for (const path of node.files) {
        const button = document.createElement('button'); button.className = 'filetree-file';
        button.textContent = path.split('/').at(-1); button.title = path; button.dataset.path = path;
        if (path === this.active) button.setAttribute('aria-current','true');
        button.addEventListener('click', () => this.show(path));
        button.addEventListener('dblclick', () => { this.show(path); this._startRename(path); });
        parent.appendChild(button);
      }
    };
    draw(root,host);
  }
}
