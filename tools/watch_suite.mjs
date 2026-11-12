// 대표실 출입 관찰 — 대표실 층 인원의 위치를 일정 간격으로 재서, 누가 유리문 안쪽(집무실)에 들어갔는지 센다.
// 안쪽 = 유리문(x 720)보다 오른쪽이면서 유리벽 대각선((780,520)→(1050,720)) 위쪽. 로비 남쪽 안락의자 둘레는 바깥.
// 사용: node tools/watch_suite.mjs <url> [초=90] [층=suite]
import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const [url = 'http://127.0.0.1:4778/', total = '90', floor = 'suite'] = process.argv.slice(2);
const isInner = (x, y) => x >= 720 && y < Math.max(630, 520 + (x - 780) * 0.74);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}?floor=${floor}`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const seen = new Map();   // 이름 → { greeter, n, inside, maxX }
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < +total) {
  const list = await page.evaluate(() => window.officeDebug());
  for (const p of list) {
    const r = seen.get(p.name) || { greeter: p.greeter, n: 0, inside: 0, maxX: 0 };
    r.n++; r.maxX = Math.max(r.maxX, p.x);
    if (isInner(p.x, p.y)) r.inside++;
    seen.set(p.name, r);
  }
  await page.waitForTimeout(500);
}
console.log(JSON.stringify({ floor, people: Object.fromEntries(seen), errors }, null, 1));
await browser.close();
