import { createRequire } from 'node:module';
const require = createRequire('D:/Workspace/pmotools/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
page.on('response', r => { if (r.status() >= 400) console.log(r.status(), r.url()); });
await page.goto(process.argv[2], { waitUntil: 'load' }); await page.waitForTimeout(4000); await browser.close();
