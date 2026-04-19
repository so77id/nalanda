import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

const consoleMsgs = []
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) =>
  consoleMsgs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`)
)

console.log('→ Loading', URL)
try {
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
} catch (e) {
  console.log('goto failed:', e.message)
}

await new Promise((r) => setTimeout(r, 1500))

const headingText = await page.evaluate(() => {
  const h = document.querySelector('h1')
  return h ? h.textContent : null
})
console.log('→ heading:', JSON.stringify(headingText))

const hasRunButton = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).some((b) =>
    b.textContent.includes('Run')
  )
)
console.log('→ run button present:', hasRunButton)

if (hasRunButton) {
  console.log('→ clicking Run...')
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Run')
    )
    btn.click()
  })
  await new Promise((r) => setTimeout(r, 3000))

  const output = await page.evaluate(() => {
    const pre = document.querySelector('pre')
    return pre ? pre.textContent : null
  })
  console.log('→ output panel:', JSON.stringify(output))

  const exitBadge = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'))
    const m = spans.find((s) => s.textContent.startsWith('exit '))
    return m ? m.textContent : null
  })
  console.log('→ exit badge:', JSON.stringify(exitBadge))
}

await page.screenshot({ path: 'smoke-test.png', fullPage: true })
console.log('→ screenshot saved to smoke-test.png')

console.log('\n--- console messages ---')
for (const m of consoleMsgs) console.log(m)

await browser.close()
