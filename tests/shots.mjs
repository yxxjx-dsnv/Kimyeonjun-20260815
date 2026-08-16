/**
 * 발표자료용 스크린샷 촬영.
 *   node tests/shots.mjs [baseUrl] [outDir]
 * 기본값: 배포본 → ../images
 *
 * 발표자료의 \phoneshot{} 이 참조하는 파일을 그대로 만든다.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'https://luxury-agent-demo.vercel.app'
const OUT = process.argv[3] || path.resolve(process.cwd(), '../images')
mkdirSync(OUT, { recursive: true })

/** clipH를 주면 위에서 그 높이만 잘라 담는다 (아래 빈 공간 제거). */
const shot = async (page, name, clipH) => {
  const f = path.join(OUT, `${name}.png`)
  const opt = clipH ? { path: f, clip: { x: 0, y: 0, width: 414, height: clipH } } : { path: f }
  await page.screenshot(opt)
  console.log('  ✓', path.basename(f), clipH ? `(상단 ${clipH}px)` : '')
}

/** 답변이 도착할 때까지 기다린다(진행 표시가 사라지는 시점). */
const waitAnswer = (page) =>
  page.waitForFunction(() => !document.querySelector('.prog'), null, { timeout: 60000 })

const ask = async (page, text) => {
  await page.fill('textarea', text)
  await page.click('button[aria-label="전송"]')
}

const run = async () => {
  const browser = await chromium.launch()

  /* ---------- 모바일 화면 ---------- */
  const m = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 })
  const p = await m.newPage()

  await p.goto(BASE, { waitUntil: 'networkidle' })
  await shot(p, 'shot1_home')

  // 홈 첫 타일 = 서술형 탐색
  await p.getByRole('button', { name: /서술로 찾기/ }).click()
  await p.waitForSelector('.prog', { timeout: 10000 })
  await p.waitForTimeout(1400) // 진행 단계가 몇 개 지난 시점
  await shot(p, 'shot2_progress', 330) // 진행 카드까지만 — 아래는 빈 화면이다

  await waitAnswer(p)
  await p.waitForTimeout(700)
  await shot(p, 'shot3_result')

  // 가격 비교 시트
  await p.getByRole('button', { name: /가격 비교/ }).first().click()
  await p.waitForTimeout(900)
  await shot(p, 'shot4_compare')
  await p.keyboard.press('Escape').catch(() => {})

  // 카탈로그에 없는 요청 → 정직한 안내
  const p2 = await m.newPage()
  await p2.goto(BASE, { waitUntil: 'networkidle' })
  await ask(p2, '발렌시아가 벨트 있나요 로고 버클 달린 거요')
  await waitAnswer(p2)
  await p2.waitForTimeout(700)
  await shot(p2, 'shot5_notfound')

  /* ---------- 데스크톱: 사이드 가이드 ---------- */
  const d = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 2 })
  const pd = await d.newPage()
  await pd.goto(BASE, { waitUntil: 'networkidle' })
  await pd.waitForTimeout(600)
  await shot(pd, 'shot6_desktop')

  await browser.close()
  console.log('\n저장 위치:', OUT)
}

run().catch((e) => {
  console.error('촬영 실패:', e.message)
  process.exit(1)
})
