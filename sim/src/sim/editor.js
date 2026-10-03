import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration } from '@codemirror/view';
import { EditorState, Compartment, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { tags as t } from '@lezer/highlight';

const hl = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--accent)' },
  { tag: t.comment, color: 'var(--ink-dim)' },
  { tag: t.number, color: 'var(--ink)' },
  { tag: t.string, color: 'var(--ink)' },
  { tag: t.variableName, color: 'var(--ink)' },
  { tag: t.typeName, color: 'var(--accent)' },
]);

const theme = EditorView.theme({
  '&': { background: 'transparent', color: 'var(--ink)', fontSize: '14px', height: '100%' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-gutters': { background: 'transparent', color: 'var(--ink-dim)', border: 'none', paddingLeft: '8px' },
  '.cm-activeLine': { background: 'var(--bg-line)' },
  '.cm-activeLineGutter': { background: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--sel) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});

// live diagnostics: whole-line marks, one class per severity. the list is replaced wholesale by
// setDiagnostics(); marks ride along with edits (map) until the next list arrives, so a fixed line keeps
// its mark only until the next lint reply clears it.
const setMarks = StateEffect.define();
const MARK = { error: Decoration.line({ class: 'cm-diag cm-diag-error' }), warning: Decoration.line({ class: 'cm-diag cm-diag-warning' }) };
const marks = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return build(tr.state.doc, e.value);
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
function build(doc, list) {
  const bySeverity = new Map();
  for (const d of list) {
    const line = Number(d.line);
    if (!Number.isInteger(line) || line < 1 || line > doc.lines) continue;
    const kind = d.kind === 'error' ? 'error' : 'warning';
    if (bySeverity.get(line) !== 'error') bySeverity.set(line, kind);
  }
  const b = new RangeSetBuilder();
  for (const line of [...bySeverity.keys()].sort((a, c) => a - c)) { const l = doc.line(line); b.add(l.from, l.from, MARK[bySeverity.get(line)]); }
  return b.finish();
}

export function makeEditor(parent, doc, { onRun, onEdit, lang = 'verilog' } = {}) {
  const runKey = keymap.of([{ key: 'Mod-Enter', run: () => { onRun && onRun(); return true; } }]);
  const langC = new Compartment();
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(),
      runKey, keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      langC.of(lang === 'verilog' ? StreamLanguage.define(verilog) : []),
      syntaxHighlighting(hl), theme, EditorView.lineWrapping, marks,
      EditorView.updateListener.of((u) => { if (u.docChanged && onEdit) onEdit(); }),
    ],
  });
  const view = new EditorView({ state, parent });
  return {
    view,
    get text() { return view.state.doc.toString(); },
    set text(v) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } }); },
    goto(line) {
      const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
      view.focus();
    },
    // list: [{ kind: 'error'|'warning', line }]; anything else is ignored. an empty list clears every mark.
    setDiagnostics(list) { view.dispatch({ effects: setMarks.of(Array.isArray(list) ? list : []) }); },
  };
}
