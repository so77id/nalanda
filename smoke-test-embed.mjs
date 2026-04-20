import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })

const errs = []
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(`console.error: ${m.text()}`)
})

console.log('→ loading', URL)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

// Count embeds
const nEmbeds = await page.evaluate(
  () => document.querySelectorAll('button[title="Pantalla completa"]').length
)
console.log(`→ found ${nEmbeds} embed(s) in the page`)

// Page-level screenshot (shows the lesson + embedded runners)
await page.screenshot({ path: 'smoke-test-embed-page.png', fullPage: true })
console.log('→ saved smoke-test-embed-page.png')

// Click the first embed's expand button
console.log('→ clicking expand on first runner...')
await page.evaluate(() => {
  document.querySelector('button[title="Pantalla completa"]').click()
})
await new Promise((r) => setTimeout(r, 800))

const fullscreenPresent = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).some((b) =>
    b.textContent.includes('Cerrar')
  )
)
console.log(`→ fullscreen open: ${fullscreenPresent}`)

await page.screenshot({ path: 'smoke-test-embed-fullscreen.png' })
console.log('→ saved smoke-test-embed-fullscreen.png')

// Click run in fullscreen
console.log('→ clicking Run in fullscreen...')
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent.includes('Ejecutar') || b.textContent.includes('Calentando')
  )
  btn?.click()
})
// wait for run to complete
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const pres = await page.evaluate(() =>
    Array.from(document.querySelectorAll('pre'))
      .map((p) => p.textContent)
      .filter(Boolean)
  )
  if (pres.some((t) => t.includes('list:'))) break
}

const fullOutput = await page.evaluate(() => {
  const pres = Array.from(document.querySelectorAll('pre'))
  const hit = pres.find((p) => p.textContent.includes('list:'))
  return hit?.textContent ?? null
})
console.log('→ fullscreen output:', JSON.stringify(fullOutput))

// Close with Escape
console.log('→ pressing Escape to close...')
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 500))

const stillOpen = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).some((b) =>
    b.textContent.includes('Cerrar')
  )
)
console.log(`→ fullscreen still open after Escape: ${stillOpen}`)

// After closing, check embed state persists (the run output should now be in embed too)
await new Promise((r) => setTimeout(r, 300))
await page.screenshot({ path: 'smoke-test-embed-after-close.png', fullPage: true })
console.log('→ saved smoke-test-embed-after-close.png')

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
