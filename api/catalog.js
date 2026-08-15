/**
 * GET /api/catalog — 크롤링 카탈로그 전체 + 매물별 가격 인텔리전스.
 * 프론트 '둘러보기'/'찜' 탭이 사용한다. 데이터는 빌드 시점 스냅샷이라 캐시해도 된다.
 */
import { CATALOG, priceIntel } from './_intel.js'

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 지원합니다.' })
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).json({
    total: CATALOG.length,
    products: CATALOG.map((p) => ({ ...p, priceIntel: priceIntel(p) })),
  })
}
