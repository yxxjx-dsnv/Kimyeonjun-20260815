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


/* ---- 6. 갈래 판정: 가까운 대안은 통과, 다른 물건은 차단 ---- */
const { wantedType, typeMismatch } = await import('../api/chat.js')

// 같은 갈래 = 가까운 대안이므로 보여준다 ("니트" 요청 → "가디건" 후보)
assert.equal(
  typeMismatch('메종 키츠네 니트인데 큰 여우가 가운데 그려진거', [
    { category: '가디건', name: '베이비 폭스 패치 레귤러 가디건' },
  ]),
  null,
  '니트↔가디건은 같은 상의 갈래라 막으면 안 된다'
)

// 다른 갈래 = 다른 물건이므로 막는다 ("슬리퍼" 요청 → "반지갑" 후보)
const mm = typeMismatch('남성 슬리퍼였어', [
  { category: '반지갑', name: '에르메스 할로나 U각인 베안 반지갑 블랙 금장' },
])
assert.ok(mm, '슬리퍼↔반지갑은 다른 갈래라 반드시 걸러야 한다')
assert.equal(mm.word, '슬리퍼')

// 요청한 갈래가 후보에 있으면 통과
assert.equal(
  typeMismatch('에르메스 지갑 보여줘', [{ category: '반지갑', name: '에르메스 베안 반지갑' }]),
  null
)
// 갈래를 말하지 않은 질의는 판정하지 않는다
assert.equal(typeMismatch('뭔가 예쁜 거', [{ category: '반지갑', name: 'x' }]), null)

assert.equal(wantedType('카드지갑 찾아줘').word, '카드지갑', '긴 단어가 먼저 잡혀야 한다')
ok('갈래 판정 — 니트↔가디건 통과 / 슬리퍼↔반지갑 차단')


/* ---- 7. 라이브 결과의 '종류'가 말이 되는 값인가 ---- */
const { categoryFrom } = await import('../api/_live.js')
if (typeof categoryFrom === 'function') {
  assert.equal(categoryFrom('[마른파이브] 모달 브이넥 롱 원피스 잠옷', '원피스 10만원 이하'), '원피스',
    '제목에 있는 종류를 써야 한다')
  assert.notEqual(categoryFrom('[동구밭] 가꿈비누 3종 선물 세트', '선물할 만한 거'), '거',
    "'거' 같은 조각이 종류가 되면 안 된다")
  assert.equal(categoryFrom('에르메스 이즈미르 남성 샌달 슬리퍼', '에르메스 슬리퍼'), '슬리퍼')
  ok("라이브 결과 종류 추출 — '이하'·'거' 같은 쓰레기 값 차단")
}


/* ---- 8. 탐침(62건)에서 나온 결함 회귀 ---- */
const { currentType, keywordFallback: kfb } = await import('../api/chat.js')

// 정정 발화: 마지막 발화의 갈래가 앞턴을 이겨야 한다
assert.equal(currentType('아니 가방이었어', '에르메스 지갑 보여줘 아니 가방이었어').domain, '가방',
  '"아니 가방이었어"에서 앞턴의 지갑이 이기면 안 된다')
assert.equal(currentType('그럼 구찌 가방으로 보여줘', '에르메스 지갑 보여줘 그럼 구찌 가방으로 보여줘').domain, '가방')

// 액세서리 갈래 인식 (없는 물건을 정직하게 답하려면 먼저 인식해야 한다)
for (const [q, d] of [['발렌시아가 벨트 있나요', '액세서리'], ['손목에 차는 얇은 금색 시계', '액세서리'],
                      ['스테인리스 보온 물통', '생활']]) {
  assert.equal(wantedType(q)?.domain, d, `"${q}" → ${d}`)
}

// 영어 질의도 갈래를 읽어야 한다
assert.equal(wantedType('Do you have a black leather crossbody bag').domain, '가방', '영어 질의 갈래 인식')

// 상위어 묘사에서 백스톱이 죽지 않아야 한다 (0건 방지)
const bp = buildStaticPool('베이지 바탕에 갈색이랑 빨강 줄이 격자로 들어간 반으로 접는 지갑', null)
assert.ok(kfb('베이지 바탕에 갈색이랑 빨강 줄이 격자로 들어간 반으로 접는 지갑', bp).length > 0,
  '상위어("지갑")만 말한 묘사에서 백스톱이 후보를 내야 한다')

ok('탐침 회귀 — 정정 발화·액세서리·영어·상위어 백스톱')

console.log(`\n✅ 검색 회귀 테스트 ${n}항목 통과`)
