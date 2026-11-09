/**
 * Renders the static mockups in mockups.html to PNGs in this folder.
 *
 * The mockups are design artefacts for PLAN.md, not app code: edit the HTML,
 * then run `node docs/mockups/render.cjs` to refresh the images. Each
 * `.wrap` element (one phone frame plus its caption) becomes one PNG, and
 * the whole page becomes 0-overview.png. Needs Playwright with Chromium.
 */
const path = require('path');
const { chromium } = require('playwright');

const screenFileNames = [
  '1-today',
  '2-log-set',
  '3-emom-timer',
  '4-interval-timer',
  '5-exercise-details',
  '6-weekly-check',
];

/** Opens mockups.html at 2x scale and writes one PNG per screen plus an overview. */
async function renderMockups() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });

  await page.goto('file://' + path.join(__dirname, 'mockups.html'));

  // One PNG per phone frame, in the same order as the HTML.
  const screenFrames = await page.$$('.wrap');
  for (let index = 0; index < screenFrames.length; index++) {
    const outputPath = path.join(__dirname, `${screenFileNames[index]}.png`);
    await screenFrames[index].screenshot({ path: outputPath });
  }

  await page.screenshot({ path: path.join(__dirname, '0-overview.png'), fullPage: true });
  await browser.close();
}

renderMockups();
