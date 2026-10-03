// code <-> board hover. nothing here ever moves the caret, changes the text or steals focus.
// board -> code: when a bound board element is hovered or focused, the matching port identifier in the top
// module header (or the matching pin line in the xdc) of the ACTIVE editor gets a mark decoration.
// code -> board: hovering an identifier inside the top module (or on an xdc pin line) lights the mapped
// elements. a same-named name in another module is not the top port, so it lights nothing.
// everything is inert between an edit and the next successful run: clear() drops the map, and the marks
// disappear on the first document change.
import { StateEffect, StateField, RangeSet } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';
import { blank } from './project.js';
import { parseXdc } from './xdc.js';

const setHl = StateEffect.define();
const mark = Decoration.mark({ class: 'cm-board-hl' });
const hlField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) deco = Decoration.none;                       // the old mapping must not show on edited text
    for (const e of tr.effects) if (e.is(setHl)) deco = e.value.length ? Decoration.set(e.value.map(([a, b]) => mark.range(a, b)), true) : Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const ID = /[A-Za-z_]\w*/g;

export class BoardLinks {
  constructor(board, files) {
    this.board = board; this.files = files;
    this.binding = null; this.roles = null;
    this._wired = new WeakSet();
    this._marked = null;                                             // view that currently shows marks
    board.onHover = (info) => this._fromBoard(info);
  }
  // after a successful run: binding = bindPorts() result, roles = resolve() result (top, topFile, xdc)
  set({ binding, roles }) {
    this.binding = binding; this.roles = roles;
    for (const r of this.files.all()) this._wire(this.files.get(r.path));
  }
  clear() {
    this.binding = null; this.roles = null;
    this._unmark(); this.board.setHighlight([]);
  }
  _wire(ed) {
    if (!ed || !ed.view || this._wired.has(ed.view)) return;
    this._wired.add(ed.view);
    const view = ed.view;
    view.dispatch({ effects: StateEffect.appendConfig.of([hlField]) });
    view.contentDOM.addEventListener('mousemove', (e) => this._fromCode(ed, view.posAtCoords({ x: e.clientX, y: e.clientY })));
    view.contentDOM.addEventListener('mouseleave', () => this.board.setHighlight([]));
  }
  _activeEd() { const ed = this.files.get(this.files.active); if (ed) this._wire(ed); return ed; }
  _unmark() { if (this._marked) { try { this._marked.dispatch({ effects: setHl.of([]) }); } catch { /* destroyed */ } this._marked = null; } }
  _mark(view, ranges) { this._unmark(); if (ranges.length) { view.dispatch({ effects: setHl.of(ranges) }); this._marked = view; } }
  // the active file: 'top' (its text + the top module span), 'xdc', or null
  _role(ed) {
    if (!this.roles || !this.binding) return null;
    const path = this.files.active;
    if (path === this.roles.topFile) {
      const text = ed.view.state.doc.toString(), b = blank(text);
      const re = new RegExp(`\\bmodule\\s+${this.roles.top}\\b`, 'g'), m = re.exec(b);
      if (!m) return null;
      const semi = b.indexOf(';', m.index), end = b.indexOf('endmodule', m.index);
      return { kind: 'top', b, header: [m.index, semi < 0 ? b.length : semi + 1], span: [m.index, end < 0 ? b.length : end + 9] };
    }
    if (path === this.roles.xdc) return { kind: 'xdc', text: ed.view.state.doc.toString() };
    return null;
  }
  _fromBoard(info) {
    const ed = this._activeEd();
    if (!info || !info.port || !ed) { this._unmark(); return; }
    const r = this._role(ed);
    if (!r) { this._unmark(); return; }
    const ranges = [];
    if (r.kind === 'top') {
      ID.lastIndex = r.header[0];
      let m;
      while ((m = ID.exec(r.b)) && m.index < r.header[1]) if (m[0] === info.port) ranges.push([m.index, m.index + m[0].length]);
    } else {
      const doc = ed.view.state.doc;
      for (const p of parseXdc(r.text).pins) {
        if (p.port !== info.port) continue;
        if (p.bit !== null && p.bit !== undefined && info.bit !== null && Number(p.bit) !== Number(info.bit)) continue;
        const l = doc.line(p.line); ranges.push([l.from, l.to]);
      }
    }
    this._mark(ed.view, ranges);
  }
  _fromCode(ed, pos) {
    if (pos === null || pos === undefined || !this.binding) { this.board.setHighlight([]); return; }
    const r = this._role(ed);
    if (!r) { this.board.setHighlight([]); return; }
    const text = r.kind === 'top' ? r.b : r.text;
    // identifier under the pointer (in the blanked text for the top file, so comments/strings never match)
    let a = pos, z = pos;
    while (a > 0 && /\w/.test(text[a - 1])) a--;
    while (z < text.length && /\w/.test(text[z])) z++;
    const word = text.slice(a, z);
    if (!word || /^\d/.test(word)) { this.board.setHighlight([]); return; }
    let entries = null;
    if (r.kind === 'top') {
      if (pos < r.span[0] || pos > r.span[1]) { this.board.setHighlight([]); return; }
      // `.led(x)` names a port of the instantiated module and `u.led` a signal inside it: not the top's led
      entries = /\.\s*$/.test(text.slice(Math.max(0, a - 8), a)) ? null : this.binding.map[word] || null;
      const idx = /^\s*\[\s*(\d+)\s*\]/.exec(text.slice(z, z + 12));              // sw[1] -> that one bit
      if (entries && idx) entries = entries.filter((e) => e.bit === Number(idx[1]));
    } else {
      const doc = ed.view.state.doc, line = doc.lineAt(pos), pins = parseXdc(r.text).pins.filter((p) => p.line === line.number);
      entries = [];
      for (const p of pins) for (const e of this.binding.map[p.port] || []) if (p.bit === null || p.bit === undefined || Number(p.bit) === e.bit) entries.push(e);
    }
    this.board.setHighlight(entries || []);
  }
}
