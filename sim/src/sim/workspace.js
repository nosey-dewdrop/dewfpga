// workspace persistence, apart from the runtime wiring: one versioned record of the whole workspace (file paths,
// text, order, the open file, the top/xdc the student picked, the view), written 400 ms after the last edit and
// at once when the page hides or a view/example change is about to replace it. a failed write (quota, private
// mode) is reported through onState and the live edits stay; "saved" is never said after an exception.
export const WORKSPACE_KEY = 'dewfpga.workspace';
export const WORKSPACE_VERSION = 1;
export function createWorkspaceStore({ key = WORKSPACE_KEY, snapshot, onState = () => {}, debounce = 400, storage = globalThis.localStorage, win = globalThis } = {}) {
  let timer = null, dirty = false, last = null;
  const write = () => {
    timer = null; if (!dirty) return;
    const rec = { v: WORKSPACE_VERSION, at: Date.now(), ...snapshot() };
    try { storage.setItem(key, JSON.stringify(rec)); dirty = false; last = null; onState({ ok: true, at: rec.at }); }
    catch (e) { last = e; onState({ ok: false, error: e && e.name === 'QuotaExceededError' ? 'not saved: browser storage is full (the workspace stays in this tab; download the zip to keep it)' : `not saved: ${e && e.message ? e.message : e}` }); }
  };
  const store = {
    schedule() { dirty = true; if (timer) clearTimeout(timer); timer = setTimeout(write, debounce); },
    flush() { if (timer) clearTimeout(timer); timer = null; write(); },
    get pending() { return dirty; },
    get lastError() { return last; },
    read() {
      try {
        const rec = JSON.parse(storage.getItem(key) || 'null');
        if (!rec || rec.v !== WORKSPACE_VERSION || !Array.isArray(rec.files) || !rec.files.length) return null;
        if (rec.files.some((f) => typeof f.path !== 'string' || typeof f.text !== 'string')) return null;
        return rec;
      } catch { return null; }
    },
    clear() { try { storage.removeItem(key); } catch { /* nothing to clear */ } },
  };
  if (win && win.addEventListener) {
    win.addEventListener('pagehide', () => store.flush());
    win.addEventListener('visibilitychange', () => { if (win.document && win.document.visibilityState === 'hidden') store.flush(); });
  }
  return store;
}
