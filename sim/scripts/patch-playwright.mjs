// Playwright 1.58.1 races directory upload against installation of its input
// listener. Linux WebKit can finish the upload first, leaving setInputFiles
// waiting forever even though the application has imported every file.
// Keep this test-only patch scoped to the locked version and exact source;
// review/remove it when upgrading Playwright. No browser or product code changes.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const manifest = require.resolve('playwright-core/package.json');
assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, '1.58.1', 'review the folder-upload patch for this Playwright version');
const file = join(dirname(manifest), 'lib/server/dom.js');
const before = `      const waitForInputEvent = localDirectory ? this.evaluate((node) => new Promise((fulfill) => {
        node.addEventListener("input", fulfill, { once: true });
      })).catch(() => {
      }) : Promise.resolve();
      await progress.race(this._page.delegate.setInputFilePaths(retargeted, localPathsOrDirectory));
      await progress.race(waitForInputEvent);`;
const after = `      // dewfpga: register the directory input listener before starting the upload.
      const inputEvent = localDirectory ? await progress.race(this.evaluateHandle((node) => ({
        promise: new Promise((fulfill) => node.addEventListener("input", fulfill, { once: true }))
      }))) : null;
      try {
        await progress.race(this._page.delegate.setInputFilePaths(retargeted, localPathsOrDirectory));
        if (inputEvent)
          await progress.race(inputEvent.evaluate(state => state.promise));
      } finally {
        if (inputEvent) await inputEvent.dispose();
      }`;
const source = readFileSync(file, 'utf8');
if (!source.includes(after)) {
  assert.equal(source.split(before).length, 2, 'Playwright source changed; review the folder-upload patch');
  writeFileSync(file, source.replace(before, after));
}
