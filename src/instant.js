/**
 * 인스턴트 검색 — 타이핑 즉시(키 입력마다) 결과를 보여주는 클라이언트 인덱스.
 *
 * 연구한 엔진별 기법의 적용:
 *  - Netflix: 키 입력마다 전체 재랭킹 + 인기도(리뷰 수·평점) 부스트 + 썸네일 즉시 노출
 *  - Google Suggest: 접두(prefix) 우선 랭킹 + 쿼리 자동완성 제안
 *  - Naver: 한글 자모/초성 매칭 — "ㅅㅋㄹ"→선크림, "샤ㄴ"→샤넬 (조합 중에도 매칭)
 *
 * 카탈로그 900건은 선형 스캔으로도 <1ms — 인덱스는 모듈 로드 시 1회 전처리.
 */

/* ---------- 한글 자모 분해 ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/** "샤넬" → "ㅅㅑㄴㅕㄹ" (음절을 자모 시퀀스로) */
export function toJamo(str) {
  let out = ''
  for (const ch of str) {
    const code = ch.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) {
      out += ch.toLowerCase()
      continue
    }
    out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28]
  }
  return out
}

/** "샤넬 가방" → "ㅅㄴㄱㅂ" (초성만) */
export function toChoseong(str) {
  let out = ''
  for (const ch of str) {
    const code = ch.charCodeAt(0) - 0xac00
    if (code < 0 || code > 11171) {
      if (ch !== ' ') out += ch.toLowerCase()
      continue
    }
    out += CHO[Math.floor(code / 588)]
  }
  return out
}

export const isChoseongQuery = (q) => /^[ㄱ-ㅎ]{2,}$/.test(q.replace(/\s+/g, ''))

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '')

/* ---------- 인덱스 ---------- */
export function buildIndex(products) {
  return products.map((p) => {
    const brand = norm(p.brand)
    const category = norm(p.category)
    const name = norm(p.name)
    return {
      p,
      brand,
      category,
      name,
      brandJamo: toJamo(brand),
      catJamo: toJamo(category),
      nameJamo: toJamo(name),
      brandCho: toChoseong(p.brand),
      catCho: toChoseong(p.category),
      nameCho: toChoseong(p.name),
      // 인기도 부스트 (Netflix식): 리뷰가 많고 평점 높은 상품을 위로
      pop: Math.log10((p.reviewCount || 0) + 1) * 2 + (p.rating || 0) * 0.5,
    }
  })
}

/* ---------- 검색 ---------- */
export function instantSearch(index, rawQuery, limit = 5) {
  const q = norm(rawQuery)
  if (q.length < 1) return { products: [], suggestions: [] }
  const qJamo = toJamo(q)
  const cho = isChoseongQuery(rawQuery)

  const scored = []
  for (const e of index) {
    let s = 0
    if (cho) {
      // 초성 검색: "ㅅㅋㄹ" → 선크림
      const qc = rawQuery.replace(/\s+/g, '')
      if (e.brandCho.startsWith(qc)) s = 60
      else if (e.catCho.startsWith(qc)) s = 50
      else if (e.nameCho.includes(qc)) s = 30
    } else {
      // 완성형 + 조합 중 자모까지: "샤ㄴ" → 샤넬
      if (e.brand.startsWith(q)) s = 60
      else if (e.category.startsWith(q)) s = 50
      else if (e.brandJamo.startsWith(qJamo)) s = 45
      else if (e.catJamo.startsWith(qJamo)) s = 40
      else if (e.name.startsWith(q)) s = 35
      else if (e.name.includes(q)) s = 25
      else if (e.nameJamo.includes(qJamo) && qJamo.length >= 3) s = 15
    }
    if (s > 0) scored.push({ e, s: s + e.pop })
  }
  scored.sort((a, b) => b.s - a.s)
  const products = scored.slice(0, limit).map((x) => x.e.p)

  // 자동완성 제안 (Google Suggest식): 매칭된 브랜드·카테고리 조합
  const brands = new Map()
  const cats = new Map()
  for (const { e } of scored.slice(0, 60)) {
    brands.set(e.p.brand, (brands.get(e.p.brand) || 0) + 1)
    cats.set(e.p.category, (cats.get(e.p.category) || 0) + 1)
  }
  const suggestions = []
  const topBrand = [...brands.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)
  if (topBrand) {
    const bMatch =
      norm(topBrand).startsWith(q) || toJamo(norm(topBrand)).startsWith(qJamo) || (cho && toChoseong(topBrand).startsWith(rawQuery.replace(/\s+/g, '')))
    if (bMatch) {
      suggestions.push(topBrand)
      // 조합 제안은 그 브랜드가 실제로 가진 카테고리로만
      const brandCats = new Set(scored.filter(({ e }) => e.p.brand === topBrand).map(({ e }) => e.p.category))
      for (const c of topCats.filter((c) => brandCats.has(c)).slice(0, 2)) suggestions.push(`${topBrand} ${c}`)
    }
  }
  for (const c of topCats) {
    if (!suggestions.includes(c) && suggestions.length < 4) suggestions.push(`${c} 추천해줘`)
  }
  return { products, suggestions: suggestions.slice(0, 4) }
}
