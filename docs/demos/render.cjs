/**
 * Renders the "Show me" contact sheet (docs/demos/contactSheet.html) to a PNG.
 *
 *   node docs/demos/render.cjs <output.png> [exerciseId ...]
 *
 * With no ids, every Steady Strength demo is drawn. The page is served by a
 * throw-away Vite dev server on a free port (so the TypeScript demos and the
 * real three.js renderer are used as they are) and opened in headless
 * Chromium with software WebGL, which works without a GPU. The server is
 * always stopped before this script exits, even after an error.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright');

const projectRoot = path.join(__dirname, '..', '..');

/** Asks the operating system for a currently unused TCP port. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Polls the dev server until it answers, or throws after about 30 seconds. */
async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      // Not listening yet; try again shortly.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start at ${url}`);
}

/** Starts Vite and draws the sheet, stopping Vite whatever happens. */
async function renderContactSheet() {
  const [outputPath, ...exerciseIds] = process.argv.slice(2);
  if (!outputPath) {
    console.error('Usage: node docs/demos/render.cjs <output.png> [exerciseId ...]');
    process.exit(1);
  }

  const port = await findFreePort();
  const vite = spawn(
    path.join(projectRoot, 'node_modules', '.bin', 'vite'),
    ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  let browser;

  try {
    const pageUrl = `http://127.0.0.1:${port}/docs/demos/contactSheet.html`;
    await waitForServer(pageUrl);

    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => console.error('page error:', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('console error:', message.text());
    });

    await page.goto(pageUrl);
    await page.evaluate((ids) => window.renderContactSheet(ids), exerciseIds);
    await page.waitForSelector('body[data-done="true"]');
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(`Wrote ${outputPath}`);
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }
}

renderContactSheet().catch((error) => {
  console.error(error);
  process.exit(1);
});
