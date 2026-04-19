import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })

const errs = []
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))

const readStack = () =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-viz="stack"]')
    if (!frame) return null
    // node boxes have .font-mono.text-slate-100
    const cells = Array.from(
      frame.querySelectorAll('.font-mono.text-slate-100')
    )
    return cells.map((c) => c.textContent.trim())
  })

const click = (label) =>
  page.evaluate((label) => {
    const frame = document.querySelector('[data-viz="stack"]')
    const btn = Array.from(frame.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === label
    )
    btn?.click()
  }, label)

const setValue = (v) =>
  page.evaluate((v) => {
    const frame = document.querySelector('[data-viz="stack"]')
    const input = frame.querySelector('input[type="number"]')
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)

async function step(op, value) {
  if (op === 'push') await setValue(value)
  await click(op)
  await new Promise((r) => setTimeout(r, 800))
}

console.log('initial:', await readStack())

await step('push', 7)
console.log('push 7:', await readStack())

await step('push', 9)
console.log('push 9:', await readStack())

await step('pop')
console.log('pop:', await readStack())

await step('pop')
await step('pop')
await step('pop')
console.log('after 4 pops total:', await readStack())

await page.screenshot({ path: 'smoke-test-stack.png', fullPage: true })

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
