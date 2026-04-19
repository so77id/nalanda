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

const readQueue = () =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-viz="queue"]')
    if (!frame) return null
    const cells = Array.from(
      frame.querySelectorAll('.font-mono.text-slate-100')
    )
    return cells.map((c) => c.textContent.trim())
  })

const click = (label) =>
  page.evaluate((label) => {
    const frame = document.querySelector('[data-viz="queue"]')
    const btn = Array.from(frame.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === label
    )
    btn?.click()
  }, label)

const setValue = (v) =>
  page.evaluate((v) => {
    const frame = document.querySelector('[data-viz="queue"]')
    const input = frame.querySelector('input[type="number"]')
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)

async function step(op, value) {
  if (op === 'enqueue') await setValue(value)
  await click(op)
  await new Promise((r) => setTimeout(r, 800))
}

console.log('initial:', await readQueue())

await step('enqueue', 40)
console.log('enqueue 40:', await readQueue())

await step('enqueue', 50)
console.log('enqueue 50:', await readQueue())

await step('dequeue')
console.log('dequeue:', await readQueue())

await step('dequeue')
console.log('dequeue again:', await readQueue())

await step('dequeue')
await step('dequeue')
await step('dequeue')
console.log('after 5 dequeues total:', await readQueue())

// Click clear via explicit path
await page.evaluate(() => {
  const frame = document.querySelector('[data-viz="queue"]')
  const btn = Array.from(frame.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === 'clear'
  )
  btn?.click()
})

await page.screenshot({ path: 'smoke-test-queue.png', fullPage: true })

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
