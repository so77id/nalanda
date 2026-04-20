import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5180/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

// Track network: count bytes transferred for WASM/tar/pch assets
const transfer = new Map()
page.on('response', async (r) => {
  const url = r.url()
  if (/\.(wasm|tar|pch)$/.test(url)) {
    try {
      const len = Number(r.headers()['content-length'] ?? 0)
      const encoding = r.headers()['content-encoding'] ?? 'none'
      transfer.set(url.split('/').pop(), { size: len, encoding })
    } catch {}
  }
})

const consoleMsgs = []
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) =>
  consoleMsgs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`)
)

console.log('→ loading', URL)
const t0 = Date.now()
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 })
console.log(`→ page loaded in ${Date.now() - t0}ms`)

console.log('→ waiting for warm...')
let warm = false
const tWarm = Date.now()
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500))
  warm = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).some((s) =>
      s.textContent.includes('● listo')
    )
  )
  if (warm) break
}
console.log(`→ warm in ${Date.now() - tWarm}ms (${warm ? 'OK' : 'TIMEOUT'})`)

const warmStats = await page.evaluate(() => {
  const m = Array.from(document.querySelectorAll('span')).find((s) =>
    s.textContent.startsWith('boot ')
  )
  return m?.textContent.trim() ?? null
})
console.log('→ warm stats:', warmStats)

console.log('\n→ transferred assets:')
for (const [name, info] of transfer) {
  const mb = (info.size / 1024 / 1024).toFixed(2)
  console.log(`  ${name}: ${mb}MB (${info.encoding})`)
}

console.log('\n→ clicking Run (linked list)...')
const tc = Date.now()
await page.evaluate(() => {
  Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.includes('Ejecutar'))
    ?.click()
})
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const label = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))[0]?.textContent
  )
  if (label?.includes('Ejecutar') && !label.includes('Ejecutando')) break
}
console.log(`  done in ${Date.now() - tc}ms`)

const timings = await page.evaluate(() => {
  const m = Array.from(document.querySelectorAll('span')).find((s) =>
    s.textContent.includes('última ejecución')
  )
  return m?.textContent.trim() ?? null
})
const output = await page.evaluate(() => {
  const pres = document.querySelectorAll('pre')
  return pres[1]?.textContent ?? null
})
const exit = await page.evaluate(() => {
  const m = Array.from(document.querySelectorAll('span')).find((s) =>
    s.textContent.startsWith('exit ')
  )
  return m?.textContent ?? null
})
console.log('→ timings:', timings)
console.log('→ output: ', JSON.stringify(output))
console.log('→ exit:   ', exit)

await page.screenshot({ path: 'smoke-test-prod.png', fullPage: true })

if (consoleMsgs.some((m) => m.includes('pageerror') || m.includes('requestfailed'))) {
  console.log('\n--- errors detected ---')
  for (const m of consoleMsgs)
    if (m.includes('pageerror') || m.includes('requestfailed'))
      console.log(m)
}

await browser.close()
