/**
 * 라이브 검색 — 기본 카탈로그에 없는 상품도 4개 쇼핑몰을 실시간 검색해 찾는다.
 * (Vercel 서버리스에서 4개 소스 모두 호출 가능함을 /api/livetest 로 실측 후 도입:
 *  무신사 0.3s · 컬리 0.6s · 29CM 1.1s · 다나와 4s)
 *
 * 전략:
 *  - 빠른 3종(무신사·컬리·29CM)은 항상 병렬 호출 (타임아웃 2.8s)
 *  - 다나와는 정적 카탈로그가 빈약할 때만 (타임아웃 4.5s)
 *  - 인스턴스 메모리 캐시 10분 — 같은 키워드 반복 질의에 비용/지연 없음
 */
import { danawaSearch, cm29Search, musinsaSearch, kurlySearch, guessBrand, isJunk, flatten } from './_sources.js'
import { assignGroups } from './_intel.js'

const cache = new Map() // keyword -> {at, items}
const TTL = 10 * 60 * 1000
const PER_SOURCE = 6

/** 사용자 문장에서 쇼핑몰 검색어로 쓸 핵심 구절을 추출한다. */
export function extractKeyword(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim()
  // 요청·조건 표현 제거 (검색 엔진에는 명사구가 잘 먹힌다)
  t = t
    .replace(/(찾아\s*줘|찾아\s*주세요|추천해\s*줘|추천해\s*주세요|추천|알려\s*줘|알려\s*주세요|보여\s*줘|보여\s*주세요|골라\s*줘|사고\s*싶어|살까|어때\??|있어\??|있나요\??)/g, ' ')
    .replace(/(제일|가장|젤)\s*(싼|저렴한)\s*(거|것|걸로|제품|상품)?/g, ' ')
    .replace(/(최저가|시세|가격|판매처\s*별로?|어디가)/g, ' ')
    .replace(/\d+\s*만\s*원\s*(대|이하|이상|아래|미만|안으로|이내|넘는)?/g, ' ')
    .replace(/[,.!?~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 너무 길면 앞쪽 명사구 위주로 절단
  return t.split(' ').slice(0, 6).join(' ')
}

export async function liveSearch(keyword, { includeDanawa = false } = {}) {
  const key = `${keyword}|${includeDanawa ? 'd' : '-'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.items

  const jobs = [
    musinsaSearch(keyword, PER_SOURCE, 2800),
    kurlySearch(keyword, PER_SOURCE, 2800),
    cm29Search(keyword, PER_SOURCE, 2800),
  ]
  if (includeDanawa) jobs.push(danawaSearch(keyword, PER_SOURCE, 4500))

  const settled = await Promise.allSettled(jobs)
  const raw = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))

  const items = assignGroups(
    raw
      .filter((r) => r.price >= 1000 && !isJunk(flatten(r.rawTitle)))
      .map((r) => ({
        ...r,
        brand: r.brand || guessBrand(r.rawTitle),
        name: r.rawTitle.slice(0, 70),
        category: keyword.split(' ').slice(-1)[0].slice(0, 10) || '기타', // 검색어 마지막 어절을 종류로
        catGroup: '라이브',
        model: '',
        condition: 'new',
        verified: false,
        tag: '',
        query: keyword,
        live: true, // 실시간 검색 결과 표시용
      }))
  )
  cache.set(key, { at: Date.now(), items })
  return items
}

// ---- self-check: node api/_live.js (네트워크 사용) ----
if (process.argv[1]?.endsWith('_live.js')) {
  const { strict: assert } = await import('node:assert')
  assert.equal(extractKeyword('나이키 후드티 제일 싼 거 찾아줘'), '나이키 후드티')
  assert.equal(extractKeyword('10만원 이하 검정 원피스 추천해줘'), '검정 원피스')
  assert.equal(extractKeyword('모공에 좋은 수분크림, 판매처별로 제일 싼 거 찾아줘'), '모공에 좋은 수분크림')
  const items = await liveSearch('나이키 후드티')
  assert.ok(items.length > 0, '라이브 검색 결과 존재')
  assert.ok(items.every((p) => p.live && p.modelGroup), 'live 플래그·그룹 부여')
  console.log(`✓ liveSearch OK — '나이키 후드티' ${items.length}건 (${[...new Set(items.map((p) => p.seller))].join(', ')})`)
  console.log('  샘플:', items[0].brand, '|', items[0].name.slice(0, 30), '|', items[0].price.toLocaleString() + '원')
}
