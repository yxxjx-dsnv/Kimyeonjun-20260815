/**
 * 멀티소스 상품 크롤러 — 5개 쇼핑몰.
 *
 *  [명품]  번개장터(중고 매물) + 다나와(새상품 판매처별 최저가)
 *  [패션]  29CM + 무신사 (새상품, 브랜드·리뷰 평점 포함)
 *  [뷰티·생활] 컬리 + 다나와 (새상품)
 *
 * 소스 선정 원칙: 파서를 쓰기 전에 curl로 실측하고, "검색어를 바꾸면 결과가
 * 실제로 달라지는지"를 확인한 곳만 채택한다. 실측 총 20곳 중 5곳 통과.
 * (필웨이=광고슬롯, 네이버/eBay/SSG/G마켓/올리브영=403, 트렌비/발란/머스트잇/
 *  KREAM/에누리/W컨셉/헬로마켓/중고나라/11번가=SPA 또는 오류)
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
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/html' }

/* ================= 명품 세트 ================= */

const LUXURY_BRANDS = [
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
const LUXURY_ITEMS = ['지갑', '가방']
const PER_BUNJANG = 10
const PER_DANAWA_LUX = 6
const LUX_MIN = 50_000
const LUX_MAX = 40_000_000

/* ================= 일반 세트 (패션·뷰티·생활) ================= */
// category는 검색어에서 확정되므로 추출이 아니라 지정한다.
const GENERAL_QUERIES = [
  // 패션 — 29CM + 무신사
  { q: '원피스', cat: '원피스', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '니트', cat: '니트', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '가디건', cat: '가디건', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '청바지', cat: '청바지', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '슬랙스', cat: '슬랙스', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '자켓', cat: '자켓', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '셔츠', cat: '셔츠', group: '패션', srcs: ['cm29', 'musinsa'] },
  { q: '맨투맨', cat: '맨투맨', group: '패션', srcs: ['cm29', 'musinsa'] },
  // 뷰티 — 컬리 + 다나와
  { q: '수분크림', cat: '수분크림', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '선크림', cat: '선크림', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '쿠션 파운데이션', cat: '쿠션', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '립스틱', cat: '립스틱', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '토너', cat: '토너', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '세럼', cat: '세럼', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '클렌징폼', cat: '클렌징폼', group: '뷰티', srcs: ['kurly', 'danawa'] },
  { q: '샴푸', cat: '샴푸', group: '뷰티', srcs: ['kurly', 'danawa'] },
  // 생활 — 컬리 + 다나와
  { q: '물티슈', cat: '물티슈', group: '생활', srcs: ['kurly', 'danawa'] },
  { q: '텀블러', cat: '텀블러', group: '생활', srcs: ['kurly', 'danawa'] },
]
const PER_GENERAL = 8
const GEN_MIN = 3_000
const GEN_MAX = 2_000_000

/* ================= 공통 유틸 ================= */

// 상품 본체가 아닌 매물 차단. '박스'를 통으로 막으면 "가방 + 박스"가,
// '참'을 막으면 '참월렛'이 죽는다 → 합성어 단위로만.
const EXCLUDE = [
  '쇼핑백', '종이가방', '자석박스', '가방박스', '박스만', '빈박스', '더스트백',
  '보증서만', '키링', '스티커', '카탈로그', '리폼', '수선', '부자재', '굿즈', '공병',
]
const OFF_BRAND = ['아디다스', '나이키', '스투시', '슈프림'] // 명품 검색 결과의 콜라보 사칭·묶음

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

const MODEL_KEYWORDS = [
  '레이디디올', '새들백', '새들', '북토트', '몽테뉴', '오블리크', '까나쥬', '트로터',
  '클래식', '보이샤넬', '보이', '가브리엘', '19백', '까멜리아', '마트라세', '마테라세',
  '캐비어', '코코핸들', '위켄들리',
  '모노그램', '다미에', '앙프렁트', '에삐', '알마', '스피디', '네버풀', '포쉐트메티스',
  '지피월렛', '멀티플',
  '마몬트', '마르몬트', '디오니서스', '오피디아', '홀스빗', '재키', '뱀부', '소호',
  '사피아노', '트라이앵글', '리나일론', '리에디션', '클레오', '갤러리아',
  '트리옹프', '트리오페', '아바', '카바', '벨트백',
  '루루', '케이트', '니키', '엔벨로프', '카산드라',
  '인트레치아토', '카세트', '조디', '아르코',
  '빈티지체크', '노바체크', '로라',
  '아워글라스', '시티백',
  '버킨', '켈리', '피코탄', '가든파티', '에블린', '콘스탄스', '베안', '도곤',
  '생루이', '앙주', '아르투아', '마티뇽',
  '태비', '윌로우',
  '르플리아쥬', '플리아쥬',
]

const flatten = (s) => (s || '').replace(/\s+/g, '')
const cleanTitle = (s) => (s || '').replace(/\s+/g, ' ').trim()

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

const isJunk = (flat) => EXCLUDE.some((k) => flat.includes(k))

/** 일반 상품 제목에서 브랜드 추정: "[일리윤] ..." 또는 첫 토큰. */
function guessBrand(title) {
  const bracket = title.match(/^[[(【]([^\])】]{1,14})[\])】]/)
  if (bracket) return bracket[1].trim()
  const first = title.split(' ')[0].replace(/[^\p{L}\p{N}]/gu, '')
  return first.length >= 2 && first.length <= 12 ? first : '기타'
}

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/* ================= 명품 소스 ================= */

async function bunjangLuxury(brand, item) {
  const q = `${brand.name} ${item}`
  const d = await getJSON(
    `https://api.bunjang.co.kr/api/1/find_v2.json?q=${encodeURIComponent(q)}&order=score&page=0&n=40&stat_device=w`
  )
  const out = []
  for (const raw of d.list || []) {
    if (out.length >= PER_BUNJANG) break
    const rawTitle = cleanTitle(raw.name)
    const price = Number(raw.price)
    const flat = flatten(rawTitle)
    if (raw.ad || !rawTitle || !price || price < LUX_MIN || price > LUX_MAX) continue
    if (!brand.aliases.some((a) => flat.includes(flatten(a)))) continue
    if (isJunk(flat) || OFF_BRAND.some((b) => flat.includes(b))) continue

    const searchText = `${rawTitle} ${raw.tag || ''}`
    out.push({
      id: `b${raw.pid}`,
      brand: brand.name,
      name: rawTitle.slice(0, 70),
      category: detectCategory(searchText),
      catGroup: '명품',
      model: detectModel(searchText),
      price,
      seller: '번개장터',
      condition: 'used',
      verified: raw.name_prefix === '검수가능' || raw.inspection === 'OPT_IN',
      rating: null,
      reviewCount: null,
      url: `https://m.bunjang.co.kr/products/${raw.pid}`,
      image: (raw.product_image || '').replace('{res}', '400'),
      rawTitle,
      tag: raw.tag || '',
      query: q,
    })
  }
  return out
}

/** 다나와 통합검색 SSR HTML → prod_item 블록 정규식 파싱 (사전 실측 완료). */
async function danawaSearch(q, limit) {
  const res = await fetch(`https://search.danawa.com/dsearch.php?query=${encodeURIComponent(q)}`, {
    headers: HEADERS,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const out = []
  for (const block of html.split(/class="prod_item/).slice(1)) {
    if (out.length >= limit) break
    const nameM = block.match(/class="prod_name"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s)
    const priceM = block.match(/price_sect[^>]*>[\s\S]*?<strong>([\d,]+)<\/strong>/)
    if (!nameM || !priceM) continue
    const rawTitle = cleanTitle(nameM[2].replace(/<[^>]+>/g, ''))
    const price = Number(priceM[1].replace(/,/g, ''))
    const pcode = (nameM[1].match(/pcode=(\d+)/) || [])[1]
    if (!rawTitle || !price || !pcode) continue
    const imgM = block.match(/<img[^>]+(?:data-original|src)="([^"]+)"/)
    const specM = block.match(/class="spec_list"[^>]*>([\s\S]*?)<\/div>/)
    out.push({
      pcode,
      rawTitle,
      price,
      image: imgM ? (imgM[1].startsWith('//') ? 'https:' + imgM[1] : imgM[1]) : '',
      spec: specM ? specM[1].replace(/<[^>]+>/g, ' ') : '',
    })
  }
  return out
}

async function danawaLuxury(brand, item) {
  const q = `${brand.name} ${item}`
  const rows = await danawaSearch(q, 30)
  const out = []
  for (const r of rows) {
    if (out.length >= PER_DANAWA_LUX) break
    const flat = flatten(r.rawTitle)
    if (r.price < LUX_MIN || r.price > LUX_MAX) continue
    if (!brand.aliases.some((a) => flat.includes(flatten(a)))) continue
    if (isJunk(flat) || OFF_BRAND.some((b) => flat.includes(b))) continue
    out.push({
      id: `d${r.pcode}`,
      brand: brand.name,
      name: r.rawTitle.slice(0, 70),
      category: detectCategory(`${r.rawTitle} ${r.spec}`),
      catGroup: '명품',
      model: detectModel(r.rawTitle),
      price: r.price,
      seller: '다나와 최저가',
      condition: 'new',
      verified: false,
      rating: null,
      reviewCount: null,
      url: `https://prod.danawa.com/info/?pcode=${r.pcode}`,
      image: r.image,
      rawTitle: r.rawTitle,
      tag: '',
      query: q,
    })
  }
  return out
}

/* ================= 일반 소스 ================= */

const GENERAL_SOURCES = {
  async cm29({ q, cat, group }) {
    const d = await getJSON(
      `https://search-api.29cm.co.kr/api/v4/products/search?keyword=${encodeURIComponent(q)}&page=0&size=30`
    )
    return (d.data?.products || [])
      .filter((p) => !p.isSoldOut)
      .slice(0, PER_GENERAL)
      .map((p) => ({
        id: `t${p.itemNo}`,
        brand: cleanTitle(p.frontBrandNameKor) || '기타',
        name: cleanTitle(p.itemName).slice(0, 70),
        category: cat,
        catGroup: group,
        model: '',
        price: Number(p.lastSalePrice || p.consumerPrice),
        seller: '29CM',
        condition: 'new',
        verified: false,
        rating: p.reviewAveragePoint ? Number(p.reviewAveragePoint) : null,
        reviewCount: p.reviewCount ? Number(p.reviewCount) : null,
        url: `https://product.29cm.co.kr/catalog/${p.itemNo}`,
        image: p.imageUrl?.startsWith('http') ? p.imageUrl : `https://img.29cm.co.kr${p.imageUrl || ''}`,
        rawTitle: cleanTitle(p.itemName),
        tag: '',
        query: q,
      }))
  },

  async musinsa({ q, cat, group }) {
    const d = await getJSON(
      `https://api.musinsa.com/api2/dp/v1/plp/goods?gf=A&keyword=${encodeURIComponent(q)}&sortCode=POPULAR&page=1&size=30&caller=SEARCH`
    )
    return (d.data?.list || [])
      .filter((p) => !p.isAd && !p.isSoldOut && !p.usedConditionGrade) // 광고·품절·유즈드 제외
      .slice(0, PER_GENERAL)
      .map((p) => ({
        id: `m${p.goodsNo}`,
        brand: cleanTitle(p.brandName) || '기타',
        name: cleanTitle(p.goodsName).slice(0, 70),
        category: cat,
        catGroup: group,
        model: '',
        price: Number(p.price || p.finalPrice || p.normalPrice),
        seller: '무신사',
        condition: 'new',
        verified: false,
        rating: p.reviewScore ? Number(p.reviewScore) : null,
        reviewCount: p.reviewCount ? Number(p.reviewCount) : null,
        url: p.goodsLinkUrl || `https://www.musinsa.com/products/${p.goodsNo}`,
        image: p.thumbnail?.startsWith('http') ? p.thumbnail : `https:${p.thumbnail || ''}`,
        rawTitle: cleanTitle(p.goodsName),
        tag: '',
        query: q,
      }))
  },

  async kurly({ q, cat, group }) {
    const d = await getJSON(
      `https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${encodeURIComponent(q)}&page=1`
    )
    // 상품 리스트는 listSections[*].data.items 에 들어 있다
    const items = (d.data?.listSections || []).flatMap((s) => s.data?.items || [])
    return items
      .filter((p) => p.name && (p.salesPrice || p.discountedPrice) && !p.isSoldOut)
      .slice(0, PER_GENERAL)
      .map((p) => {
        const rawTitle = cleanTitle(p.name)
        return {
          id: `k${p.no || p.productNo || p.id}`,
          brand: guessBrand(rawTitle),
          name: rawTitle.slice(0, 70),
          category: cat,
          catGroup: group,
          model: '',
          price: Number(p.discountedPrice || p.salesPrice),
          seller: '컬리',
          condition: 'new',
          verified: false,
          rating: null,
          reviewCount: p.reviewCount ? Number(String(p.reviewCount).replace(/\D/g, '')) : null,
          url: `https://www.kurly.com/goods/${p.no || p.productNo || p.id}`,
          image: p.listImageUrl || p.imageUrl || '',
          rawTitle,
          tag: '',
          query: q,
        }
      })
  },

  async danawa({ q, cat, group }) {
    const rows = await danawaSearch(q, 20)
    return rows.slice(0, PER_GENERAL).map((r) => ({
      id: `d${r.pcode}`,
      brand: guessBrand(r.rawTitle),
      name: r.rawTitle.slice(0, 70),
      category: cat,
      catGroup: group,
      model: '',
      price: r.price,
      seller: '다나와 최저가',
      condition: 'new',
      verified: false,
      rating: null,
      reviewCount: null,
      url: `https://prod.danawa.com/info/?pcode=${r.pcode}`,
      image: r.image,
      rawTitle: r.rawTitle,
      tag: '',
      query: q,
    }))
  },
}

/* ================= 실행 ================= */

const all = []
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) 명품
for (const brand of LUXURY_BRANDS) {
  for (const item of LUXURY_ITEMS) {
    for (const [label, fn] of [['번개장터', bunjangLuxury], ['다나와', danawaLuxury]]) {
      try {
        const items = await fn(brand, item)
        all.push(...items)
        console.log(`✓ [명품] ${label} ${brand.name} ${item}: ${items.length}개`)
      } catch (err) {
        console.warn(`✗ [명품] ${label} ${brand.name} ${item}: ${err.message}`)
      }
      await pause(350)
    }
  }
}

// 2) 일반 (패션·뷰티·생활)
for (const gq of GENERAL_QUERIES) {
  for (const src of gq.srcs) {
    try {
      const items = (await GENERAL_SOURCES[src](gq)).filter(
        (p) => p.price >= GEN_MIN && p.price <= GEN_MAX && !isJunk(flatten(p.rawTitle))
      )
      all.push(...items)
      console.log(`✓ [${gq.group}] ${src} ${gq.q}: ${items.length}개`)
    } catch (err) {
      console.warn(`✗ [${gq.group}] ${src} ${gq.q}: ${err.message}`)
    }
    await pause(350)
  }
}

// id 기준 중복 제거 후 모델 그룹 부여.
const products = [...new Map(all.map((p) => [p.id, p])).values()]
for (const p of products) {
  // 명품은 브랜드|종류|모델, 일반은 브랜드|종류 — 소스가 달라도 같은 그룹이면 가격 비교된다.
  p.modelGroup = `${flatten(p.brand)}|${p.category}${p.model ? `|${p.model}` : ''}`
}

mkdirSync(join(ROOT, 'data'), { recursive: true })
writeFileSync(join(ROOT, 'data', 'products.json'), JSON.stringify(products, null, 2))
writeFileSync(
  join(ROOT, 'api', '_catalog.js'),
  `// 자동 생성 파일 — 직접 수정하지 말 것. \`npm run crawl\`로 재생성됨.\nexport default ${JSON.stringify(products)}\n`
)

const bySeller = {}
const byGroup = {}
for (const p of products) {
  bySeller[p.seller] = (bySeller[p.seller] || 0) + 1
  byGroup[p.catGroup] = (byGroup[p.catGroup] || 0) + 1
}
const groups = new Map()
for (const p of products) groups.set(p.modelGroup, (groups.get(p.modelGroup) || 0) + 1)
const comparable = [...groups.values()].filter((n) => n >= 2).length
const crossSeller = [...groups.keys()].filter(
  (g) => new Set(products.filter((p) => p.modelGroup === g).map((p) => p.seller)).size >= 2
).length

console.log(`\n총 ${products.length}개`)
console.log('  판매처:', Object.entries(bySeller).map(([k, v]) => `${k} ${v}`).join(' / '))
console.log('  카테고리:', Object.entries(byGroup).map(([k, v]) => `${k} ${v}`).join(' / '))
console.log(`  비교 가능 그룹 ${comparable}개 / 서로 다른 판매처가 섞인 그룹 ${crossSeller}개`)
console.log('→ data/products.json, api/_catalog.js 생성 완료')
