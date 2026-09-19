import { chromium, webkit } from 'playwright';
const S = process.env.SHOTS || '/tmp';
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await page.goto((process.env.BASE || 'http://localhost:4173/'));
const status = () => page.locator('#status').innerText();
// wait for yosys warm + first run of the default example
await page.waitForFunction(() => /combinational|simulated clock|error|not running/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
console.log('status after boot:', await status());
console.log('console:', (await page.locator('#console').innerText()).split('\n')[0]);
// flip sw3 → led3 on
const ledClass = (i) => page.locator('#board .b-led').nth(i).getAttribute('class');
console.log('led3 before:', await ledClass(3));
await page.locator('#board .b-sw').nth(3).click();
await page.waitForTimeout(100);
console.log('led3 after sw3 click:', await ledClass(3));
await page.locator('#board .b-sw').nth(3).click();
await page.waitForTimeout(100);
console.log('led3 after 2nd click:', await ledClass(3));
await page.screenshot({ path: S + '/shot-sw.png' });
// blink example
await page.selectOption('#examples', 'blink');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.waitForTimeout(1200);
console.log('blink status:', await status());
const seen = new Set();
for (let i = 0; i < 20; i++) { seen.add(await ledClass(0)); await page.waitForTimeout(60); }
console.log('led0 classes seen over 1.2s:', [...seen]);
// counter on display: press btnC 3 times → display shows 3
await page.selectOption('#examples', 'count on the display');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const btn = page.locator('#board .b-btn[data-btn=btnC]');
for (let i = 0; i < 3; i++) { await btn.dispatchEvent('pointerdown'); await page.waitForTimeout(80); await btn.dispatchEvent('pointerup'); await page.waitForTimeout(80); }
await page.waitForTimeout(300);
const digitOn = await page.evaluate(() => [...document.querySelectorAll('#board g[transform^="translate(150 334)"] > g')].map((d) => [...d.querySelectorAll('.b-seg')].map((s) => s.classList.contains('on') ? 1 : 0).join('')));
console.log('digits (an3..an0, segs a..g,dp):', digitOn);
await page.screenshot({ path: S + '/shot-count.png' });
// traffic light
await page.selectOption('#examples', 'traffic light fsm');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.waitForTimeout(800);
const leds = await page.evaluate(() => [...document.querySelectorAll('#board .b-led')].slice(0, 6).map((l) => l.classList.contains('on') ? 1 : 0).join(''));
console.log('traffic leds 0..5:', leds);
console.log('status:', await status());
// multi-file: add m2.sv with a submodule, use it from design.sv
await page.click('.ftab[data-tab="design.sv"]');
await page.locator('#editors .editor:not([hidden]) .cm-content').click();
await page.keyboard.press('Meta+a'); await page.keyboard.type('module top(input logic [15:0] sw, output logic [15:0] led); inv u(.a(sw), .y(led)); endmodule');
await page.evaluate(() => window.cs223.files.add('m2.sv', 'module inv(input logic [15:0] a, output logic [15:0] y); assign y = ~a; endmodule'));
await page.evaluate(() => window.cs223.files.set('basys3.xdc', [...Array(16)].map((_, i) => `set_property PACKAGE_PIN ${['V17','V16','W16','W17','W15','V15','W14','W13','V2','T3','T2','R3','W2','U1','T1','R2'][i]} [get_ports sw[${i}]]\nset_property PACKAGE_PIN ${['U16','E19','U19','V19','W18','U15','U14','V14','V13','V3','W3','U3','P3','N3','P1','L1'][i]} [get_ports led[${i}]]`).join('\n')));
await page.click('#run');
await page.waitForFunction(() => /combinational/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.waitForTimeout(200);
console.log('multi-file: led5 with sw5 off (inverted):', await ledClass(5), '| tabs:', await page.locator('#ftabs .ftab').allInnerTexts());
// error path
await page.evaluate(() => { const v = document.querySelector('#ed-sv .cm-content'); });
await page.click('.ftab[data-tab="design.sv"]');
await page.locator('#editors .editor:not([hidden]) .cm-content').click();
await page.keyboard.press('Meta+a'); await page.keyboard.type('module top(input logic a, output logic b); assign b = a +; endmodule');
await page.click('#run');
await page.waitForFunction(() => /not running/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
console.log('error console:', await page.locator('#console').innerText());
// other pages
for (const p of ['tb.html']) { await page.goto((process.env.BASE || 'http://localhost:4173/') + p); await page.waitForTimeout(600); console.log(p, 'loaded, tabs:', await page.locator('nav.tabs a').count()); }
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
