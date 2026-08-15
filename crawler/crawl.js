/**
 * 멀티소스 명품 매물/가격 크롤러.
 *
 *  - 번개장터(중고 매물): 공개 검색 엔드포인트. 매물별 시세 분포의 원천.
 *  - 다나와(새상품 가격비교): 검색 결과가 서버렌더링 HTML. 정식 모델명+품번과
 *    "판매처별 최저가"를 제공 → 중고 매물이 새상품 대비 얼마나 싼지 계산하는 기준.
 *
 * 소스 선정 경위: 필웨이(SSR이지만 전부 광고 슬롯), 트렌비/발란/머스트잇/SSG/G마켓/
 * 무신사/29cm/KREAM(차단 또는 SPA) 실측 후 탈락. 검색어를 바꿨을 때 결과가 실제로
 * 달라지는 곳만 채택했다. (README '겪은 어려움' 참고)
 *
 * 1회성 실행 → data/products.json + api/_catalog.js 생성 후 repo에 커밋한다.
 * 실행: npm run crawl
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// 브랜드별 표기 변형(aliases): 판매자들이 축약형을 흔히 쓴다.
const BRANDS = [
  { name: '디올', aliases: ['디올'] },
  { name: '샤넬', aliases: ['샤넬'] },
  { name: '루이비통', aliases: ['루이비통', '루이뷔통'] },
  { name: '구찌', aliases: ['구찌'] },
  { name: '프라다', aliases: ['프라다'] },
  { name: '셀린느', aliases: ['셀린느', '셀린'] },
  { name: '생로랑', aliases: ['생로랑', '입생로랑'] },
  { name: '보테가베네타', aliases: ['보테가'] },
  { name: '버버리', aliases: ['버버리'] },
  { name: '미우미우', aliases: ['미우미우'] },
  { name: '발렌시아가', aliases: ['발렌시아가'] },
  { name: '에르메스', aliases: ['에르메스'] },
  { name: '고야드', aliases: ['고야드'] },
  { name: '코치', aliases: ['코치'] },
  { name: '롱샴', aliases: ['롱샴', '롱샹'] },
]
const ITEMS = ['지갑', '가방']

const PER_QUERY_BUNJANG = 10
const PER_QUERY_DANAWA = 6
const MIN_PRICE = 50_000 // 이하는 부속품·가품·낚시 매물일 확률이 높다
const MAX_PRICE = 40_000_000

// 상품 본체가 아닌 매물. "샤넬 가방" 질문에 7만원짜리 빈 상자가 매칭되는 걸 보고 추가.
// '박스'를 통으로 막으면 "가방 + 박스"(정상)가, '참'을 막으면 '참월렛'이 죽는다 → 합성어만.
const EXCLUDE = [
  '쇼핑백', '종이가방', '자석박스', '가방박스', '박스만', '빈박스', '더스트백',
  '보증서만', '키링', '스티커', '카탈로그', '리폼', '수선', '부자재', '굿즈', '공병',
]
// 타깃과 무관한 브랜드가 섞인 매물(콜라보 사칭·묶음판매) 제외.
const OFF_BRAND = ['아디다스', '나이키', '스투시', '슈프림']

// 앞쪽 규칙이 우선(장지갑이 '지갑'보다 먼저 매칭돼야 함).
const CATEGORY_RULES = [
  ['카드지갑', ['카드지갑', '카드케이스', '카드홀더', '명함지갑', '오거나이저', '카드 홀더']],
  ['반지갑', ['반지갑', '중지갑', '컴팩트월렛', '반지값']],
  ['장지갑', ['장지갑', '집업월렛', '지피월렛', '컨티넨탈', '플랩월렛', '컨티넨털']],
  ['크로스백', ['크로스백', '메신저백', '메신저', '슬링백']],
  ['숄더백', ['숄더백', '호보백', '호보', '체인백', '플랩백', '바게트백', '버킷백']],
  ['토트백', ['토트백', '쇼퍼백', '쇼퍼', '브리프케이스', '북토트']],
  ['클러치', ['클러치', '파우치', '포쉐트']],
  ['백팩', ['백팩', '배낭']],
]

// 같은 모델끼리 묶어 시세를 계산하기 위한 라인 키워드.
const MODEL_KEYWORDS = [
  // 디올
  '레이디디올', '새들백', '새들', '북토트', '몽테뉴', '오블리크', '까나쥬', '트로터',
  // 샤넬
  '클래식', '보이샤넬', '보이', '가브리엘', '19백', '까멜리아', '마트라세', '마테라세',
  '캐비어', '코코핸들', '위켄들리',
  // 루이비통
  '모노그램', '다미에', '앙프렁트', '에삐', '알마', '스피디', '네버풀', '포쉐트메티스',
  '지피월렛', '멀티플',
  // 구찌
  '마몬트', '마르몬트', '디오니서스', '오피디아', '홀스빗', '재키', '뱀부', '소호',
  // 프라다
  '사피아노', '트라이앵글', '리나일론', '리에디션', '클레오', '갤러리아',
  // 셀린느
  '트리옹프', '트리오페', '아바', '카바', '벨트백',
  // 생로랑
  '루루', '케이트', '니키', '엔벨로프', '카산드라',
  // 보테가베네타
  '인트레치아토', '카세트', '조디', '아르코',
  // 버버리
  '빈티지체크', '노바체크', '로라',
  // 발렌시아가
  '아워글라스', '시티백',
  // 에르메스
  '버킨', '켈리', '피코탄', '가든파티', '에블린', '콘스탄스', '베안', '도곤',
  // 고야드
  '생루이', '앙주', '아르투아', '마티뇽',
  // 코치
  '태비', '윌로우',
  // 롱샴
  '르플리아쥬', '플리아쥬',
]

const flatten = (s) => (s || '').replace(/\s+/g, '')

function detectCategory(text) {
  const flat = flatten(text)
  for (const [label, keywords] of CATEGORY_RULES) {
    if (keywords.some((k) => flat.includes(flatten(k)))) return label
  }
  if (flat.includes('지갑') || flat.includes('월렛')) return '장지갑'
  if (flat.includes('백') || flat.includes('가방')) return '숄더백'
  return '기타'
}

const detectModel = (text) =>
  MODEL_KEYWORDS.find((k) => flatten(text).includes(flatten(k))) || ''

/** 제목이 이 브랜드 매물이 맞는지 + 오염 매물이 아닌지 공통 검사. */
function acceptable(rawTitle, price, brand) {
  if (!rawTitle || !price || price < MIN_PRICE || price > MAX_PRICE) return false
  const flat = flatten(rawTitle)
  if (!brand.aliases.some((a) => flat.includes(flatten(a)))) return false
  if (EXCLUDE.some((k) => flat.includes(k))) return false
  if (OFF_BRAND.some((b) => flat.includes(b))) return false
  return true
}

/* ---------------- 소스 1: 번개장터 (중고) ---------------- */
async function crawlBunjang(brand, item) {
  const q = `${brand.name} ${item}`
  const url = `https://api.bunjang.co.kr/api/1/find_v2.json?q=${encodeURIComponent(q)}&order=score&page=0&n=40&stat_device=w`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`bunjang HTTP ${res.status}`)
  const { list = [] } = await res.json()

  const items = []
  for (const raw of list) {
    if (items.length >= PER_QUERY_BUNJANG) break
    const rawTitle = (raw.name || '').replace(/\s+/g, ' ').trim()
    const price = Number(raw.price)
    if (raw.ad || !acceptable(rawTitle, price, brand)) continue

    const searchText = `${rawTitle} ${raw.tag || ''}` // 판매자 태그가 모델/종류 추출 정확도를 올린다
    items.push({
      id: `b${raw.pid}`,
      brand: brand.name,
      name: rawTitle.slice(0, 70),
      category: detectCategory(searchText),
      model: detectModel(searchText),
      price,
      seller: '번개장터',
      condition: 'used',
      location: raw.location || '',
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

/* ---------------- 소스 2: 다나와 (새상품 가격비교) ---------------- */
// 서버렌더링 HTML을 prod_item 블록 단위로 잘라 정규식으로 파싱한다.
// ponytail: 클래스명(prod_name/price_sect) 기반 정규식 — 구조가 바뀌면 재수집 시 파서 수정 필요.
async function crawlDanawa(brand, item) {
  const q = `${brand.name} ${item}`
  const url = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`danawa HTTP ${res.status}`)
  const html = await res.text()

  const items = []
  for (const block of html.split(/class="prod_item/).slice(1)) {
    if (items.length >= PER_QUERY_DANAWA) break
    const nameM = block.match(/class="prod_name"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s)
    const priceM = block.match(/price_sect[^>]*>[\s\S]*?<strong>([\d,]+)<\/strong>/)
    if (!nameM || !priceM) continue

    const rawTitle = nameM[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const price = Number(priceM[1].replace(/,/g, ''))
    if (!acceptable(rawTitle, price, brand)) continue

    const imgM = block.match(/<img[^>]+(?:data-original|src)="([^"]+)"/)
    const image = imgM ? (imgM[1].startsWith('//') ? 'https:' + imgM[1] : imgM[1]) : ''
    const pcode = (nameM[1].match(/pcode=(\d+)/) || [])[1]
    if (!pcode) continue

    // spec_list(예: "숄더백")가 있으면 종류 추출에 같이 쓴다
    const specM = block.match(/class="spec_list"[^>]*>([\s\S]*?)<\/div>/)
    const spec = specM ? specM[1].replace(/<[^>]+>/g, ' ') : ''

    items.push({
      id: `d${pcode}`,
      brand: brand.name,
      name: rawTitle.slice(0, 70),
      category: detectCategory(`${rawTitle} ${spec}`),
      model: detectModel(rawTitle),
      price, // 다나와가 집계한 판매처 최저가
      seller: '다나와 최저가',
      condition: 'new',
      location: '',
      verified: false,
      url: `https://prod.danawa.com/info/?pcode=${pcode}`, // 판매처별 가격비교 페이지
      image,
      rawTitle,
      tag: '',
      query: q,
    })
  }
  return items
}

/* ---------------- 실행 ---------------- */
const all = []
for (const brand of BRANDS) {
  for (const item of ITEMS) {
    for (const [label, fn] of [['번개장터', crawlBunjang], ['다나와', crawlDanawa]]) {
      try {
        const items = await fn(brand, item)
        all.push(...items)
        console.log(`✓ ${label} ${brand.name} ${item}: ${items.length}개`)
      } catch (err) {
        console.warn(`✗ ${label} ${brand.name} ${item}: ${err.message}`) // 한 쿼리 실패로 전체를 멈추지 않는다
      }
      await new Promise((r) => setTimeout(r, 400)) // 상대 서버 배려
    }
  }
}

// 같은 매물이 여러 검색어에 걸릴 수 있어 id 기준 중복 제거.
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

const used = products.filter((p) => p.condition === 'used').length
const groups = new Map()
for (const p of products) groups.set(p.modelGroup, (groups.get(p.modelGroup) || 0) + 1)
const comparable = [...groups.values()].filter((n) => n >= 2).length
const crossGroups = new Set(
  products.filter((p) => p.condition === 'new').map((p) => p.modelGroup)
)
const crossable = products.filter((p) => p.condition === 'used' && crossGroups.has(p.modelGroup)).length

console.log(
  `\n총 ${products.length}개 (중고 ${used} / 새상품 ${products.length - used}) / 모델그룹 ${groups.size}개` +
    `\n  - 매물 2개 이상 → 시세 비교 가능한 그룹: ${comparable}개` +
    `\n  - 같은 그룹에 새상품가가 있어 '새상품 대비 N%' 계산 가능한 중고 매물: ${crossable}개`
)
console.log('→ data/products.json, api/_catalog.js 생성 완료')
