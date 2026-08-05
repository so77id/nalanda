import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 1100 })

const errs = []
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))

const readBST = () =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-viz="bst"]')
    if (!frame) return null
    const cells = Array.from(frame.querySelectorAll('[data-cell]'))
    return cells.map((c) => c.getAttribute('data-cell'))
  })

const readEdgeCount = () =>
  page.evaluate(() => {
    const frame = document.querySelector('[data-viz="bst"]')
    return frame?.querySelectorAll('svg line').length ?? 0
  })

const click = (label) =>
  page.evaluate((label) => {
    const frame = document.querySelector('[data-viz="bst"]')
    const btn = Array.from(frame.querySelectorAll('button')).find(
      (b) => b.textContent.trim().toLowerCase() === label.toLowerCase()
    )
    btn?.click()
  }, label)

const setValue = (v) =>
  page.evaluate((v) => {
    const frame = document.querySelector('[data-viz="bst"]')
    const input = frame.querySelector('input[type="number"]')
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, String(v))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)

async function step(op, value) {
  await setValue(value)
  await click(op)
  await new Promise((r) => setTimeout(r, 900))
}

// initial tree is [5, 3, 8, 1, 4, 7, 9] → in-order traversal = 1,3,4,5,7,8,9
console.log('initial (in-order):', await readBST())
console.log('edges:', await readEdgeCount())

// insert 2: in-order should now be 1,2,3,4,5,7,8,9
await step('insertar', 2)
console.log('after insert 2:', await readBST())
console.log('edges:', await readEdgeCount())

// insert 6
await step('insertar', 6)
console.log('after insert 6:', await readBST())
console.log('edges:', await readEdgeCount())

// delete a leaf (1)
await step('eliminar', 1)
console.log('after delete 1:', await readBST())

// delete node with one child
await step('eliminar', 3)
console.log('after delete 3:', await readBST())

// delete root (5) — forces 2-children case
await step('eliminar', 5)
console.log('after delete 5 (root):', await readBST())

// try to delete something missing
await step('eliminar', 99)
const err = await page.evaluate(() => {
  const frame = document.querySelector('[data-viz="bst"]')
  return frame?.querySelector('[data-role="error"]')?.textContent?.trim() ?? null
})
console.log('error after delete 99:', JSON.stringify(err))

await page.screenshot({ path: 'smoke-test-bst.png', fullPage: true })

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
