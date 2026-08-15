// 실제 브라우저(Chromium)로 전체 플로우 검증 + 발표자료용 스크린샷 촬영
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// 실행: npm i -D playwright && npx playwright install chromium
//       vercel dev --listen 3000 을 띄운 뒤  BASE=http://localhost:3000 node tests/browser.e2e.mjs
const BASE = process.env.BASE || 'http://localhost:3000'
const IMG = process.env.SHOT_DIR || new URL('./screenshots', import.meta.url).pathname
mkdirSync(IMG, { recursive: true })

let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗ 실패'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => { console.log('✗ JS 에러:', e.message); fail++ })
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

/* 1) 홈 */
await page.goto(BASE, { waitUntil: 'networkidle' })
check('홈 헤드라인', await page.locator('.home__title').innerText() === '구매하고 싶은\n상품이 있으신가요?')
check('2×2 선택지 4개', (await page.locator('.gcard').count()) === 4)
await page.screenshot({ path: `${IMG}/shot_home.png` })

/* 2) 선택지 탭 → 입력 채움 → 전송 → 카드 대기 (절약 계산서 나오는 질의) */
await page.locator('.gcard').nth(2).click() // 새상품 대비 절약액 확인 — 탭 즉시 전송
await page.waitForSelector('.upill', { timeout: 10000 })
check('선택지 탭 → 즉시 전송', (await page.locator('.upill').innerText()).includes('루이비통'))
await page.waitForSelector('.card', { timeout: 90000 })
check('상품 카드 렌더', (await page.locator('.card').count()) >= 1)
check('유저 발화 pill', (await page.locator('.upill').count()) === 1)
check('상태행 (AI 기준 정리 완료)', await page.locator('.statusrow').first().innerText().then((t) => t.includes('정리 완료')))
const bodyText = await page.locator('.thread').innerText()
check('브랜드 가드 (루이비통만)', !bodyText.includes('샤넬 ') && bodyText.includes('루이비통'))
await page.screenshot({ path: `${IMG}/shot_chat.png` })

/* 3) 절약 계산서 카드 단독 캡처 (발표자료용) */
const ledgerCard = page.locator('.card', { has: page.locator('.ledger__total') }).first()
if (await ledgerCard.count()) {
  await ledgerCard.scrollIntoViewIfNeeded()
  await ledgerCard.screenshot({ path: `${IMG}/shot_ledger.png` })
  check('절약 계산서 표시', (await ledgerCard.innerText()).includes('지금 사면 절약'))
} else {
  // 절약 계산서가 없으면 첫 카드라도 캡처 (질의에 따라 다를 수 있음)
  await page.locator('.card').first().screenshot({ path: `${IMG}/shot_ledger.png` })
  check('절약 계산서 표시', false, '이번 응답에는 새상품 비교 매물이 없음')
}

/* 4) 가격 비교 시트 (판매처 별 판매가) */
const cmpBtn = page.locator('.card__compare').first()
if (await cmpBtn.count()) {
  await cmpBtn.click()
  await page.waitForSelector('.csheet__rows li', { timeout: 15000 })
  check('가격 비교 시트 — 판매처 별 판매가', (await page.locator('.csheet__rows li').count()) >= 2)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${IMG}/shot_compare.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
} else {
  check('가격 비교 시트 — 판매처 별 판매가', false, '비교군 없음')
}

/* 4.5) 비교표로 보기 탭 */
if (await page.locator('.viewtabs').count()) {
  await page.locator('.viewtabs button').nth(1).click()
  await page.waitForTimeout(400)
  check('비교표로 보기', (await page.locator('.ctable').count()) === 1)
  await page.screenshot({ path: `${IMG}/shot_table.png` })
  await page.locator('.viewtabs button').nth(0).click()
} else {
  console.log('  (후보 1건이라 비교표 탭 없음)')
}

/* 5) 찜 동작 (localStorage 영속) */
await page.locator('.card .favbtn').first().click()
const favCount = await page.evaluate(() => JSON.parse(localStorage.getItem('ggij:favs') || '[]').length)
check('찜 → localStorage 저장', favCount === 1)

/* 6) 둘러보기 (나침반 아이콘) */
await page.locator('button[aria-label="최저가 탐색"]').click()
await page.waitForSelector('.mini__hit img', { timeout: 30000 })
check('둘러보기 그리드', (await page.locator('.mini').count()) >= 6)
await page.locator('.fchip', { hasText: '뷰티' }).click()
await page.waitForTimeout(400)
check('뷰티 필터', (await page.locator('.browse__count').innerText()).match(/\d+/)[0] > 0)
await page.screenshot({ path: `${IMG}/shot_browse.png` })

/* 7) 상세 시트 */
await page.locator('.mini__hit').first().click()
await page.waitForSelector('.sheet .csheet__rows, .sheet .csheet__product')
check('상세 시트(가격 비교) 열림', true)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('ESC로 닫힘', (await page.locator('.sheet').count()) === 0)

/* 8) 찜 탭 반영 */
await page.locator('button[aria-label="찜한 목록"]').click()
await page.waitForTimeout(500)
check('찜 목록에 1건', (await page.locator('.mini').count()) === 1)

/* 9) 홈 복귀 후 뷰티 질의 → 두 번째 대화 흐름 + 질문 카드 확인 */
await page.locator('button[aria-label="AI 찾기 홈"]').click()
await page.locator('.hero textarea').fill('모공에 좋은 수분크림, 판매처별로 제일 싼 거 찾아줘')
await page.locator('.hero .sendbtn').click()
await page.waitForSelector('.card', { timeout: 60000 })
const hasQcard = (await page.locator('.qcard').count()) > 0
console.log(`  (질문 카드 ${hasQcard ? '표시됨 — 선택지 탭 테스트' : '이번 응답엔 없음'})`)
if (hasQcard) {
  const before = await page.locator('.upill').count()
  await page.locator('.qcard__opts button').first().click()
  await page.locator('.qcard__next').click()
  await page.waitForFunction((n) => document.querySelectorAll('.upill').length > n, before, { timeout: 60000 })
  check('질문 카드 선택 → 선택 완료 → 전송', true)
}
await page.screenshot({ path: `${IMG}/shot_beauty.png` })

console.log('\n콘솔 에러:', consoleErrors.length === 0 ? '없음' : consoleErrors.slice(0, 3))
if (consoleErrors.some((e) => !e.includes('favicon'))) fail++

await browser.close()
console.log(fail === 0 ? '\n✅ 브라우저 E2E 전부 통과' : `\n❌ 실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
