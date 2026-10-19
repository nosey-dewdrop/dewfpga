// Regression for the Linux WebKit directory-upload race, independent of Yosys,
// application rendering and confirmation dialogs. Uses real directory uploads.
import { chromium, webkit, firefox } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const folder = mkdtempSync(join(tmpdir(), 'dewfpga-folder-'));
const records = { 'rtl/top.sv': 'module top; endmodule', 'data/rom.mem': '00\n11\n' };
let browser;
try {
  for (const [name, text] of Object.entries(records)) {
    mkdirSync(join(folder, name, '..'), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
  const name = process.env.BROWSER || 'chromium';
  browser = await ({ chromium, webkit, firefox })[name].launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<input type="file" webkitdirectory multiple>');
  await page.evaluate(() => {
    window.uploads = [];
    document.querySelector('input').addEventListener('change', event => {
      const files = [...event.target.files];
      window.uploads.push(Promise.all(files.map(async file => [file.webkitRelativePath, await file.text()])));
      event.target.value = ''; // allow choosing the same folder again, as the app does
    });
  });
  const count = Number(process.env.FOLDER_UPLOAD_REPEATS || 100);
  for (let i = 0; i < count; i++) {
    await page.setInputFiles('input', folder);
    const uploads = await page.evaluate(() => Promise.all(window.uploads));
    assert.equal(uploads.length, i + 1, 'each selection dispatches change exactly once');
    assert.deepEqual(Object.fromEntries(uploads[i]), Object.fromEntries(Object.entries(records).map(([path, text]) => [`${basename(folder)}/${path}`, text])));
  }
  console.log(`folder-upload: ${count} real directory selections passed (${name} ${browser.version()})`);
} finally {
  if (browser) await browser.close();
  rmSync(folder, { recursive: true, force: true });
}
