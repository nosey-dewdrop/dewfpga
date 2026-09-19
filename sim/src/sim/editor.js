import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
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

export function makeEditor(parent, doc, { onRun, lang = 'verilog' } = {}) {
  const runKey = keymap.of([{ key: 'Mod-Enter', run: () => { onRun && onRun(); return true; } }]);
  const langC = new Compartment();
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(),
      runKey, keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      langC.of(lang === 'verilog' ? StreamLanguage.define(verilog) : []),
      syntaxHighlighting(hl), theme, EditorView.lineWrapping,
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
  };
}
