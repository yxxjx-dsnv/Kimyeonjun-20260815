/**
 * 쇼핑몰 검색 파서 공유 모듈 — 크롤러(1회성 카탈로그)와
 * 서버 라이브 검색(api/_live.js)이 같은 코드를 쓴다.
 * 모든 파서는 동일 스키마를 반환: {id, rawTitle, brand?, price, seller, url, image, rating, reviewCount}
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
export const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/html' }

export const flatten = (s) => (s || '').replace(/\s+/g, '')
export const cleanTitle = (s) => (s || '').replace(/\s+/g, ' ').trim()

// 상품 본체가 아닌 매물 차단 — 합성어 단위로만 (README '겪은 어려움' 참고)
const EXCLUDE = ['쇼핑백', '종이가방', '자석박스', '가방박스', '박스만', '빈박스', '더스트백', '보증서만', '키링', '스티커', '리폼', '수선', '부자재', '굿즈', '공병']
export const isJunk = (flat) => EXCLUDE.some((k) => flat.includes(k))

// 대괄호가 브랜드가 아닌 판매 문구인 경우
const BRACKET_JUNK = ['무료배송', '기획', '세트', '단독', '특가', '증정']
export function guessBrand(title) {
  let t = title
  for (let i = 0; i < 2; i++) {
    const m = t.match(/^[[(【]([^\])】]{1,14})[\])】]\s*/)
    if (!m) break
    if (BRACKET_JUNK.some((j) => m[1].includes(j))) {
      t = t.slice(m[0].length)
      continue
    }
    return m[1].trim()
  }
  const first = t.split(' ')[0].replace(/[^\p{L}\p{N}]/gu, '')
  return first.length >= 2 && first.length <= 12 ? first : '기타'
}

async function getJSON(url, timeoutMs) {
  const res = await fetch(url, {
    headers: HEADERS,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** 다나와 통합검색 SSR HTML → prod_item 블록 정규식 파싱 (사전 실측 완료). */
export async function danawaSearch(q, limit, timeoutMs) {
  const res = await fetch(`https://search.danawa.com/dsearch.php?query=${encodeURIComponent(q)}`, {
    headers: HEADERS,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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
    out.push({
      id: `d${pcode}`,
      rawTitle,
      price,
      seller: '다나와 최저가',
      url: `https://prod.danawa.com/info/?pcode=${pcode}`,
      image: imgM ? (imgM[1].startsWith('//') ? 'https:' + imgM[1] : imgM[1]) : '',
      rating: null,
      reviewCount: null,
    })
  }
  return out
}

export async function cm29Search(q, limit, timeoutMs) {
  const d = await getJSON(
    `https://search-api.29cm.co.kr/api/v4/products/search?keyword=${encodeURIComponent(q)}&page=0&size=30`,
    timeoutMs
  )
  return (d.data?.products || [])
    .filter((p) => !p.isSoldOut)
    .slice(0, limit)
    .map((p) => ({
      id: `t${p.itemNo}`,
      rawTitle: cleanTitle(p.itemName),
      brand: cleanTitle(p.frontBrandNameKor) || null,
      price: Number(p.lastSalePrice || p.consumerPrice),
      seller: '29CM',
      url: `https://product.29cm.co.kr/catalog/${p.itemNo}`,
      image: p.imageUrl?.startsWith('http') ? p.imageUrl : `https://img.29cm.co.kr${p.imageUrl || ''}`,
      rating: p.reviewAveragePoint ? Number(p.reviewAveragePoint) : null,
      reviewCount: p.reviewCount ? Number(p.reviewCount) : null,
    }))
}

export async function musinsaSearch(q, limit, timeoutMs) {
  const d = await getJSON(
    `https://api.musinsa.com/api2/dp/v1/plp/goods?gf=A&keyword=${encodeURIComponent(q)}&sortCode=POPULAR&page=1&size=30&caller=SEARCH`,
    timeoutMs
  )
  return (d.data?.list || [])
    .filter((p) => !p.isAd && !p.isSoldOut && !p.usedConditionGrade)
    .slice(0, limit)
    .map((p) => ({
      id: `m${p.goodsNo}`,
      rawTitle: cleanTitle(p.goodsName),
      brand: cleanTitle(p.brandName) || null,
      price: Number(p.price || p.finalPrice || p.normalPrice),
      seller: '무신사',
      url: p.goodsLinkUrl || `https://www.musinsa.com/products/${p.goodsNo}`,
      image: p.thumbnail?.startsWith('http') ? p.thumbnail : `https:${p.thumbnail || ''}`,
      rating: p.reviewScore ? Number(p.reviewScore) : null,
      reviewCount: p.reviewCount ? Number(p.reviewCount) : null,
    }))
}

export async function kurlySearch(q, limit, timeoutMs) {
  const d = await getJSON(
    `https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${encodeURIComponent(q)}&page=1`,
    timeoutMs
  )
  const items = (d.data?.listSections || []).flatMap((s) => s.data?.items || [])
  return items
    .filter((p) => p.name && (p.salesPrice || p.discountedPrice) && !p.isSoldOut)
    .slice(0, limit)
    .map((p) => ({
      id: `k${p.no || p.productNo || p.id}`,
      rawTitle: cleanTitle(p.name),
      price: Number(p.discountedPrice || p.salesPrice),
      seller: '컬리',
      url: `https://www.kurly.com/goods/${p.no || p.productNo || p.id}`,
      image: p.listImageUrl || p.imageUrl || '',
      rating: null,
      reviewCount: p.reviewCount ? Number(String(p.reviewCount).replace(/\D/g, '')) : null,
    }))
}
