// 실행: node tests/render.test.mjs
// Vite SSR로 App(쇼포트 클론 셸)을 렌더링 + /api/catalog 핸들러 검증
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'
import { readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗ 실패'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

// 1) App SSR (기본 = 홈 화면)
const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const html = renderToString(React.createElement(App))
check('홈 헤드라인 (쇼포트 카피)', html.includes('구매하고 싶은') && html.includes('상품이 있으신가요?'))
check('히어로 입력 카드', html.includes('class="hero"') && html.includes('찾는 상품 설명'))
check('2×2 선택지 그리드 4개', (html.match(/class="gcard"/g) || []).length === 4)
check('원하는 질문을 선택해보세요', html.includes('원하는 질문을 선택해보세요'))
check('헤더 아이콘 내비 — 홈 화면엔 탐색·찜만 (실제 앱과 동일)', !html.includes('AI 찾기 홈') && html.includes('최저가 추적') && html.includes('찜한 목록'))
check('하단 탭바 없음 (쇼포트에 없음)', !html.includes('tabbar'))
// 고지 문구는 폰 화면에서는 빼고(요청 반영), 데스크톱 사이드 가이드에만 남긴다.
// 자사 앱 UX를 재현한 프로토타입이라 고지 자체는 어딘가 있어야 한다.
const phoneOnly = html.slice(html.indexOf('class="phone"'), html.lastIndexOf('guide--right'))
check('폰 화면 내 고지 문구 없음 (요청 반영)', !phoneOnly.includes('실제 쇼포트 서비스가'))
check('고지 문구는 데스크톱 가이드에 유지', html.includes('실제 쇼포트 서비스가'))
check('타이틀 레벨 프로토타입 표기 유지', readFileSync(`${root}/index.html`, 'utf8').includes('프로토타입'))
await vite.close()

// 2) 소스 분기 검증
const src = readFileSync(`${root}/src/App.jsx`, 'utf8')
check('홈 복귀 아이콘은 조건부 렌더', src.includes("view !== 'chat'"))
check('라이브 검색 배지', src.includes('실시간 검색') && src.includes('liveCount'))
check('역대급 최저가 뷰', src.includes('역대급 최저가') && src.includes('DealsView'))
check('편차 큰 그룹 % 미표시 분기', src.includes('medianReliable') && src.includes('번째로 저렴'))
check('질문 카드 + 선택지·선택완료', src.includes('qcard') && src.includes('선택 완료'))
check('비교표 보기 탭', src.includes('비교표로 보기') && src.includes('CompareTable'))
check('가격비교 시트 (판매처 별 판매가)', src.includes('판매처 별 판매가') && src.includes('가격 추적하기'))
check('사진으로 찾기', src.includes('imageToQuery') && src.includes('/api/vision'))
check('대화 기록 서랍', src.includes('Drawer') && src.includes('새 대화'))
check('예산 반영 칩', src.includes('예산') && src.includes('budget'))
check('에이전트 상태행 (정리 완료)', src.includes('statusrow') && src.includes('결과 정리 완료'))
check('유저 발화 pill', src.includes('upill'))
check('찜 localStorage 영속화', src.includes('localStorage'))
check('블랙 CTA 최저가 구매하기', src.includes('최저가 구매하기'))
// 이전 문구는 한 줄에 안 들어가 두 번째 줄이 잘려 보였다.
check('대화 입력창 placeholder가 한 줄에 들어가는 길이', src.includes('조건을 더 말씀해 주세요'))
check('데스크톱 사이드 가이드 (사용법 + 설계 의도)', src.includes('GuideRail') && src.includes('왜 이렇게 했나'))
check('리뷰 평점 표시', src.includes('card__rating'))
check('상세 시트 ESC 닫기', src.includes("e.key === 'Escape'"))

// 2.5) 인스턴트 검색 (Netflix/네이버식) 단위 검증
const { buildIndex, instantSearch, toChoseong, toJamo } = await import(`${root}/src/instant.js`)
const { default: cat } = await import(`${root}/api/_catalog.js`)
const idx = buildIndex(cat)
const r샤 = instantSearch(idx, '샤')
check("'샤' 한 글자 → 샤넬 즉시", r샤.products.length > 0 && r샤.products.every((p) => p.brand === '샤넬'), r샤.suggestions.join('/'))
const r초성 = instantSearch(idx, 'ㅅㅋㄹ')
check("초성 'ㅅㅋㄹ' → 선크림", r초성.products.length > 0 && r초성.products.some((p) => p.category === '선크림'))
const r자모 = instantSearch(idx, '무신')
check("'무신' → 무신사 판매 상품", r자모.products.length >= 0 && instantSearch(idx, '물').products.some((p) => p.category === '물티슈'))
check('자모 유틸', toChoseong('샤넬 가방') === 'ㅅㄴㄱㅂ' && toJamo('샤').startsWith('ㅅㅑ'))
check('인스턴트 패널 연결', src.includes('InstantPanel') && src.includes('instantSearch'))

// 3) /api/catalog 핸들러
const { default: catalogHandler } = await import(`${root}/api/catalog.js`)
const r = {}; r.status = (c) => ((r.code = c), r); r.json = (b) => ((r.body = b), r); r.setHeader = () => {}
catalogHandler({ method: 'GET' }, r)
check('catalog 200 + 전체 반환', r.code === 200 && r.body.total === r.body.products.length, `${r.body.total}건`)
const sellers = new Set(r.body.products.map((p) => p.seller))
check('판매처 5곳 포함 (KREAM 편입)', sellers.size === 5 && sellers.has('KREAM'), [...sellers].join(','))
check('전 상품 새상품', r.body.products.every((p) => p.condition === 'new'))
const deal = r.body.products.find((p) => p.priceIntel?.stats?.medianReliable && p.priceIntel.stats.discountPct >= 10)
check('역대급 최저가 후보 존재', Boolean(deal), deal ? `${deal.brand} ${deal.priceIntel.stats.discountPct}%↓` : '')
const crossSeller = r.body.products.find(
  (p) => p.priceIntel?.peers?.some((x) => x.seller !== p.seller)
)
check('판매처 간 가격 비교 가능한 상품 존재', Boolean(crossSeller), crossSeller ? crossSeller.modelGroup : '')

console.log(fail === 0 ? '\n✅ 전부 통과' : `\n❌ 실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
