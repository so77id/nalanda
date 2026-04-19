import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5174/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

const selectorsBefore = await page.$$eval('select', (els) => els.map((e) => e.value))
console.log('initial selectors:', selectorsBefore)

// Change the FIRST selector to python
console.log('→ changing selector[0] to python...')
await page.select('select', 'python')
await new Promise((r) => setTimeout(r, 500))

const selectorsAfter = await page.$$eval('select', (els) => els.map((e) => e.value))
console.log('after change:', selectorsAfter)

const allPython = selectorsAfter.every((v) => v === 'python')
console.log('→ all synced to python?', allPython)

// Check that the filenames match (should all say main.py now)
const fileNames = await page.evaluate(() => {
  // find all text content from "main." badges
  return Array.from(
    document.querySelectorAll('span.font-mono.uppercase')
  ).map((s) => s.textContent)
})
console.log('→ filenames in each runner:', fileNames)

// Snapshot the sync'd page
await page.screenshot({ path: 'smoke-test-globalang.png', fullPage: true })

// Now change BACK to cpp via the SECOND selector, verify all sync
console.log('\n→ changing selector[1] back to cpp...')
const selects = await page.$$('select')
await selects[1].select('cpp')
await new Promise((r) => setTimeout(r, 500))

const selectorsFinal = await page.$$eval('select', (els) => els.map((e) => e.value))
console.log('final selectors:', selectorsFinal)
const allCpp = selectorsFinal.every((v) => v === 'cpp')
console.log('→ all synced back to cpp?', allCpp)

await browser.close()
