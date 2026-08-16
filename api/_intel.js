/**
 * 가격 인텔리전스 공용 모듈 — /api/chat 과 /api/catalog 가 함께 쓴다.
 *
 * 같은 modelGroup(브랜드|종류[|모델]) 상품끼리 비교해 시세 분포와
 * 판매처별 가격 비교를 계산한다. 근거가 약하면 숫자를 만들지 않는 것이 원칙:
 *  - 비교군 3건 미만 → 시세 없음
 *  - 최고/최저 편차 4배 초과 → "% 저렴" 대신 순위·가격대만 (medianReliable=false)
 *
 * intelWithin(collection, product)로 임의 컬렉션(라이브 검색 결과 병합본)에도
 * 같은 로직을 적용할 수 있다.
 */
import CATALOG from './_catalog.js'

export { CATALOG }

export const MIN_PEERS = 3
// 편차 허용 상한. 4배까지 허용했더니 '물티슈 60매 vs 70매 4팩'처럼 서로 다른 상품이
// 한 시세로 묶여 "72% 저렴"이 나왔다. 1.5배로 조여 동일·준동일 상품만 % 주장을 허용한다.
export const MAX_SPREAD = 1.5

export const byId = new Map(CATALOG.map((p) => [p.id, p]))

const flat = (s) => (s || '').replace(/\s+/g, '')

// 정적 카탈로그의 그룹 인덱스는 모듈 로드 시 1회만 만든다.
const GROUPS = new Map()
for (const p of CATALOG) {
  if (!GROUPS.has(p.modelGroup)) GROUPS.set(p.modelGroup, [])
  GROUPS.get(p.modelGroup).push(p)
}
export { GROUPS }

function computeIntel(product, group) {
  const others = group.filter((p) => p.id !== product.id)
  if (others.length === 0) return null

  let stats = null
  if (group.length >= MIN_PEERS) {
    const prices = group.map((p) => p.price).sort((a, b) => a - b)
    const min = prices[0]
    const max = prices[prices.length - 1]
    // 짝수 개일 때 prices[n/2]는 중앙값이 아니라 '가운데 위' 값이라 시세가 부풀고
    // 할인율이 항상 과장된다. 두 중앙값의 평균으로 계산한다.
    const mid = prices.length >> 1
    const median =
      prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2)
    stats = {
      min,
      median,
      max,
      medianReliable: max / min <= MAX_SPREAD,
      discountPct: Math.round((1 - product.price / median) * 100),
      rank: prices.filter((p) => p < product.price).length + 1,
    }
  }

  return {
    basis: product.model
      ? `${product.brand} ${product.model} ${product.category}`
      : `${product.brand} ${product.category}`,
    isModelLevel: Boolean(product.model),
    count: group.length,
    // 서로 다른 판매처가 몇 곳 비교되는지 — '판매처 별 판매가'의 근거
    sellerCount: new Set(group.map((p) => p.seller)).size,
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
        rating: p.rating ?? null,
      })),
  }
}

/** 정적 카탈로그 기준 (사전 인덱스 사용). */
export function priceIntel(product) {
  return computeIntel(product, GROUPS.get(product.modelGroup) || [])
}

/** 임의 컬렉션 기준 — 라이브 검색 결과를 병합했을 때 사용. */
export function intelWithin(collection, product) {
  const key = product.modelGroup
  const group = collection.filter((p) => p.modelGroup === key)
  return computeIntel(product, group)
}

/** 상품 배열에 modelGroup을 부여한다 (라이브 검색 결과용). */
export function assignGroups(items) {
  for (const p of items) {
    p.modelGroup = `${flat(p.brand)}|${p.category}${p.model ? `|${p.model}` : ''}`
  }
  return items
}

// ---- self-check: node api/_intel.js ----
if (process.argv[1]?.endsWith('_intel.js')) {
  const { strict: assert } = await import('node:assert')

  let statsN = 0, reliableN = 0, wideSeen = false, crossN = 0
  for (const p of CATALOG) {
    const i = priceIntel(p)
    if (!i) continue
    assert.ok(i.peers.every((x) => x.id !== p.id), 'peers에 자기 자신 없음')
    if (i.sellerCount >= 2) crossN++
    if (i.stats) {
      statsN++
      const s = i.stats
      assert.ok(s.min <= s.median && s.median <= s.max, '최저<=중앙<=최고')
      assert.ok(s.rank >= 1 && s.rank <= i.count, 'rank 범위')
      assert.equal(s.medianReliable, s.max / s.min <= MAX_SPREAD, '편차 기준 일치')
      if (s.medianReliable) reliableN++
      else wideSeen = true
    }
  }
  assert.ok(wideSeen, '편차 큰 그룹이 실제로 존재해야 방어 로직이 의미 있다')
  assert.ok(CATALOG.every((p) => p.condition === 'new'), '카탈로그는 새상품 전용')

  // intelWithin: 라이브 병합 시나리오 — 그룹이 커지면 비교 수가 늘어야 한다
  const target = CATALOG.find((p) => priceIntel(p)?.stats)
  const fake = assignGroups([
    { ...target, id: 'live1', price: Math.round(target.price * 0.9), seller: '라이브테스트' },
  ])
  const merged = [...CATALOG, ...fake]
  const iw = intelWithin(merged, target)
  assert.equal(iw.count, priceIntel(target).count + 1, 'intelWithin이 병합 컬렉션을 반영')

  console.log(
    `✓ priceIntel OK — 새상품 ${CATALOG.length}건 / 시세 분포 ${statsN}건(% 주장 가능 ${reliableN}건) / 판매처 교차 비교 ${crossN}건 / intelWithin 병합 검증 통과`
  )
}
