// Project paths stay relative and unchanged in both compiler filesystems.
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\0\\]/.test(path) || /^[A-Za-z]:/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`invalid project path: ${path}`);
  return path;
}
export function fileTree(files) {
  const root = Object.create(null);
  for (const [path, contents] of Object.entries(files)) {
    const parts = safePath(path).split('/'); let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (Object.hasOwn(dir, part) && (typeof dir[part] !== 'object' || dir[part] instanceof Uint8Array)) throw new Error(`file/folder conflict: ${path}`);
      if (!Object.hasOwn(dir, part)) dir[part] = Object.create(null);
      dir = dir[part];
    }
    const leaf = parts.at(-1);
    if (Object.hasOwn(dir, leaf)) throw new Error(`file/folder conflict: ${path}`);
    dir[leaf] = contents;
  }
  return root;
}
export function writeFiles(FS, files, root = '/work') {
  for (const [path, contents] of Object.entries(files)) {
    const parts = safePath(path).split('/'); let dir = root;
    for (const part of parts.slice(0, -1)) { dir += '/' + part; if (!FS.analyzePath(dir).exists) FS.mkdir(dir); }
    FS.writeFile(root + '/' + path, contents);
  }
}
export function includeDirs(names) { return [...new Set(['.', ...names.filter(n => n.includes('/')).map(n => n.slice(0, n.lastIndexOf('/')))])].sort(); }
