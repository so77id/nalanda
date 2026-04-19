import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'https://so77id.github.io/nalanda/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) =>
  errors.push(`failed: ${r.url()} — ${r.failure()?.errorText}`)
)

console.log('→ loading', URL)
const t0 = Date.now()
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 180000 })
console.log(`→ loaded in ${Date.now() - t0}ms`)

console.log('→ waiting for warm...')
const tW = Date.now()
let warm = false
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 500))
  warm = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).some((s) =>
      s.textContent.includes('● warm')
    )
  )
  if (warm) break
}
console.log(`→ warm in ${Date.now() - tW}ms`)
const warmStats = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll('span')).find((s) =>
      s.textContent.startsWith('boot ')
    )?.textContent ?? null
)
console.log('→ stats:', warmStats)

console.log('→ clicking Run...')
await page.evaluate(() =>
  Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent.includes('Run'))
    ?.click()
)
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const label = await page.evaluate(
    () => Array.from(document.querySelectorAll('button'))[0]?.textContent
  )
  if (label?.includes('Run') && !label.includes('ing')) break
}

const timings = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll('span')).find((s) =>
      s.textContent.includes('last run')
    )?.textContent ?? null
)
const output = await page.evaluate(() => {
  const pres = document.querySelectorAll('pre')
  return pres[1]?.textContent ?? null
})
const exit = await page.evaluate(
  () =>
    Array.from(document.querySelectorAll('span')).find((s) =>
      s.textContent.startsWith('exit ')
    )?.textContent ?? null
)
console.log('→', timings)
console.log('→ output:', JSON.stringify(output))
console.log('→ exit:', exit)

if (errors.length) {
  console.log('\n--- ERRORS ---')
  errors.forEach((e) => console.log(e))
}

await browser.close()
