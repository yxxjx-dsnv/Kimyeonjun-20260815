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
import { assignGroups, CATALOG } from './_intel.js'

/**
 * 라이브 결과의 '종류'는 상품 제목에서 뽑는다.
 * 예전에는 검색어의 마지막 어절을 그대로 썼는데, 그러면
 * "10만원 이하 원피스" → 종류 "이하", "선물할 만한 거" → 종류 "상품"처럼
 * 말이 안 되는 값이 카드에 그대로 노출됐다.
 */
const KNOWN_CATS = [
  ...new Set([
    ...CATALOG.map((p) => p.category).filter((c) => c && c !== '기타'),
    // 카탈로그엔 없지만 실시간 검색에서는 나오는 종류
    '슬리퍼', '샌들', '부츠', '구두', '모자', '벨트', '시계', '목걸이', '반지', '귀걸이',
    '선글라스', '스카프', '장갑', '양말', '파자마', '잠옷', '가방', '지갑',
  ]),
].sort((a, b) => b.length - a.length) // 긴 것 우선 — '카드지갑'이 '지갑'보다 먼저

const NON_CAT = new Set(['이하', '이상', '미만', '초과', '만원', '원', '추천', '상품', '거', '것', '개', '종'])

export function categoryFrom(title, keyword) {
  const t = (title || '').replace(/\s+/g, '')
  const hit = KNOWN_CATS.find((c) => t.includes(c.replace(/\s+/g, '')))
  if (hit) return hit
  const last = (keyword || '').split(/\s+/).filter(Boolean).slice(-1)[0] || ''
  if (last && !NON_CAT.has(last) && !/^\d/.test(last)) return last.slice(0, 10)
  return '기타'
}

const cache = new Map() // keyword -> {at, items}
const TTL = 10 * 60 * 1000
const PER_SOURCE = 6

// 대화체에서 검색어를 오염시키는 말들 — 상품 특징이 아닌 토큰
const TOKEN_STOP = new Set([
  '아니', '아니야', '아니고', '내가', '나는', '난', '제가', '원하는건', '원하는', '원해', '찾는건',
  '그거', '그게', '이거', '저거', '그런', '이런', '근데', '혹시', '좀', '진짜', '완전',
  '중간에', '중간', '가운데', '앞에', '뒤에', '위에', '아래에', '옆에',
  '그려진', '그려져', '그려진거야', '박힌', '박혀있는', '달린', '달려있는', '있는', '있잖아', '들어간',
  '거야', '건데', '인데', '이야', '예요', '이에요', '같은', '느낌', '스타일', '디자인',
  '추천', '추천해줘', '찾아줘', '알려줘', '보여줘', '골라줘', '해줘', '주세요',
  '제일', '가장', '젤', '싼', '저렴한', '비싼', '괜찮은', '좋은', '이쁜', '예쁜',
  '최저가', '시세', '가격', '판매처', '어디가', '어디서', '것', '거', '걸로', '제품', '상품',
  '그냥', '같아', '같은데', '같던데', '있던거', '있던', '봤던', '예전에', '요즘', '한거고', '한거야', '했던',
])
const strip조사 = (w) => w.replace(/(인데|이고|이며|하고|좀|은|는|이|가|을|를|에|의|로|으로|와|과|랑|이나|이든|부터|까지|도)$/, '')

/** 문장을 '상품 특징 토큰'으로 정제한다. */
export function cleanTokens(text) {
  return (text || '')
    .replace(/\d+\s*[~-]?\s*\d*\s*만\s*원?\s*(대|이하|이상|아래|미만|안으로|이내|넘는)?/g, ' ')
    .replace(/[,.!?~"'()]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => {
      const b = strip조사(w)
      // 원형·조사제거형 모두 스톱워드 검사 + "아니야아니야" 류 반복 감탄 제거
      return b.length >= 2 && !TOKEN_STOP.has(w) && !TOKEN_STOP.has(b) && !/^(아니(야|고|지)?)+$/.test(w)
    })
    .map(strip조사)
}

/** (구버전 호환) 문장에서 검색 구절 추출 — cleanTokens 기반. */
export function extractKeyword(text) {
  return cleanTokens(text).slice(0, 5).join(' ')
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

  // 관련도 필터·정렬: 검색어 토큰과 제목의 겹침이 없으면 제외 (쇼핑몰의 느슨한 매칭 차단)
  const kt = cleanTokens(keyword).map(flatten)
  const overlap = (title) => kt.filter((t) => flatten(title).includes(t)).length
  const items = assignGroups(
    raw
      .filter((r) => r.price >= 1000 && !isJunk(flatten(r.rawTitle)) && (kt.length === 0 || overlap(r.rawTitle) >= 1))
      .sort((a, b) => overlap(b.rawTitle) - overlap(a.rawTitle))
      .map((r) => ({
        ...r,
        brand: r.brand || guessBrand(r.rawTitle),
        name: r.rawTitle.slice(0, 70),
        category: categoryFrom(r.rawTitle, keyword),
        catGroup: '라이브',
        model: '',
        condition: 'new',
        verified: false,
        tag: '',
        query: keyword,
        live: true, // 실시간 검색 결과 표시용
      }))
  )
  // 빈 결과를 캐시하면 쇼핑몰이 한 번 429/타임아웃을 낸 순간 그 키워드가
  // 10분간 '결과 없음'으로 굳어 재시도해도 복구되지 않는다. 성공만 캐시한다.
  if (items.length > 0) cache.set(key, { at: Date.now(), items })
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
