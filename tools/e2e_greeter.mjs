// 맞이하기 시험 — 대표실 층에 들어가면 greeter 가 인사하고 남은 일정을 하나씩 말한 뒤 대기로 돌아간다. 사용: node tools/e2e_greeter.mjs <url> <이름>
import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const [url = 'http://127.0.0.1:4778/', who = 'Rachael'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const seen = [];
const sample = async () => {
  const s = await page.evaluate((n) => { const p = window.officeDebug().find((x) => x.name === n); return p ? p.bubble : null; }, who);
  if (s && seen[seen.length - 1] !== s) seen.push(s);
};
await page.goto(url + '?floor=work1', { waitUntil: 'load' });
await page.waitForTimeout(4000);
const before = await page.evaluate((n) => window.officeDebug().some((x) => x.name === n), who);   // 업무층에는 Rachael 이 없다
await page.click('#floors button[data-id="suite"]');                                              // 대표실에 들어간다
for (let i = 0; i < 40; i++) { await sample(); await page.waitForTimeout(500); }
const cards = await page.evaluate(() => [...document.querySelectorAll('.o-today .o-trow')].map((r) => r.textContent));
const heading = await page.evaluate(() => document.querySelector('.o-today .o-thead')?.textContent || null);
const first = [...seen];
// 다른 층으로 갔다가 다시 들어오면 한 번 더 인사한다
await page.click('#floors button[data-id="work1"]'); await page.waitForTimeout(1500);
seen.length = 0;
await page.click('#floors button[data-id="suite"]');
for (let i = 0; i < 16; i++) { await sample(); await page.waitForTimeout(500); }
const again = [...seen];
console.log(JSON.stringify({ greeterOnWorkFloor: before, firstVisit: first, card: { heading, rows: cards }, secondVisit: again, errors }, null, 1));
await browser.close();
