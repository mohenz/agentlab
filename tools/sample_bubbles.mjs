// 특정 사람의 말풍선·자세를 일정 간격으로 찍어 본다. 사용: node tools/sample_bubbles.mjs <url> <이름> [초=20] [간격초=1.5]
import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const [url, who, total = '20', every = '1.5'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load' });
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < +total) {
  const s = await page.evaluate((n) => { const p = (window.officeDebug ? window.officeDebug() : []).find((x) => x.name === n); return p ? { pose: p.pose, act: p.act, bubble: p.bubble } : null; }, who);
  console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's', JSON.stringify(s));
  await page.waitForTimeout(+every * 1000);
}
if (errors.length) console.log('errors:', errors);
await browser.close();
