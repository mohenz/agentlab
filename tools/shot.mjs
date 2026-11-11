// 헤드리스 Chrome 으로 사무실 화면을 캡처한다. 사용: node tools/shot.mjs <url> <out.png> [대기초=8] [너비=1600] [높이=1000]
import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const [url, out, wait = '8', w = '1600', h = '1000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait * 1000);
await page.screenshot({ path: out });
const dbg = await page.evaluate(() => (window.officeDebug ? window.officeDebug() : null)).catch(() => null);
console.log(JSON.stringify({ errors, people: dbg && dbg.map(p => ({ name: p.name, pose: p.pose, x: Math.round(p.x), y: Math.round(p.y) })) }));
await browser.close();
