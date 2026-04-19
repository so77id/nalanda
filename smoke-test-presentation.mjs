import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const errs = []
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))

const getMode = () =>
  page.evaluate(() => document.querySelector('[data-mode]')?.dataset.mode)

const getCounter = () =>
  page.evaluate(() => {
    const m = Array.from(document.querySelectorAll('.font-mono')).find((el) =>
      /^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent.trim())
    )
    return m?.textContent.trim()
  })

const getVisibleSlideIndex = () =>
  page.evaluate(() => {
    const sections = document.querySelectorAll('section[data-slide]')
    for (const s of sections) {
      if (s.style.display !== 'none') return Number(s.dataset.slide)
    }
    return null
  })

console.log('→ initial mode:', await getMode())

// ------------------------------------------------------------------
// Pre-setup: mutate a BSTViz in study mode so we can verify its state
// survives the mode switch (the core contract of CSS-only toggle).
// ------------------------------------------------------------------
console.log('\n→ inserting 999 into BST before presenting...')
await page.evaluate(() => {
  const bst = document.querySelector('[data-viz="bst"]')
  const input = bst.querySelector('input[type="number"]')
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set
  setter.call(input, '999')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = Array.from(bst.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === 'insert'
  )
  btn.click()
})
await new Promise((r) => setTimeout(r, 500))

const has999Before = await page.evaluate(() => {
  const bst = document.querySelector('[data-viz="bst"]')
  return bst.textContent.includes('999')
})
console.log('→ 999 present before presenting?', has999Before)

// ------------------------------------------------------------------
// Click Presentar
// ------------------------------------------------------------------
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent.trim().includes('Presentar')
  )
  btn.click()
})
await new Promise((r) => setTimeout(r, 400))

console.log('→ after clicking Presentar — mode:', await getMode())
console.log('→ slide counter:', await getCounter())
console.log('→ visible slide index:', await getVisibleSlideIndex())
await page.screenshot({ path: 'smoke-test-presentation-cover.png' })

// Navigate with ArrowRight
await page.keyboard.press('ArrowRight')
await new Promise((r) => setTimeout(r, 300))
console.log('→ after →: counter=', await getCounter(), 'idx=', await getVisibleSlideIndex())

await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await new Promise((r) => setTimeout(r, 300))
console.log('→ after →→→: counter=', await getCounter(), 'idx=', await getVisibleSlideIndex())

// Jump to last with End
await page.keyboard.press('End')
await new Promise((r) => setTimeout(r, 300))
console.log('→ after End: counter=', await getCounter())
await page.screenshot({ path: 'smoke-test-presentation-last.png' })

// Back to cover with Home
await page.keyboard.press('Home')
await new Promise((r) => setTimeout(r, 300))
console.log('→ after Home: counter=', await getCounter())

// Escape to exit
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 400))
console.log('\n→ after Escape — mode:', await getMode())

// ------------------------------------------------------------------
// Verify BST state survived (999 still there)
// ------------------------------------------------------------------
const has999After = await page.evaluate(() => {
  const bst = document.querySelector('[data-viz="bst"]')
  return bst.textContent.includes('999')
})
console.log('→ 999 still present after exit?', has999After, '(should be true)')

await page.screenshot({
  path: 'smoke-test-presentation-exited.png',
  fullPage: true,
})

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
