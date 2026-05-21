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

// Count runners
const runners = await page.evaluate(
  () => document.querySelectorAll('button[title="Pantalla completa"]').length
)
console.log(`→ ${runners} runners on page`)

// Check language selectors
const langOptions = await page.evaluate(() =>
  Array.from(document.querySelectorAll('select'))
    .map((s) => ({
      value: s.value,
      options: Array.from(s.options).map((o) => o.value),
    }))
)
console.log(
  `→ language selectors: ${langOptions.length}, each with options:`,
  langOptions[0]?.options
)

await page.screenshot({ path: 'smoke-test-multilang-page.png', fullPage: true })

// Expand the Python runner (2nd one — index 1)
console.log('\n→ expanding Python runner (index 1)...')
await page.evaluate(() => {
  document.querySelectorAll('button[title="Pantalla completa"]')[1].click()
})
await new Promise((r) => setTimeout(r, 800))

// Wait for warm (python can take longer — pyodide init ~8s)
console.log('→ waiting for python warm (pyodide takes longer)...')
const tWarmPy = Date.now()
let warmPy = false
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  warmPy = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).some((s) =>
      s.textContent.includes('● listo')
    )
  )
  if (warmPy) break
  if (i % 5 === 0) console.log(`  ...still warming (${i}s)`)
}
console.log(`→ python warm in ${Date.now() - tWarmPy}ms: ${warmPy}`)

await page.screenshot({ path: 'smoke-test-multilang-python.png' })

// Click Run
console.log('→ running python...')
await page.evaluate(() => {
  const fs = document.querySelector('.fixed.inset-0.z-50')
  const btn = Array.from(fs.querySelectorAll('button')).find(
    (b) => b.textContent.trim().toLowerCase().includes('ejecutar')
  )
  btn?.click()
})
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const done = await page.evaluate(() => {
    const pres = Array.from(document.querySelectorAll('pre')).map(
      (p) => p.textContent
    )
    return pres.some((t) => t.includes('fib') || t.includes('Error'))
  })
  if (done) break
}

const pyOutput = await page.evaluate(() => {
  const pres = Array.from(document.querySelectorAll('pre'))
  const hit = pres.find((p) => p.textContent.includes('fib'))
  return hit?.textContent ?? null
})
console.log('→ python output:', JSON.stringify(pyOutput))

// Close
await page.keyboard.press('Escape')
await new Promise((r) => setTimeout(r, 500))

// Test C++ runner (first one)
console.log('\n→ expanding C++ runner (index 0)...')
await page.evaluate(() => {
  document.querySelectorAll('button[title="Pantalla completa"]')[0].click()
})
await new Promise((r) => setTimeout(r, 500))

console.log('→ waiting for cpp warm...')
const tWarmCpp = Date.now()
let warmCpp = false
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500))
  warmCpp = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).some((s) =>
      s.textContent.includes('● listo')
    )
  )
  if (warmCpp) break
}
console.log(`→ cpp warm in ${Date.now() - tWarmCpp}ms: ${warmCpp}`)

console.log('→ running cpp...')
await page.evaluate(() => {
  const fs = document.querySelector('.fixed.inset-0.z-50')
  const btn = Array.from(fs.querySelectorAll('button')).find(
    (b) => b.textContent.trim().toLowerCase().includes('ejecutar')
  )
  btn?.click()
})
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const done = await page.evaluate(() => {
    const fs = document.querySelector('.fixed.inset-0.z-50')
    if (!fs) return false
    const pres = Array.from(fs.querySelectorAll('pre')).map(
      (p) => p.textContent
    )
    return pres.some((t) => t.includes('list:'))
  })
  if (done) break
}

const cppOutput = await page.evaluate(() => {
  const fs = document.querySelector('.fixed.inset-0.z-50')
  if (!fs) return null
  const pres = Array.from(fs.querySelectorAll('pre'))
  const hit = pres.find((p) => p.textContent.includes('list:'))
  return hit?.textContent ?? null
})
console.log('→ cpp output:', JSON.stringify(cppOutput))

await page.screenshot({ path: 'smoke-test-multilang-cpp.png' })

if (errs.length) {
  console.log('\n--- ERRORS ---')
  errs.forEach((e) => console.log(e))
}

await browser.close()
