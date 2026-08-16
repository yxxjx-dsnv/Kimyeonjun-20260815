/**
 * 검색 회귀 테스트 — "브랜드를 말했는데 엉뚱한 상품이 나온다"의 재발 방지.
 *
 * 배경: 질의는 공백을 지워 비교하는데 브랜드명은 원문 그대로 비교해서,
 * 이름에 공백이 있는 브랜드 18개(메종 키츠네·조 말론 런던·에스티 로더 …)가
 * 전부 인식되지 않았다. "메종 키츠네 니트인데 큰 여우가 그려진거"에
 * 9,800원짜리 무신사 기본 니트가 나왔다.
 *
 * 실행: node tests/search.test.mjs
 */
import { strict as assert } from 'node:assert'
import { buildStaticPool } from '../api/chat.js'
import { buildIndex, instantSearch } from '../src/instant.js'
import CATALOG from '../api/_catalog.js'

const idx = buildIndex(CATALOG)
let n = 0
const ok = (label) => { n++; console.log('  ✓', label) }

/* ---- 1. 공백 포함 브랜드가 서버 후보 풀에서 인식되는가 ---- */
const spaced = [...new Set(CATALOG.map((p) => p.brand))].filter((b) => /\s/.test(b))
assert.ok(spaced.length > 0, '공백 포함 브랜드가 카탈로그에 존재해야 이 테스트가 의미 있다')
for (const brand of spaced) {
  const pool = buildStaticPool(brand, null)
  assert.ok(pool.some((p) => p.brand === brand), `서버: "${brand}" 질의에 해당 브랜드 후보가 있어야 한다`)
}
ok(`공백 포함 브랜드 ${spaced.length}개 전부 서버 후보 풀에서 인식`)

/* ---- 2. 실제 실패 사례 재현 ---- */
const pool = buildStaticPool('메종 키츠네 니트인데 큰 여우가 가운데 그려진거', null)
assert.ok(pool.length > 0, '후보가 비면 안 된다')
assert.ok(pool.every((p) => p.brand === '메종 키츠네'), '언급한 브랜드 외 상품이 섞이면 안 된다')
ok('"메종 키츠네 니트인데 큰 여우…" → 메종 키츠네 상품만 후보')

/* ---- 3. 상위어(가방·지갑·신발)가 하위 카테고리로 확장되는가 ---- */
for (const [q, cats] of [
  ['샤넬 가방', ['숄더백', '크로스백', '클러치', '토트백']],
  ['디올 지갑', ['카드지갑', '반지갑', '장지갑']],
  ['나이키 신발', ['운동화', '로퍼']],
]) {
  const p = buildStaticPool(q, null)
  assert.ok(p.length > 0, `"${q}" 후보가 있어야 한다`)
  assert.ok(p.some((x) => cats.includes(x.category)), `"${q}" → ${cats.join('/')} 중 하나가 나와야 한다`)
}
ok('상위어(가방·지갑·신발)가 하위 카테고리로 확장됨')

/* ---- 4. 인스턴트 검색: 어절이 둘 이상이어도 결과가 나오는가 ---- */
for (const q of ['디올 지갑', '샤넬 가방', '메종 키츠네', '메종 키츠네 니트', '조 말론 런던', '나이키 신발']) {
  const r = instantSearch(idx, q, 5)
  assert.ok(r.products.length > 0, `인스턴트: "${q}" 결과가 0건이면 안 된다`)
}
ok('인스턴트 검색 다어절 질의 6종 전부 결과 있음')

/* ---- 5. 기존 동작(초성·부분입력)이 깨지지 않았는가 ---- */
assert.ok(instantSearch(idx, '샤ㄴ', 5).products.length > 0, '조합 중 자모 입력')
assert.ok(instantSearch(idx, 'ㅅㅋㄹ', 5).products.length > 0, '초성 검색')
assert.ok(instantSearch(idx, '디올', 5).products.length > 0, '단일 어절')
ok('초성·조합중 자모·단일 어절 검색 유지')

console.log(`\n✅ 검색 회귀 테스트 ${n}항목 통과`)
