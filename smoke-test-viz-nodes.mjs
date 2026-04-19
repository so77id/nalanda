import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 900 })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 500))

// scroll to the viz
await page.evaluate(() => {
  const viz = Array.from(document.querySelectorAll('div')).find((d) =>
    d.textContent?.startsWith('head →')
  )
  viz?.scrollIntoView({ block: 'center' })
})
await new Promise((r) => setTimeout(r, 300))

// take tight screenshot of the viz only
const box = await page.evaluate(() => {
  const viz = Array.from(document.querySelectorAll('.rounded-lg'))
    .find((d) => d.textContent?.includes('linked list'))
  const r = viz.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})
await page.screenshot({
  path: 'smoke-test-viz-closeup.png',
  clip: { x: box.x, y: box.y, width: box.width, height: box.height },
})
console.log('closeup saved, size:', box.width, 'x', box.height)

await browser.close()
