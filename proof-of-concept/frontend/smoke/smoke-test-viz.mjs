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

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise((r) => setTimeout(r, 800))

const readNodes = () =>
  page.evaluate(() => {
    // find the LinkedList viz — it's the block with "head →" label
    const viz = Array.from(document.querySelectorAll('div')).find((d) =>
      d.textContent?.startsWith('head →')
    )
    if (!viz) return null
    // get all mono-text boxes (the value cells)
    const cells = viz.querySelectorAll('.font-mono.text-slate-100')
    return Array.from(cells).map((c) => c.textContent.trim())
  })

const initial = await readNodes()
console.log('initial nodes:', initial)

async function fillAndClick(valueOrIdx, btnText, isIndex = false) {
  await page.evaluate(
    ({ valueOrIdx, btnText, isIndex }) => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'))
      // pick value input (first per viz) or idx (second)
      const input = inputs[isIndex ? 1 : 0]
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(input, String(valueOrIdx))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === btnText
      )
      btn?.click()
    },
    { valueOrIdx, btnText, isIndex }
  )
  await new Promise((r) => setTimeout(r, 500))
}

await fillAndClick(9, '+ front')
console.log('after +front 9:', await readNodes())

await fillAndClick(7, '+ back')
console.log('after +back 7:', await readNodes())

await fillAndClick(1, 'remove', true)
console.log('after remove [1]:', await readNodes())

// click clear
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === 'clear'
  )
  btn?.click()
})
await new Promise((r) => setTimeout(r, 500))
console.log('after clear:', await readNodes())

await page.screenshot({ path: 'smoke-test-viz.png', fullPage: true })

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
