/**
 * POST /api/chat
 *
 * 사용자의 "이름은 모르겠고 이렇게 생겼는데…" 서술을 받아
 *  1) ChatGPT로 크롤링 카탈로그에서 후보 상품을 고르고
 *  2) 서버에서 같은 모델 매물들과 비교한 '시세 인텔리전스'를 붙여서 돌려준다.
 *
 * 가격 계산을 프론트가 아닌 서버에 둔 이유는 README '설계 의도' 참고.
 */
import CATALOG from './_catalog.js'

const MODEL = 'gpt-4o-mini'
const MAX_MESSAGES = 20
const MAX_CHARS = 2000
const MIN_PEERS = 3 // 비교군이 이보다 적으면 '시세'라고 부르지 않는다

const byId = new Map(CATALOG.map((p) => [p.id, p]))

// 모델 그룹별 가격 분포를 미리 계산해둔다 (요청마다 다시 돌 필요가 없다).
const GROUPS = new Map()
for (const p of CATALOG) {
  if (!GROUPS.has(p.modelGroup)) GROUPS.set(p.modelGroup, [])
  GROUPS.get(p.modelGroup).push(p)
}

const won = (n) => n.toLocaleString('ko-KR')

/** 같은 모델 매물들과 비교해 이 매물이 싼지 비싼지 판단한다. */
function priceIntel(product) {
  const peers = GROUPS.get(product.modelGroup) || []
  if (peers.length < MIN_PEERS) return null

  const prices = peers.map((p) => p.price).sort((a, b) => a - b)
  const median = prices[Math.floor(prices.length / 2)]
  const cheaperThan = prices.filter((p) => p > product.price).length

  return {
    // 모델을 특정하지 못한 그룹은 '같은 모델'이라고 하지 않는다 (과장 금지)
    basis: product.model
      ? `${product.brand} ${product.model} ${product.category}`
      : `${product.brand} ${product.category}`,
    isModelLevel: Boolean(product.model),
    count: peers.length,
    min: prices[0],
    median,
    max: prices[prices.length - 1],
    // 중앙값(시세) 대비 몇 % 저렴한지. 음수면 시세보다 비싸다.
    discountPct: Math.round((1 - product.price / median) * 100),
    rank: peers.length - cheaperThan, // 1이면 최저가
    peers: peers
      .filter((p) => p.id !== product.id)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5)
      .map((p) => ({ id: p.id, price: p.price, name: p.name, url: p.url, verified: p.verified })),
  }
}

const SYSTEM_PROMPT = `너는 한국의 35-50세 여성 고객을 돕는 중고 명품 쇼핑 메이트야.

고객은 사고 싶은 물건의 정확한 상품명이나 품번을 기억하지 못한다. 대신 브랜드, 색상, 크기(반지갑/장지갑 등), 잠금장식, 패턴, 사용 상황 같은 특징을 풀어서 설명한다.
너의 일은 그 서술을 듣고 아래 [매물 목록]에서 가장 비슷한 매물을 최대 3개 고르는 것이다.

규칙:
1. 반드시 [매물 목록]에 있는 id만 고른다. 목록에 없는 상품을 지어내지 마라.
2. reply에는 고객의 묘사 중 '어떤 부분이 이 매물과 맞는지'를 구체적으로 짚어줘라.
   (예: "말씀하신 베이지에 남색 패턴은 디올 오블리크 자카드가 거의 확실해요.")
3. 확신이 서지 않으면 후보를 억지로 3개 채우지 말고, followUpQuestion으로
   색상 / 크기 / 잠금장식 / 패턴 중 딱 하나만 물어봐라. 한 번에 여러 개 묻지 마라.
4. 가격은 절대 언급하지 마라. 가격 비교는 시스템이 따로 계산해서 붙인다.
5. 말투: 따뜻하고 다정한 한국어 존댓말. 3문장 이내로 짧게. 전문용어를 쓰면 괄호로 풀어줘라.
6. 브랜드 자체가 목록에 없으면(예: 에르메스) 솔직히 없다고 말하고, 지금 취급 중인
   브랜드가 디올·샤넬·루이비통·구찌라고 안내해라.

반드시 아래 JSON 형식으로만 답한다:
{"reply": "고객에게 할 말", "matchedIds": ["id1","id2"], "followUpQuestion": "되물을 질문 또는 null"}`

/** 카탈로그를 토큰 아끼는 한 줄 포맷으로 압축한다. */
const catalogBlock = () =>
  CATALOG.map(
    (p) =>
      `${p.id}|${p.brand}|${p.category}|${p.model || '-'}|${p.rawTitle.slice(0, 55)}${p.tag ? ` #${p.tag.slice(0, 40)}` : ''}`
  ).join('\n')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' })
  }

  // --- 입력 검증 (신뢰 경계) ---
  const { messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 배열이 필요합니다.' })
  }
  const history = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
  if (history.length === 0) {
    return res.status(400).json({ error: '유효한 메시지가 없습니다.' })
  }

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n[매물 목록]\nid|브랜드|종류|모델|상품명 #판매자태그\n${catalogBlock()}` },
          ...history,
        ],
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
    const products = (Array.isArray(parsed.matchedIds) ? parsed.matchedIds : [])
      .slice(0, 3)
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((p) => ({ ...p, priceIntel: priceIntel(p) }))

    return res.status(200).json({
      reply: typeof parsed.reply === 'string' ? parsed.reply : '조금 더 자세히 말씀해 주시겠어요?',
      followUpQuestion: parsed.followUpQuestion || null,
      products,
      catalogSize: CATALOG.length,
    })
  } catch (err) {
    console.error('chat handler failed', err)
    return res.status(500).json({ error: '일시적인 오류가 발생했습니다. 다시 시도해 주세요.' })
  }
}

// 시세 계산은 순수 함수라 따로 검증해둔다. 실행: node api/chat.js
if (process.argv[1]?.endsWith('chat.js')) {
  const { strict: assert } = await import('node:assert')
  const target = CATALOG.find((p) => (GROUPS.get(p.modelGroup) || []).length >= MIN_PEERS)
  const intel = priceIntel(target)
  assert.ok(intel, '비교군이 충분한 매물은 시세 정보가 나와야 한다')
  assert.ok(intel.min <= intel.median && intel.median <= intel.max, '최저 <= 중앙 <= 최고')
  assert.ok(intel.rank >= 1 && intel.rank <= intel.count, 'rank는 1..count 범위')
  assert.equal(intel.discountPct, Math.round((1 - target.price / intel.median) * 100))
  const lonely = CATALOG.find((p) => (GROUPS.get(p.modelGroup) || []).length < MIN_PEERS)
  if (lonely) assert.equal(priceIntel(lonely), null, '비교군이 부족하면 시세를 만들지 않는다')
  console.log(
    `✓ priceIntel OK — ${target.brand} ${target.category} ${won(target.price)}원 / ` +
      `${intel.basis} 매물 ${intel.count}건 중 ${intel.rank}위, 시세 ${won(intel.median)}원 대비 ${intel.discountPct}%`
  )
}
