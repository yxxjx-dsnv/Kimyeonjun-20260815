/**
 * KREAM 수집기 — 검수 기반 리셀 플랫폼의 즉시구매가.
 *
 * KREAM은 WAF가 비브라우저 TLS를 엣지에서 차단(전 엔드포인트 500)하므로
 * 서버리스 라이브 검색에는 쓸 수 없고, 로컬 실브라우저(Playwright)로
 * 렌더링된 DOM을 수집해 정적 카탈로그에 편입한다.
 *
 * 실행: npm i -D playwright && npx playwright install chromium
 *       node crawler/kream.mjs   (기존 data/products.json에 병합)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PER_QUERY = 8

// 한정판·명품 등 KREAM이 강한 영역 위주
const QUERIES = [
  { q: '나이키 사카이', cat: '운동화', group: '패션' },
  { q: '조던 1', cat: '운동화', group: '패션' },
  { q: '나이키 에어포스', cat: '운동화', group: '패션' },
  { q: '뉴발란스 993', cat: '운동화', group: '패션' },
  { q: '아디다스 삼바', cat: '운동화', group: '패션' },
  { q: '아식스 젤카야노', cat: '운동화', group: '패션' },
  { q: '샤넬 가방', cat: '숄더백', group: '명품' },
  { q: '루이비통 지갑', cat: '카드지갑', group: '명품' },
  { q: '디올 가방', cat: '숄더백', group: '명품' },
  { q: '구찌 지갑', cat: '카드지갑', group: '명품' },
]

const flatten = (s) => (s || '').replace(/\s+/g, '')
const parseCount = (s) => {
  if (!s) return null
  const m = s.replace(/,/g, '').match(/([\d.]+)(만)?/)
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2] ? 10000 : 1))
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'ko-KR',
})
const page = await ctx.newPage()

const collected = []
for (const { q, cat, group } of QUERIES) {
  try {
    await page.goto(`https://kream.co.kr/search?keyword=${encodeURIComponent(q)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(9000) // CSR 렌더 대기
    const rows = await page.evaluate(() => {
      const out = []
      document.querySelectorAll('a[href*="/products/"]').forEach((a) => {
        const t = a.innerText.trim()
        if (!t || t.length < 10) return
        out.push({ href: a.getAttribute('href'), text: t, img: a.querySelector('img')?.src || '' })
      })
      return out
    })
    let n = 0
    for (const r of rows) {
      if (n >= PER_QUERY) break
      const segs = r.text.split('\n').map((s) => s.trim()).filter(Boolean)
      const priceSeg = segs.find((s) => /^[\d,]+원$/.test(s))
      const id = (r.href.match(/products\/(\d+)/) || [])[1]
      if (!priceSeg || !id || segs.length < 2) continue
      const brand = segs[0]
      const name = segs[1]
      const price = Number(priceSeg.replace(/[^\d]/g, ''))
      if (!price || price < 2000) continue
      const reviewSeg = segs.find((s) => s.includes('리뷰'))
      collected.push({
        id: `r${id}`,
        rawTitle: name,
        brand: /나이키|Nike/i.test(brand) ? '나이키' : brand,
        name: name.slice(0, 70),
        category: cat,
        catGroup: group,
        model: '',
        price, // KREAM 즉시구매가
        seller: 'KREAM',
        condition: 'new',
        verified: true, // KREAM 전 상품 검수 후 배송
        rating: null,
        reviewCount: parseCount(reviewSeg),
        url: `https://kream.co.kr/products/${id}`,
        image: r.img,
        tag: '',
        query: q,
      })
      n++
    }
    console.log(`✓ KREAM ${q}: ${n}개`)
  } catch (err) {
    console.warn(`✗ KREAM ${q}: ${String(err).slice(0, 80)}`)
  }
}
await browser.close()

// 기존 카탈로그에 병합 (id 중복 제거) + 그룹 재부여
const path = join(ROOT, 'data', 'products.json')
const existing = JSON.parse(readFileSync(path, 'utf-8')).filter((p) => p.seller !== 'KREAM')
const merged = [...existing, ...collected]
const products = [...new Map(merged.map((p) => [p.id, p])).values()]
for (const p of products) {
  if (!p.modelGroup || p.seller === 'KREAM') {
    p.modelGroup = `${flatten(p.brand)}|${p.category}${p.model ? `|${p.model}` : ''}`
  }
}
writeFileSync(path, JSON.stringify(products, null, 2))
writeFileSync(
  join(ROOT, 'api', '_catalog.js'),
  `// 자동 생성 파일 — 직접 수정하지 말 것. \`npm run crawl\`(4몰) + \`node crawler/kream.mjs\`(KREAM)로 재생성됨.\nexport default ${JSON.stringify(products)}\n`
)
console.log(`\nKREAM ${collected.length}개 병합 → 총 ${products.length}개`)
