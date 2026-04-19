import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5173/'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const consoleMsgs = []
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) =>
  consoleMsgs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`)
)

console.log('→ loading', URL)
const t0 = Date.now()
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 })
console.log(`→ page loaded in ${Date.now() - t0}ms (networkidle2)`)

// wait for "warm" badge
console.log('→ waiting for worker warm-up...')
const tWarm0 = Date.now()
let warm = false
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500))
  warm = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span')).some((s) =>
      s.textContent.includes('● warm')
    )
  )
  if (warm) break
}
const warmTime = Date.now() - tWarm0
console.log(`→ warm after ${warmTime}ms (${warm ? 'OK' : 'TIMEOUT'})`)

const warmStatsText = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('span'))
  const m = spans.find((s) => s.textContent.startsWith('boot '))
  return m ? m.textContent.trim() : null
})
console.log('→ warm stats:', warmStatsText)

async function clickRunAndWait(label) {
  console.log(`\n→ [${label}] clicking Run...`)
  const tc = Date.now()
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Run')
    )
    btn.click()
  })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250))
    const label = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))[0]
      return b?.textContent
    })
    if (label && label.includes('Run') && !label.includes('ing')) break
  }
  console.log(`  done in ${Date.now() - tc}ms total`)
  const timings = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'))
    const m = spans.find((s) => s.textContent.includes('last run'))
    return m ? m.textContent.trim() : null
  })
  const output = await page.evaluate(() => {
    const pres = document.querySelectorAll('pre')
    return pres[1] ? pres[1].textContent.slice(0, 200) : null
  })
  console.log(`  timings: ${timings}`)
  console.log(`  output:  ${JSON.stringify(output)}`)
}

// Run 1: initial program (linked list)
await clickRunAndWait('run 1 — linked list')

// Run 2: same program again (should be same or similar — no memoization yet)
await clickRunAndWait('run 2 — linked list again')

// Run 3: replace with STL-heavy program
console.log('\n→ replacing source with STL-heavy program...')
const STL_CODE = `#include <iostream>
#include <vector>
#include <map>
#include <set>
#include <algorithm>
#include <numeric>
using namespace std;
int main(){
  vector<int> v={3,1,4,1,5,9,2,6,5,3,5};
  sort(v.begin(),v.end());
  map<int,int> freq; for(int x:v) freq[x]++;
  int sum=accumulate(v.begin(),v.end(),0);
  cout<<"sum="<<sum<<" max="<<*max_element(v.begin(),v.end())<<endl;
  for(auto [k,c]:freq) cout<<k<<"->"<<c<<" ";
  cout<<endl; return 0;
}`
await page.evaluate((src) => {
  // Set CodeMirror content via dispatching a change event; simplest: find the editor's parent and use its DOM
  // Actually easier — find the textarea-like element or use the React internal. For now, use document.execCommand style
  const cm = document.querySelector('.cm-content')
  if (cm) {
    // Find the CodeMirror EditorView and dispatch
    // Fallback: use selection API
    cm.focus()
  }
}, STL_CODE)
// Simpler: use keyboard to select all + type
await page.keyboard.down('Meta')
await page.keyboard.press('a')
await page.keyboard.up('Meta')
await page.keyboard.press('Backspace')
await page.keyboard.sendCharacter(STL_CODE)

await clickRunAndWait('run 3 — STL heavy')
await clickRunAndWait('run 4 — STL heavy again')

await page.screenshot({ path: 'smoke-test.png', fullPage: true })
console.log('\n→ screenshot saved\n')

console.log('--- last 10 console msgs ---')
for (const m of consoleMsgs.slice(-10)) console.log(m)

await browser.close()
