// usage: node shot2.cjs in.html out.png width height
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +process.argv[4]||1440, height: +process.argv[5]||900 } });
await p.goto('file://' + require('path').resolve(process.argv[2])); await p.waitForTimeout(150);
await p.screenshot({ path: process.argv[3] }); await b.close(); })();
