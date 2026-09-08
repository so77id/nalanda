import { chromium } from 'playwright';
const BASE = 'http://localhost:4288/nalanda/d/edd-listas-enlazadas/present';
const OUT =
  '/tmp/claude-501/-Users-so77id-workspace-nalanda-issue-288/03d41aa7-8519-436a-a95f-9732ad0a1822/scratchpad';
const want = [
  [/Insertar, por variante/, 'tabla-insertar'],
  [/Eliminar y buscar, por variante/, 'tabla-eliminar'],
  [/tabla completa/, 'tabla-completa'],
  [/lista circular . el último/, 'circular'],
  [/precio de pedir cualquier posición/, 'cabo-suelto'],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const found = {};
for (let i = 0; i < 48; i += 1) {
  await page.goto(`${BASE}?slide=${i}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(420);
  const title = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="slide-stage"]');
    const h = s?.querySelector('h2, h1');
    return h ? h.textContent.replace('#', '').trim() : '';
  });
  for (const [re, tag] of want) if (re.test(title) && !found[tag]) found[tag] = { i, title };
}
console.log(JSON.stringify(found, null, 1));
for (const theme of ['light', 'dark']) {
  for (const [tag, v] of Object.entries(found)) {
    await page.goto(`${BASE}?slide=${v.i}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/S-${tag}-${theme}.png` });
  }
}
console.log('shots done');
await browser.close();
