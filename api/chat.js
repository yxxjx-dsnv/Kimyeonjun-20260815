/**
 * POST /api/chat
 *
 * 고객의 "이름은 모르겠고 이렇게 생겼는데…" 서술을 받아
 *  1) ChatGPT가 크롤링 카탈로그에서 후보 상품을 고르고
 *  2) 서버가 시세·새상품 대비 절약률을 계산해 붙여 돌려준다.
 *
 * 대화 설계 원칙 — 대화형 쇼핑 에이전트의 흔한 실패 패턴을 정반대로 뒤집었다:
 *  - "질문만 계속하고 결과를 안 준다" → 질문은 대화 전체에서 최대 1번, 후보는 매 턴 필수
 *  - "대답해도 무시한다" → reply가 고객의 표현을 그대로 인용하며 근거를 설명
 *  - AI가 후보를 못 고르면 서버의 키워드 매칭이 대신 후보를 찾는다 (빈손 응답 금지)
 */
import { CATALOG, byId, priceIntel } from './_intel.js'

const MODEL = 'gpt-4o-mini'
const MAX_MESSAGES = 20
const MAX_CHARS = 2000

const BRANDS = [...new Set(CATALOG.map((p) => p.brand))]
// 사용자가 축약형으로 부르는 브랜드 (fallback 매칭용)
const BRAND_ALIASES = {
  보테가베네타: ['보테가'], 루이비통: ['루이뷔통'], 셀린느: ['셀린'],
  생로랑: ['입생로랑', '입생'], 롱샴: ['롱샹'],
}
const CATEGORY_WORDS = ['카드지갑', '반지갑', '장지갑', '크로스백', '숄더백', '토트백', '클러치', '백팩']
const COLOR_WORDS = [
  '검정', '검은', '블랙', '흰', '화이트', '아이보리', '베이지', '갈색', '브라운', '카멜', '탄',
  '남색', '네이비', '파란', '블루', '하늘', '빨간', '레드', '와인', '버건디', '분홍', '핑크',
  '금색', '골드', '금장', '은색', '실버', '은장', '회색', '그레이', '카키', '초록', '그린',
  '노란', '옐로우', '보라', '퍼플', '오렌지', '데님',
]

const flat = (s) => (s || '').replace(/\s+/g, '')
const won = (n) => n.toLocaleString('ko-KR')

/** 대화 전체 텍스트에서 언급된 카탈로그 브랜드를 전부 찾는다. */
function detectBrands(text) {
  const t = flat(text)
  return BRANDS.filter(
    (b) => t.includes(b) || (BRAND_ALIASES[b] || []).some((a) => t.includes(a))
  )
}
const detectBrand = (text) => detectBrands(text)[0]

/**
 * AI가 후보를 못 골랐을 때의 결정론적 백스톱.
 * 언급된 브랜드의 매물을 종류(+2)·색상(+1)·모델 키워드(+3) 겹침으로 점수화해 상위 3개.
 * "브랜드가 있는데 빈손으로 답하는" 최악의 경험을 코드 레벨에서 막는다.
 */
function keywordFallback(text) {
  const brand = detectBrand(text)
  if (!brand) return []
  const t = flat(text)

  const scored = CATALOG.filter((p) => p.brand === brand).map((p) => {
    const hay = flat(`${p.rawTitle} ${p.tag} ${p.category}`)
    let score = 0
    if (CATEGORY_WORDS.some((c) => t.includes(c) && p.category === c)) score += 2
    else if (t.includes('지갑') && p.category.includes('지갑')) score += 1
    else if ((t.includes('가방') || t.includes('백')) && !p.category.includes('지갑')) score += 1
    for (const c of COLOR_WORDS) if (t.includes(c) && hay.includes(c)) score += 1
    if (p.model && t.includes(flat(p.model))) score += 3
    return { p, score }
  })

  scored.sort(
    (a, b) => b.score - a.score || Number(b.p.verified) - Number(a.p.verified) || a.p.price - b.p.price
  )
  return scored.slice(0, 3).map((s) => s.p)
}

const SYSTEM_PROMPT = `너는 '그거 있잖아'의 AI 쇼핑 비서야. 고객은 한국의 35-50세 여성이고, 사고 싶은 물건의 정확한 상품명을 기억하지 못한 채 특징(브랜드, 색, 크기, 장식, 패턴)으로 설명해.

너의 일: 아래 [매물 목록]에서 고객 묘사와 가장 비슷한 매물을 골라주는 것.

절대 규칙:
1. 반드시 목록에 있는 id만 고른다. 목록에 없는 상품을 지어내지 마라.
2. **후보 우선**: 고객이 말한 브랜드가 목록에 있으면 matchedIds를 절대 비우지 마라. 완벽히 일치하지 않아도 가장 가까운 후보 1~3개를 골라라. "없다"고 답하는 경우는 브랜드 자체가 목록에 없을 때뿐이다. (현재 취급 브랜드: ${BRANDS.join(', ')})
   단, **후보는 반드시 고객이 말한 브랜드의 매물이어야 한다.** 다른 브랜드에 색·소재·디자인이 더 비슷한 상품이 있어도 절대 대신 제시하지 마라. 브랜드가 틀린 추천은 오답이다.
3. reply 첫 문장은 고객이 말한 특징을 그대로 인용하며 시작해라. (예: "말씀하신 '베이지에 남색 무늬'는 디올 오블리크 패턴이에요.") 각 후보가 묘사의 어떤 부분과 맞는지, 어떤 부분은 판매글에 없어 확인이 필요한지 솔직히 말해라.
4. 질문은 대화 전체에서 **최대 한 번**: 후보를 더 좁힐 결정적 정보 하나가 필요할 때만 followUpQuestion으로 물어라. 이때도 matchedIds는 반드시 함께 제시한다. followUpOptions에 고객이 탭해서 답할 수 있는 선택지 2~4개(각 8자 이내)를 담아라. 이미 한 번 물었다면 더 묻지 말고(followUpQuestion=null) 지금 정보로 확정해라.
5. 고객이 새상품/중고 여부를 말하면 존중해라. 매물 목록의 상태(새상품/중고) 컬럼을 참고.
6. 가격은 절대 언급하지 마라. 가격 비교는 시스템이 정확한 데이터로 계산해 붙인다.
7. 말투: 따뜻한 한국어 존댓말, 2~3문장, 쉬운 말. 외국어 용어는 괄호로 풀어줘라.

반드시 아래 JSON 형식으로만 답한다:
{"reply": "고객에게 할 말", "matchedIds": ["id1","id2"], "followUpQuestion": "질문 또는 null", "followUpOptions": ["선택지"] }`

/** 카탈로그를 토큰 아끼는 한 줄 포맷으로 압축한다. */
const catalogBlock = () =>
  CATALOG.map(
    (p) =>
      `${p.id}|${p.brand}|${p.category}|${p.model || '-'}|${p.condition === 'new' ? '새상품' : '중고'}|${p.rawTitle.slice(0, 55)}${p.tag ? ` #${p.tag.slice(0, 35)}` : ''}`
  ).join('\n')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' })

  // --- 입력 검증 (신뢰 경계) ---
  const { messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다.' })
  }
  const history = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
  if (history.length === 0) return res.status(400).json({ error: '유효한 메시지가 없습니다.' })

  const userText = history.filter((m) => m.role === 'user').map((m) => m.content).join(' ')
  const userTurns = history.filter((m) => m.role === 'user').length

  const chatMessages = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n[매물 목록]\nid|브랜드|종류|모델|상태|상품명 #태그\n${catalogBlock()}`,
    },
    ...history,
  ]
  // 되묻기 1회 제한을 프롬프트에만 맡기지 않고 코드로도 강제한다.
  if (userTurns >= 2) {
    chatMessages.push({
      role: 'system',
      content: '고객이 이미 추가 정보를 주었다. 이번 턴에는 절대 되묻지 말고(followUpQuestion=null) 지금까지의 정보로 가장 가까운 후보를 확정해라.',
    })
  }

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: chatMessages,
      }),
    })

    if (!completion.ok) {
      const detail = await completion.text()
      console.error('OpenAI error', completion.status, detail.slice(0, 500))
      return res.status(502).json({ error: 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' })
    }

    const data = await completion.json()
    let parsed
    try {
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    } catch {
      return res.status(502).json({ error: 'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.' })
    }

    // 존재하지 않는 id를 지어냈을 수 있으므로 카탈로그와 조인하며 걸러낸다.
    let matched = (Array.isArray(parsed.matchedIds) ? parsed.matchedIds : [])
      .slice(0, 3)
      .map((id) => byId.get(String(id)))
      .filter(Boolean)

    // 브랜드 가드: 고객이 브랜드를 말했다면 다른 브랜드 매물은 코드 레벨에서 걸러낸다.
    // (실사용에서 "샤넬 누빔 금색 체인"에 생로랑 마틀라세가 카드로 나온 사례 — LLM이
    //  속성 유사도만 보고 브랜드를 무시하는 실수는 신뢰를 즉시 무너뜨리므로
    //  프롬프트에만 맡기지 않는다. 걸러서 비면 아래 백스톱이 올바른 브랜드로 채운다.)
    const mentionedBrands = detectBrands(userText)
    if (mentionedBrands.length > 0) {
      matched = matched.filter((p) => mentionedBrands.includes(p.brand))
    }

    let reply = typeof parsed.reply === 'string' ? parsed.reply : '조금 더 자세히 말씀해 주시겠어요?'

    // 백스톱: AI가 빈손인데 언급된 브랜드가 카탈로그에 있으면 키워드 매칭이 후보를 채운다.
    if (matched.length === 0) {
      const fallback = keywordFallback(userText)
      if (fallback.length > 0) {
        matched = fallback
        reply += ' 말씀하신 조건과 가까운 매물부터 보여드릴게요.'
      }
    }

    const followUpOptions =
      parsed.followUpQuestion && Array.isArray(parsed.followUpOptions)
        ? parsed.followUpOptions.filter((o) => typeof o === 'string' && o.trim()).slice(0, 4).map((o) => o.slice(0, 12))
        : []

    return res.status(200).json({
      reply,
      followUpQuestion: parsed.followUpQuestion || null,
      followUpOptions,
      products: matched.map((p) => ({ ...p, priceIntel: priceIntel(p) })),
      catalogSize: CATALOG.length,
    })
  } catch (err) {
    console.error('chat handler failed', err)
    return res.status(500).json({ error: '일시적인 오류가 발생했습니다. 다시 시도해 주세요.' })
  }
}

// ---- fallback 매처 self-check: node api/chat.js ----
if (process.argv[1]?.endsWith('chat.js')) {
  const { strict: assert } = await import('node:assert')
  const r1 = keywordFallback('샤넬 가방인데 검정색이고 금색 체인 달린 거')
  assert.ok(r1.length > 0 && r1.every((p) => p.brand === '샤넬'), '샤넬 언급 시 샤넬 후보 필수')
  assert.ok(r1.every((p) => !p.category.includes('지갑')), "'가방' 요청에 지갑이 나오면 안 됨")
  const r2 = keywordFallback('보테가 반지갑 초록색')
  assert.ok(r2.length > 0 && r2.every((p) => p.brand === '보테가베네타'), '축약형 브랜드 인식')
  assert.equal(keywordFallback('아무 브랜드도 없는 문장').length, 0, '브랜드 없으면 빈 배열')
  assert.deepEqual(detectBrands('샤넬이랑 입생 중에 고민'), ['샤넬', '생로랑'], '복수 브랜드 감지')
  assert.deepEqual(detectBrands('검정 누빔 가방'), [], '브랜드 미언급이면 가드 미작동')
  console.log(`✓ keywordFallback OK — 샤넬:${r1.length}건(${r1.map((p) => p.category).join(',')}) / 보테가:${r2.length}건`)
  console.log(`  예시: ${r1[0].name.slice(0, 40)} / ${won(r1[0].price)}원`)
}
