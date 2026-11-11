// 층 전환 시험 — 층 버튼 클릭, 다른 층 사람을 목록에서 눌러 그 층으로 이동, 콘솔 오류 0. 사용: node tools/e2e_floors.mjs <url>
import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const url = process.argv[2] || 'http://127.0.0.1:4778/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url + '?floor=work1', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const names = async () => (await page.evaluate(() => window.officeDebug().map((p) => p.name + '@' + p.floor))).sort();
const result = { start: await names() };
// 1) 층 버튼으로 이동
await page.click('#floors button[data-id="knowledge"]');
await page.waitForTimeout(2500);
result.afterButton = await names();
result.pressed = await page.evaluate(() => [...document.querySelectorAll('#floors button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.id));
// 2) 다른 층 사람을 오른쪽 목록에서 눌러 이동
await page.click('#office-people li[data-id="/demo/my-app"] .o-head');
await page.waitForTimeout(2500);
result.afterPick = await names();
result.selected = await page.evaluate(() => window.officeDebug().filter((p) => p.selected).map((p) => p.name));
// 3) 새로고침해도 마지막 층을 기억
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(5000);
result.remembered = await page.evaluate(() => window.officeDebug().map((p) => p.floor)[0]);
result.errors = errors;
console.log(JSON.stringify(result, null, 1));
await browser.close();
