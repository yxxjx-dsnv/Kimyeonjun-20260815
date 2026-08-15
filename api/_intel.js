/**
 * 가격 인텔리전스 공용 모듈 — /api/chat 과 /api/catalog 가 함께 쓴다.
 *
 * 같은 modelGroup(브랜드|종류|모델) 매물끼리 비교해
 *  1) 중고 시세 분포 (최저/중앙/최고, 시세 대비 %)
 *  2) 새상품 최저가(다나와) 대비 절약률
 * 을 계산한다. 근거가 약하면 숫자를 만들지 않는 것이 원칙이다 (아래 상수 참고).
 */
import CATALOG from './_catalog.js'

export { CATALOG }

export const MIN_PEERS = 3 // 비교군이 이보다 적으면 '시세'라고 부르지 않는다
// 최고/최저가가 이 배수를 넘는 그룹은 '중앙값 = 시세'라고 볼 수 없다.
// (샤넬|숄더백 그룹은 복조리백 15만원~2.55백 855만원이 함께 묶여 57배가 나온다.
//  이때 중앙값 대비 "92% 저렴"은 거짓 정보다. 순위·가격대만 사실로 남긴다.)
export const MAX_SPREAD = 4

export const byId = new Map(CATALOG.map((p) => [p.id, p]))

// 모델 그룹 인덱스는 모듈 로드 시 1회만 만든다.
const GROUPS = new Map()
for (const p of CATALOG) {
  if (!GROUPS.has(p.modelGroup)) GROUPS.set(p.modelGroup, [])
  GROUPS.get(p.modelGroup).push(p)
}
export { GROUPS }

/**
 * @returns null | {
 *   basis, isModelLevel, count,
 *   newBest: {price,name,url,seller}|null,  // 같은 그룹 새상품 최저가
 *   vsNewPct: number|null,                  // 중고 매물이 새상품 대비 몇 % 저렴한지
 *   stats: {min,median,max,medianReliable,discountPct,rank}|null, // 그룹 시세 (비교군 충분할 때만)
 *   peers: [...]                            // 가격 비교 리스트 (자기 제외, 가격순 최대 6)
 * }
 */
export function priceIntel(product) {
  const group = GROUPS.get(product.modelGroup) || []
  const others = group.filter((p) => p.id !== product.id)
  if (others.length === 0) return null // 비교할 대상이 아예 없다

  // --- 새상품 최저가 대비 (중고 매물에만 의미가 있다) ---
  let newBest = null
  let vsNewPct = null
  if (product.condition === 'used') {
    const news = others.filter((p) => p.condition === 'new').sort((a, b) => a.price - b.price)
    if (news.length > 0) {
      const n = news[0]
      newBest = { price: n.price, name: n.name, url: n.url, seller: n.seller }
      vsNewPct = Math.round((1 - product.price / n.price) * 100)
    }
  }

  // --- 그룹 시세 분포 (비교군이 충분할 때만) ---
  let stats = null
  if (group.length >= MIN_PEERS) {
    const prices = group.map((p) => p.price).sort((a, b) => a - b)
    const min = prices[0]
    const max = prices[prices.length - 1]
    const median = prices[Math.floor(prices.length / 2)]
    stats = {
      min,
      median,
      max,
      medianReliable: max / min <= MAX_SPREAD,
      discountPct: Math.round((1 - product.price / median) * 100),
      rank: prices.filter((p) => p < product.price).length + 1, // 1이면 최저가
    }
  }

  return {
    // 모델을 특정하지 못한 그룹은 '같은 모델'이라고 하지 않는다 (과장 금지)
    basis: product.model
      ? `${product.brand} ${product.model} ${product.category}`
      : `${product.brand} ${product.category}`,
    isModelLevel: Boolean(product.model),
    count: group.length,
    newBest,
    vsNewPct,
    stats,
    peers: others
      .sort((a, b) => a.price - b.price)
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        price: p.price,
        name: p.name,
        url: p.url,
        seller: p.seller,
        condition: p.condition,
        verified: p.verified,
      })),
  }
}

// 새상품 기준가가 존재해 '절약 계산서'를 보여줄 수 있는 중고 매물 id 집합.
// chat.js가 카탈로그 라인에 표시해, "얼마나 아껴?" 질문에 AI가 이 매물을 우선 고르게 한다.
export const HAS_NEW_COMPARE = new Set(
  CATALOG.filter((p) => p.condition === 'used' && priceIntel(p)?.newBest).map((p) => p.id)
)

// ---- self-check (순수 함수 검증): node api/_intel.js ----
if (process.argv[1]?.endsWith('_intel.js')) {
  const { strict: assert } = await import('node:assert')

  let statsN = 0, reliableN = 0, newBestN = 0, wideSeen = false
  for (const p of CATALOG) {
    const i = priceIntel(p)
    if (!i) continue
    if (i.stats) {
      statsN++
      const s = i.stats
      assert.ok(s.min <= s.median && s.median <= s.max, '최저<=중앙<=최고')
      assert.ok(s.rank >= 1 && s.rank <= i.count, 'rank 범위')
      assert.equal(s.medianReliable, s.max / s.min <= MAX_SPREAD, '편차 기준 일치')
      if (s.medianReliable) reliableN++
      else wideSeen = true
    }
    if (i.newBest) {
      newBestN++
      assert.equal(p.condition, 'used', '새상품 비교는 중고 매물에만 붙는다')
      assert.equal(i.vsNewPct, Math.round((1 - p.price / i.newBest.price) * 100))
    }
    assert.ok(i.peers.every((x) => x.id !== p.id), 'peers에 자기 자신 없음')
  }
  assert.ok(wideSeen, '편차 큰 그룹이 실제로 존재해야 방어 로직이 의미 있다')
  const singleton = CATALOG.find((p) => (GROUPS.get(p.modelGroup) || []).length === 1)
  if (singleton) assert.equal(priceIntel(singleton), null, '단독 매물은 비교 정보 없음')
  console.log(
    `✓ priceIntel OK — 카탈로그 ${CATALOG.length}건 / 시세 분포 ${statsN}건(그중 % 주장 가능 ${reliableN}건) / 새상품 대비 계산 ${newBestN}건`
  )
}
