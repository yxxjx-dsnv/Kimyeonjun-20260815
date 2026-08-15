// /api/chat 핸들러를 실제 OpenAI 호출까지 태워보는 로컬 검증 스크립트
// 실행: node --env-file=.env.local tests/api.e2e.mjs  (OpenAI 실호출 — 키 필요)
const { default: handler } = await import(new URL('../api/chat.js', import.meta.url))

let failures = 0
function fakeRes() {
  const r = {}
  r.status = (code) => ((r.code = code), r)
  r.json = (body) => ((r.body = body), r)
  return r
}

async function run(label, messages, expect = {}) {
  const res = fakeRes()
  const t = Date.now()
  await handler({ method: 'POST', body: { messages } }, res)
  console.log(`\n${'='.repeat(70)}\n[${label}]  HTTP ${res.code}  (${Date.now() - t}ms)`)
  const b = res.body
  if (b.error) { console.log('  ERROR:', b.error); failures++; return }
  console.log('  reply:', b.reply.slice(0, 160))
  if (b.followUpQuestion) console.log('  되묻기:', b.followUpQuestion, '| 선택지:', JSON.stringify(b.followUpOptions))
  console.log(`  매칭 ${b.products.length}건 / 카탈로그 ${b.catalogSize}건`)
  for (const p of b.products) {
    const i = p.priceIntel
    console.log(`   - [${p.condition === 'new' ? '새상품' : '중고'}] ${p.brand} ${p.category} ${p.price.toLocaleString()}원 ${p.verified ? '[검수]' : ''} ${p.name.slice(0, 38)}`)
    if (i) {
      const s = i.stats
      console.log(
        `     intel: ${i.basis} ${i.count}건` +
          (s ? ` | ${s.rank}위 | %가능=${s.medianReliable}${s.medianReliable ? ` ${s.discountPct}%` : ''}` : '') +
          (i.newBest ? ` | 새상품 ${i.newBest.price.toLocaleString()}원 대비 ${i.vsNewPct}% 절약` : '')
      )
    }
  }
  if (expect.minProducts && b.products.length < expect.minProducts) {
    console.log(`  ✗ 기대 실패: 최소 ${expect.minProducts}건 필요한데 ${b.products.length}건`); failures++
  }
  if (expect.noQuestion && b.followUpQuestion) {
    console.log('  ✗ 기대 실패: 이번 턴에는 되묻기 금지인데 질문함'); failures++
  }
  if (expect.brand && b.products.some((p) => p.brand !== expect.brand)) {
    console.log(`  ✗ 기대 실패: ${expect.brand} 요청인데 다른 브랜드 카드가 섞임`); failures++
  }
}

// 1) 과제1 페르소나의 원본 발화
await run('서술형 검색', [
  { role: 'user', content: '디올 지갑인데 베이지 바탕에 남색 패턴이 깔려 있고, 카드 넣는 얇은 거였어' },
], { minProducts: 1 })

// 2) 사용자가 실제로 실패했던 샤넬백 플로우 — 후보 없이 질문만 반복하다 끝났던 케이스
await run('샤넬백(과거 실패 케이스) 1턴', [
  { role: 'user', content: '샤넬백 찾고 있어' },
], { minProducts: 1 })
await run('샤넬백(과거 실패 케이스) 2턴 — 되묻기 금지 + 후보 확정', [
  { role: 'user', content: '샤넬백 찾고 있어' },
  { role: 'assistant', content: '어떤 색상인가요?' },
  { role: 'user', content: '검정색 캐비어 가죽에 금장 로고 있는 거' },
], { minProducts: 1, noQuestion: true, brand: '샤넬' })

// 2.5) 실사용 스크린샷 버그 재현 — '누빔'(=마틀라세)에 생로랑이 섞여 나왔던 케이스
await run('브랜드 가드 — 샤넬 누빔에 생로랑 미끼', [
  { role: 'user', content: '샤넬 가방, 검정 누빔에 금색 체인 달린 어깨에 메는 거' },
], { minProducts: 1, brand: '샤넬' })

// 3) 새 브랜드 (확장 검증)
await run('프라다 사피아노', [
  { role: 'user', content: '프라다 반지갑인데 사피아노 가죽에 삼각 로고 달린 거 새상품으로 사고 싶어' },
], { minProducts: 1 })
await run('축약형 브랜드', [
  { role: 'user', content: '보테가 지갑 그 짜임 가죽으로 된 거 있잖아' },
], { minProducts: 1 })

// 3.5) 신규 카테고리 (뷰티·패션·생활)
await run('뷰티 — 수분크림 최저가', [
  { role: 'user', content: '모공에 좋은 수분크림, 판매처별로 제일 싼 거 찾아줘' },
], { minProducts: 1 })
await run('패션 — 검정 원피스', [
  { role: 'user', content: '검정 원피스 10만원 아래로 추천해줘' },
], { minProducts: 1 })
await run('생활 — 물티슈', [
  { role: 'user', content: '물티슈 제일 싼 걸로' },
], { minProducts: 1 })

// 4) 없는 브랜드 → 솔직히 없다고
await run('없는 브랜드', [{ role: 'user', content: '펜디 바게트백 찾아줘' }])

// 5) 입력 방어
const bad = fakeRes()
await handler({ method: 'POST', body: {} }, bad)
console.log(`\n${'='.repeat(70)}\n[빈 입력 방어] HTTP ${bad.code} — ${bad.body.error}`)
const wrongMethod = fakeRes()
await handler({ method: 'GET' }, wrongMethod)
console.log(`[GET 차단] HTTP ${wrongMethod.code} — ${wrongMethod.body.error}`)

console.log(failures === 0 ? '\n✅ 전체 통과' : `\n❌ 실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
