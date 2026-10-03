import { defineConfig } from 'vite';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { collect, renderNotices, SIM } from './scripts/notices.mjs';

// Ships the license files with the page: dist/LICENSE.txt (this page, MIT), dist/THIRD_PARTY_NOTICES.md
// (with its inventory section regenerated from the lockfile at build time, so dist/ is never stale even if
// the committed file lags; a warning says so), dist/licenses/iverilog-COPYING.txt (GPL-2.0, from the pinned
// upstream commit) and dist/licenses/<package>-<version>.txt for every non-dev package that has a license
// file. The footer of index.html links to these by relative path.
function licenses() {
  return {
    name: 'dewfpga-licenses',
    generateBundle() {
      const pkgs = collect();
      const committed = readFileSync(join(SIM, 'THIRD_PARTY_NOTICES.md'), 'utf8');
      const notices = renderNotices(pkgs, committed);
      if (notices !== committed) this.warn('THIRD_PARTY_NOTICES.md inventory is stale in the repository; run: node scripts/notices.mjs --write');
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(join(SIM, 'LICENSE'), 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: notices });
      this.emitFile({ type: 'asset', fileName: 'licenses/iverilog-COPYING.txt', source: readFileSync(join(SIM, 'licenses/iverilog-COPYING.txt'), 'utf8') });
      let n = 0;
      for (const p of pkgs) if (p.emit) { this.emitFile({ type: 'asset', fileName: p.emit, source: p.text }); n++; }
      this.info(`licenses: emitted LICENSE.txt, THIRD_PARTY_NOTICES.md, licenses/iverilog-COPYING.txt and ${n} package license texts`);
    },
    // dev server: the same URLs resolve (LICENSE has no .txt in the repo)
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/LICENSE.txt') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(readFileSync(join(SIM, 'LICENSE'))); return; }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [licenses()],
  build: { target: 'esnext', rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), tb: resolve(import.meta.dirname, 'tb.html') } } },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] } },
});
