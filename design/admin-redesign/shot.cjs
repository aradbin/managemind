const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('file://' + process.argv[2]); const h = await p.evaluate(() => document.documentElement.scrollHeight); console.log('height', h);
await p.screenshot({ path: process.argv[3], fullPage: true }); await b.close(); })();
