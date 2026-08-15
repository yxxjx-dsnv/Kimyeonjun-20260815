/**
 * 번개장터 중고 명품 매물 크롤러.
 *
 * 원래 타깃은 필웨이(중고명품 마켓) HTML이었으나, 검색 결과 페이지가
 * 서버렌더링하는 100개 아이템이 전부 광고 슬롯(goodsStatus=AD)이라
 * 검색어와 무관하게 동일했다. 트렌비/머스트잇/발란도 SPA 또는 차단.
 * → 실제 검색어가 반영되는 번개장터 공개 검색 엔드포인트로 전환.
 *   (자세한 경위는 README '겪은 어려움' 참고)
 *
 * 1회성 실행 → data/products.json + api/_catalog.js 생성 후 repo에 커밋한다.
 * 실행: npm run crawl
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://api.bunjang.co.kr/api/1/find_v2.json'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const QUERIES = [
  { q: '디올 지갑', brand: '디올' },
  { q: '디올 가방', brand: '디올' },
  { q: '샤넬 지갑', brand: '샤넬' },
  { q: '샤넬 가방', brand: '샤넬' },
  { q: '루이비통 지갑', brand: '루이비통' },
  { q: '루이비통 가방', brand: '루이비통' },
  { q: '구찌 지갑', brand: '구찌' },
  { q: '구찌 가방', brand: '구찌' },
]
const PER_QUERY = 15
const MIN_PRICE = 50_000 // 이하는 부속품·가품·낚시 매물일 확률이 높다
const MAX_PRICE = 30_000_000

// 앞쪽 규칙이 우선(장지갑이 '지갑'보다 먼저 매칭돼야 함).
const CATEGORY_RULES = [
  ['카드지갑', ['카드지갑', '카드케이스', '카드홀더', '명함지갑', '오거나이저']],
  ['반지갑', ['반지갑', '중지갑', '컴팩트월렛', '반지값']],
  ['장지갑', ['장지갑', '집업월렛', '지피월렛', '컨티넨탈', '플랩월렛']],
  ['크로스백', ['크로스백', '메신저백', '메신저', '슬링백']],
  ['숄더백', ['숄더백', '호보백', '호보', '체인백', '플랩백', '바게트백']],
  ['토트백', ['토트백', '쇼퍼백', '쇼퍼', '브리프케이스', '북토트']],
  ['클러치', ['클러치', '파우치', '포쉐트']],
  ['백팩', ['백팩', '배낭', '백팩']],
]

// 같은 모델끼리 묶어 시세를 계산하기 위한 라인 키워드.
const MODEL_KEYWORDS = [
  '레이디디올', '새들백', '새들', '북토트', '몽테뉴', '오블리크', '까나쥬', '트로터',
  '클래식', '보이샤넬', '보이', '가브리엘', '19백', '까멜리아', '마트라세', '캐비어', '코코핸들', '위켄들리',
  '모노그램', '다미에', '앙프렁트', '에삐', '알마', '스피디', '네버풀', '포쉐트메티스', '지피월렛', '멀티플',
  '마몬트', '마르몬트', '디오니서스', '오피디아', '홀스빗', '재키', '뱀부', '소호',
]

const flatten = (s) => (s || '').replace(/\s+/g, '')

function detect(rules, text) {
  const flat = flatten(text)
  for (const [label, keywords] of rules) {
    if (keywords.some((k) => flat.includes(flatten(k)))) return label
  }
  return ''
}

function detectCategory(text) {
  const found = detect(CATEGORY_RULES, text)
  if (found) return found
  const flat = flatten(text)
  if (flat.includes('지갑') || flat.includes('월렛')) return '장지갑'
  if (flat.includes('백') || flat.includes('가방')) return '숄더백'
  return '기타'
}

const detectModel = (text) =>
  MODEL_KEYWORDS.find((k) => flatten(text).includes(flatten(k))) || ''

async function crawlQuery({ q, brand }) {
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&order=score&page=0&n=40&stat_device=w`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { list = [] } = await res.json()

  const items = []
  for (const raw of list) {
    if (items.length >= PER_QUERY) break
    const rawTitle = (raw.name || '').replace(/\s+/g, ' ').trim()
    const price = Number(raw.price)
    // 광고·가격이상·브랜드 불일치 매물은 버린다
    if (raw.ad || !rawTitle || !price || price < MIN_PRICE || price > MAX_PRICE) continue
    if (!flatten(rawTitle).includes(flatten(brand))) continue

    // 상품명 + 판매자 태그를 합쳐야 모델/종류 추출 정확도가 올라간다
    const searchText = `${rawTitle} ${raw.tag || ''}`

    items.push({
      id: String(raw.pid),
      brand,
      name: rawTitle.slice(0, 70),
      category: detectCategory(searchText),
      model: detectModel(searchText),
      price,
      seller: '번개장터',
      location: raw.location || '',
      // 검수 가능 매물은 '정품 확신' 페인포인트와 직결되므로 따로 보관
      verified: raw.name_prefix === '검수가능' || raw.inspection === 'OPT_IN',
      url: `https://m.bunjang.co.kr/products/${raw.pid}`,
      image: (raw.product_image || '').replace('{res}', '400'),
      rawTitle,
      tag: raw.tag || '',
      query: q,
    })
  }
  return items
}

const all = []
for (const target of QUERIES) {
  try {
    const items = await crawlQuery(target)
    all.push(...items)
    console.log(`✓ ${target.q}: ${items.length}개`)
  } catch (err) {
    console.warn(`✗ ${target.q}: ${err.message}`) // 한 쿼리 실패로 전체를 멈추지 않는다
  }
  await new Promise((r) => setTimeout(r, 600)) // 상대 서버 배려
}

// 같은 매물이 여러 검색어에 걸릴 수 있어 pid 기준 중복 제거.
const products = [...new Map(all.map((p) => [p.id, p])).values()]
// 모델을 못 뽑은 매물은 브랜드+종류로만 묶는다 → 그래도 시세 비교군은 생긴다.
for (const p of products) p.modelGroup = `${p.brand}|${p.category}${p.model ? `|${p.model}` : ''}`

mkdirSync(join(ROOT, 'data'), { recursive: true })
writeFileSync(join(ROOT, 'data', 'products.json'), JSON.stringify(products, null, 2))
// 서버리스 함수가 번들러 설정 없이 확실히 읽도록 JS 모듈로도 내보낸다.
writeFileSync(
  join(ROOT, 'api', '_catalog.js'),
  `// 자동 생성 파일 — 직접 수정하지 말 것. \`npm run crawl\`로 재생성됨.\nexport default ${JSON.stringify(products)}\n`
)

const groups = new Map()
for (const p of products) groups.set(p.modelGroup, (groups.get(p.modelGroup) || 0) + 1)
const comparable = [...groups.values()].filter((n) => n >= 2).length
console.log(
  `\n총 ${products.length}개 / 모델그룹 ${groups.size}개 (매물 2개 이상이라 시세 비교 가능한 그룹: ${comparable}개)`
)
console.log('→ data/products.json, api/_catalog.js 생성 완료')
