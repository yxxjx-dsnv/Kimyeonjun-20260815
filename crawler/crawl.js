/**
 * 새상품 전용 멀티소스 크롤러 — 4개 쇼핑몰 × 7개 카테고리군.
 *
 *  다나와  : 명품·가전·생활 (판매처별 최저가 집계, SSR HTML)
 *  29CM   : 패션·리빙 (검색 API)
 *  무신사  : 패션 (검색 API, caller=SEARCH 필수)
 *  컬리    : 뷰티·생활·식품 (검색 API)
 *
 * 소스 선정 원칙: 파서를 쓰기 전에 curl로 실측하고, "검색어를 바꾸면 결과가
 * 실제로 달라지는지"를 확인한 곳만 채택 (총 20곳 실측, 상세는 README).
 * 같은 검색 파서를 서버 라이브 검색(api/_live.js)에서도 재사용한다 —
 * 이 크롤은 '기본 카탈로그(시세 계산의 기준)'를 만드는 1회성 실행이다.
 *
 * 실행: npm run crawl  →  data/products.json + api/_catalog.js
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { danawaSearch, cm29Search, musinsaSearch, kurlySearch, guessBrand, isJunk, flatten } from '../api/_sources.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ================= 명품 (다나와 새상품) ================= */
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
const PER_LUX = 8
const LUX_MIN = 100_000
const LUX_MAX = 40_000_000
const OFF_BRAND = ['아디다스', '나이키', '스투시', '슈프림'] // 명품 검색 결과의 콜라보 사칭·묶음

/* ================= 일반 (새상품) ================= */
const G = (q, cat, group, srcs, per = 8) => ({ q, cat, group, srcs, per })
const GENERAL_QUERIES = [
  ...['원피스', '니트', '가디건', '청바지', '슬랙스', '자켓', '코트', '셔츠', '블라우스', '스커트', '맨투맨', '후드티'].map(
    (q) => G(q, q, '패션', ['cm29', 'musinsa'])
  ),
  G('운동화', '운동화', '패션', ['musinsa', 'cm29']),
  G('로퍼', '로퍼', '패션', ['musinsa', 'cm29']),
  ...['수분크림', '선크림', '립스틱', '토너', '세럼', '클렌징폼', '샴푸', '트리트먼트', '바디로션', '핸드크림', '마스크팩', '아이크림'].map(
    (q) => G(q, q, '뷰티', ['kurly', 'danawa'])
  ),
  G('쿠션 파운데이션', '쿠션', '뷰티', ['kurly', 'danawa']),
  G('향수', '향수', '뷰티', ['danawa', 'cm29']),
  ...['물티슈', '텀블러', '주방세제', '세탁세제', '휴지', '프라이팬', '밀폐용기', '수세미'].map(
    (q) => G(q, q, '생활·주방', ['kurly', 'danawa'])
  ),
  ...['무선청소기', '에어프라이어', '공기청정기', '전기포트', '헤어드라이어', '가습기', '로봇청소기', '믹서기'].map(
    (q) => G(q, q, '가전', ['danawa'], 10)
  ),
  ...['홍차', '커피 원두', '그래놀라', '올리브유', '견과류'].map((q) => G(q, q.replace(' ', ''), '식품', ['kurly'])),
]
const GEN_MIN = 2_000
const GEN_MAX = 3_000_000

/* ================= 명품 속성 규칙 ================= */
const CATEGORY_RULES = [
  ['카드지갑', ['카드지갑', '카드케이스', '카드홀더', '명함지갑', '오거나이저', '카드 홀더']],
  ['반지갑', ['반지갑', '중지갑', '컴팩트월렛']],
  ['장지갑', ['장지갑', '집업월렛', '지피월렛', '컨티넨탈', '플랩월렛', '컨티넨털']],
  ['크로스백', ['크로스백', '메신저백', '슬링백']],
  ['숄더백', ['숄더백', '호보백', '체인백', '플랩백', '버킷백']],
  ['토트백', ['토트백', '쇼퍼백', '북토트']],
  ['클러치', ['클러치', '파우치', '포쉐트']],
  ['백팩', ['백팩', '배낭']],
]
const MODEL_KEYWORDS = [
  '레이디디올', '새들백', '새들', '북토트', '몽테뉴', '오블리크', '까나쥬', '트로터',
  '클래식', '보이', '가브리엘', '19백', '까멜리아', '마트라세', '마테라세', '캐비어', '코코핸들',
  '모노그램', '다미에', '앙프렁트', '에삐', '알마', '스피디', '네버풀', '포쉐트메티스', '지피월렛', '멀티플',
  '마몬트', '마르몬트', '디오니서스', '오피디아', '홀스빗', '재키', '뱀부', '소호',
  '사피아노', '트라이앵글', '리나일론', '리에디션', '클레오', '갤러리아',
  '트리옹프', '트리오페', '카바',
  '루루', '케이트', '니키', '엔벨로프', '카산드라',
  '인트레치아토', '카세트', '조디', '아르코',
  '빈티지체크', '노바체크',
  '아워글라스', '시티백',
  '버킨', '켈리', '피코탄', '가든파티', '에블린', '콘스탄스', '베안',
  '생루이', '앙주', '아르투아', '마티뇽',
  '태비', '윌로우', '르플리아쥬', '플리아쥬',
]

function detectCategory(text) {
  const flat = flatten(text)
  for (const [label, keywords] of CATEGORY_RULES) {
    if (keywords.some((k) => flat.includes(flatten(k)))) return label
  }
  if (flat.includes('지갑') || flat.includes('월렛')) return '장지갑'
  if (flat.includes('백') || flat.includes('가방')) return '숄더백'
  return '기타'
}
const detectModel = (text) => MODEL_KEYWORDS.find((k) => flatten(text).includes(flatten(k))) || ''

const SEARCHERS = { danawa: danawaSearch, cm29: cm29Search, musinsa: musinsaSearch, kurly: kurlySearch }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/* ================= 실행 ================= */
const all = []

// 1) 명품 — 다나와 (새상품 판매처별 최저가)
for (const brand of LUXURY_BRANDS) {
  for (const item of LUXURY_ITEMS) {
    const q = `${brand.name} ${item}`
    try {
      const rows = await danawaSearch(q, 30)
      const kept = []
      for (const r of rows) {
        if (kept.length >= PER_LUX) break
        const flat = flatten(r.rawTitle)
        if (r.price < LUX_MIN || r.price > LUX_MAX) continue
        if (!brand.aliases.some((a) => flat.includes(flatten(a)))) continue
        if (isJunk(flat) || OFF_BRAND.some((b) => flat.includes(b))) continue
        kept.push({
          ...r,
          brand: brand.name,
          name: r.rawTitle.slice(0, 70),
          category: detectCategory(r.rawTitle),
          catGroup: '명품',
          model: detectModel(r.rawTitle),
          condition: 'new',
          verified: false,
          tag: '',
          query: q,
        })
      }
      all.push(...kept)
      console.log(`✓ [명품] 다나와 ${q}: ${kept.length}개`)
    } catch (err) {
      console.warn(`✗ [명품] 다나와 ${q}: ${err.message}`)
    }
    await pause(300)
  }
}

// 2) 일반
for (const gq of GENERAL_QUERIES) {
  for (const src of gq.srcs) {
    try {
      const rows = await SEARCHERS[src](gq.q, gq.per)
      const kept = rows
        .filter((r) => r.price >= GEN_MIN && r.price <= GEN_MAX && !isJunk(flatten(r.rawTitle)))
        .map((r) => ({
          ...r,
          brand: r.brand || guessBrand(r.rawTitle),
          name: r.rawTitle.slice(0, 70),
          category: gq.cat,
          catGroup: gq.group,
          model: '',
          condition: 'new',
          verified: false,
          tag: '',
          query: gq.q,
        }))
      all.push(...kept)
      console.log(`✓ [${gq.group}] ${src} ${gq.q}: ${kept.length}개`)
    } catch (err) {
      console.warn(`✗ [${gq.group}] ${src} ${gq.q}: ${err.message}`)
    }
    await pause(300)
  }
}

const products = [...new Map(all.map((p) => [p.id, p])).values()]
for (const p of products) {
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
const crossSeller = [...groups.keys()].filter(
  (g) => new Set(products.filter((p) => p.modelGroup === g).map((p) => p.seller)).size >= 2
).length

console.log(`\n총 ${products.length}개 (전부 새상품)`)
console.log('  판매처:', Object.entries(bySeller).map(([k, v]) => `${k} ${v}`).join(' / '))
console.log('  카테고리:', Object.entries(byGroup).map(([k, v]) => `${k} ${v}`).join(' / '))
console.log(`  비교 그룹 ${[...groups.values()].filter((n) => n >= 2).length}개 / 판매처 교차 그룹 ${crossSeller}개`)
