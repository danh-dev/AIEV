const puppeteer = require('puppeteer-core');
const { computeExecutablePath, detectBrowserPlatform, Browser } = require('@puppeteer/browsers');
const path = require('path');
const fs = require('fs');

(async () => {
  const file = process.argv[2];
  const out = process.argv[3];

  // find a chromium: puppeteer cache or hyperframes browser cache
  const candidates = [];
  const home = process.env.USERPROFILE || process.env.HOME;
  for (const dir of [path.join(home, '.cache', 'puppeteer'), path.join(home, '.hyperframes', 'browsers'), path.join(home, '.cache', 'hyperframes')]) {
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/^(chrome|chrome\.exe|headless_shell|headless_shell\.exe|chrome-headless-shell\.exe)$/.test(e.name)) candidates.push(p);
      }
    }
  }
  const localChrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(p => fs.existsSync(p));
  const exe = candidates[0] || localChrome[0];
  if (!exe) { console.error('no chromium found'); process.exit(1); }
  console.error('using', exe);

  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto('file:///' + file.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: out });
  await browser.close();
  console.error('saved', out);
})();
