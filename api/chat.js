/**
 * POST /api/chat
 *
 * 고객의 자연어 요청을 받아
 *  1) 정적 카탈로그를 브랜드·카테고리·예산으로 좁히고 (1단계 검색)
 *  2) 부족하면 4개 쇼핑몰을 실시간 검색해 병합하고 (라이브 검색)
 *  3) ChatGPT가 후보를 고르면 서버가 가격 인텔리전스를 계산해 붙인다.
 *
 * 대화 정책은 프롬프트가 아니라 서버 코드가 최종 보증한다:
 *  - 질문은 대화당 최대 1회 (2번째 유저 턴부터 followUpQuestion 강제 null)
 *  - 언급 브랜드 외 상품 차단 (브랜드 가드) — 단, "비슷한/대체" 요청이면 예외
 *  - 예산 언급 시 범위 밖 상품 차단 (예산 가드)
 *  - AI가 빈손이면 키워드 백스톱이 후보를 채움
 */
import { CATALOG, byId, priceIntel, intelWithin } from './_intel.js'
import { liveSearch, extractKeyword, cleanTokens } from './_live.js'

const MODEL = 'gpt-4o-mini'
const MAX_MESSAGES = 20
const MAX_CHARS = 2000

// 일상 단어와 충돌하는 이름은 브랜드 가드 오작동을 일으키므로 감지에서 뺀다.
const BRAND_STOP = new Set(['자주', '무료배송', '기획', '세트', '기타'])
const BRANDS = [...new Set(CATALOG.map((p) => p.brand))].filter((b) => b.length >= 2 && !BRAND_STOP.has(b))
const BRAND_ALIASES = {
  보테가베네타: ['보테가'], 루이비통: ['루이뷔통'], 셀린느: ['셀린'],
  생로랑: ['입생로랑', '입생'], 롱샴: ['롱샹'],
}
const CATEGORY_WORDS = [...new Set(CATALOG.map((p) => p.category))].filter((c) => c !== '기타')
const COLOR_WORDS = [
  '검정', '검은', '블랙', '흰', '화이트', '아이보리', '베이지', '갈색', '브라운', '카멜',
  '남색', '네이비', '파란', '블루', '하늘', '빨간', '레드', '와인', '버건디', '분홍', '핑크',
  '금색', '골드', '금장', '은색', '실버', '은장', '회색', '그레이', '카키', '초록', '그린',
  '노란', '옐로우', '보라', '퍼플', '오렌지', '데님', '하양', '하얀', '검은색', '흰색',
]

const flat = (s) => (s || '').replace(/\s+/g, '')

// 질의는 공백을 지워 비교하는데 브랜드명은 원문 그대로 비교하고 있었다.
// 그래서 "메종 키츠네"처럼 이름에 공백이 있는 브랜드 18개가 전부 인식되지 않았다.
// (메종 키츠네 / 조 말론 런던 / 에스티 로더 / 바비 브라운 / 무신사 스탠다드 …)
const BRAND_FLAT = new Map(BRANDS.map((b) => [b, flat(b)]))

function detectBrands(text) {
  const t = flat(text)
  return BRANDS.filter(
    (b) => t.includes(BRAND_FLAT.get(b)) || (BRAND_ALIASES[b] || []).some((a) => t.includes(flat(a)))
  )
}
const detectBrand = (text) => detectBrands(text)[0]

/**
 * 예산 파싱 — "10만원 이하", "5만원대", "10~20만원", "3만원 안으로" 등.
 * (실사용 앱 리뷰에서 가장 많은 불만이 "예산을 말해도 무시한다"였다 —
 *  예산은 모델 판단에 맡기지 않고 서버가 필터로 강제한다)
 */
const bandStep = (n) => (n % 10 === 0 ? 10 : 1) // 10만원대=10~20만, 15만원대=15~16만
export function parseBudget(text) {
  const t = text.replace(/\s+/g, '')
  let m
  // "10~20만원(대)" — 앞 숫자의 '만'은 흔히 생략된다
  if ((m = t.match(/(\d+(?:\.\d+)?)(?:만원?)?[~-](\d+(?:\.\d+)?)만원?(대)?/))) {
    const hiN = Number(m[2])
    return {
      min: Number(m[1]) * 10000,
      max: m[3] ? (hiN + bandStep(hiN)) * 10000 - 1 : hiN * 10000,
    }
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)만원?(이하|아래|미만|안으로|이내|밑으로|안쪽)/))) {
    return { min: 0, max: Number(m[1]) * 10000 }
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)만원?(이상|넘는|위로)/))) {
    return { min: Number(m[1]) * 10000, max: Infinity }
  }
  if ((m = t.match(/(\d+)만원?대/))) {
    const n = Number(m[1])
    return { min: n * 10000, max: (n + bandStep(n)) * 10000 - 1 }
  }
  return null
}

/** "비슷한 거" — 브랜드 가드를 푸는 의도 / "~말고·대신·대체품" — 언급 브랜드를 제외하는 의도. */
const wantsAlternative = (text) => /비슷한|대체|대신|말고|같은\s*느낌|유사한/.test(text)
const wantsExclusion = (text) => /말고|대신|대체/.test(text)

/** AI가 빈손일 때의 결정론적 백스톱 — 브랜드/카테고리/색상 점수화 상위 3개. */
function keywordFallback(text, pool, distinctive = []) {
  const brand = detectBrand(text)
  const t = flat(text)
  const catHit = CATEGORY_WORDS.find((c) => t.includes(flat(c)))
  if (!brand && !catHit && pool.every((p) => !p.live)) return []

  const base = brand && !wantsAlternative(text) ? pool.filter((p) => p.brand === brand) : pool
  const scored = base.map((p) => {
    const hay = flat(`${p.rawTitle} ${p.tag} ${p.category}`)
    let score = p.live ? 1 : 0 // 라이브 결과는 검색어와 직접 매칭된 것이므로 가산
    // 특징어(스네이크 등)가 제목에 있으면 강하게 가산
    for (const w of distinctive) if (hay.includes(flat(w))) score += 4
    if (catHit && p.category === catHit) score += 2
    else if (t.includes('지갑') && p.category.includes('지갑')) score += 1
    else if ((t.includes('가방') || t.includes('백')) && ['숄더백', '토트백', '크로스백', '클러치', '백팩'].includes(p.category)) score += 1
    for (const c of COLOR_WORDS) if (t.includes(c) && hay.includes(c)) score += 1
    if (p.model && t.includes(flat(p.model))) score += 3
    return { p, score }
  })
  scored.sort((a, b) => b.score - a.score || a.p.price - b.p.price)
  return scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.p)
}

const SYSTEM_PROMPT = `너는 쇼핑 앱 '쇼포트'의 AI 쇼핑 에이전트야. 고객은 한국의 35-50세 여성이고, 명품·패션·뷰티·생활·가전·식품을 찾는다. 정확한 상품명을 기억하지 못한 채 특징(브랜드, 색, 크기, 용도, 예산)으로 설명하는 경우가 많다.

너의 일: 아래 [상품 목록]에서 고객 요청과 가장 맞는 상품을 골라주는 것.

절대 규칙:
1. 반드시 목록에 있는 id만 고른다. 목록에 없는 상품을 지어내지 마라.
2. **후보 우선**: 고객이 말한 브랜드나 종류가 목록에 있으면 matchedIds를 절대 비우지 마라. 완벽히 일치하지 않아도 가장 가까운 후보 1~3개를 골라라.
   고객이 브랜드를 말했다면 후보는 그 브랜드여야 한다. 단, "비슷한 거/대체품/~말고"처럼 다른 브랜드를 원하는 요청이면 예외다.
3. 고객이 말한 조건(예산·색·용량·용도)에 맞는 상품만 골라라. 못 맞추는 조건이 있으면 그 상품을 후보에서 빼라.
4. 질문은 대화 전체에서 **최대 한 번**, 그것도 후보를 함께 제시한 채로만. followUpOptions에 탭할 선택지 2~4개(각 8자 이내). 이미 물었다면 다시 묻지 말고 확정해라.
5. 가격·시세·비교에 대해 아무것도 쓰지 마라 — 숫자도, 비교가 가능한지 불가능한지도. 비교는 카드가 보여준다.
6. 말투: 따뜻한 한국어 존댓말, **최대 2문장**, 쉬운 말.
7. **matchedIds가 비어 있지 않으면 "없다/어렵다/찾지 못했다"고 쓰지 마라.** 후보를 보여주면서 동시에 없다고 말하는 것은 모순이다.
   목록에 그 브랜드·종류가 하나도 없을 때만 없다고 말하고, 그때는 matchedIds를 비워라.
   (목록에는 실시간 검색 결과도 포함되어 있다 — '라이브' 표시)

반드시 아래 JSON 형식으로만 답한다:
{"reply": "고객에게 할 말", "matchedIds": ["id1","id2"], "followUpQuestion": "질문 또는 null", "followUpOptions": ["선택지"] }`

/**
 * 라이브 검색용 LLM 키워드 추출 — 규칙 기반 한국어 파싱의 한계(대화체 변형 무한)를
 * 초경량 모델 호출로 대체한다. 실패하면 규칙 기반으로 폴백.
 * ('사카이랑 콜라보한거고' → keyword "나이키 사카이 운동화", features ["사카이","콜라보"])
 */
const kwCache = new Map()
async function llmKeyword(apiKey, history) {
  const key = history.map((m) => m.content).join('|').slice(-400)
  const hit = kwCache.get(key)
  if (hit) return hit
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 80,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '대화에서 고객이 지금 찾는 상품의 쇼핑몰 검색어를 추출해라. JSON만 답한다: {"keyword":"쇼핑몰 검색창에 입력할 2~5단어 (브랜드·콜라보·모델·종류 우선, 감탄사·조사 금지)","features":["콜라보 상대·라인·모델명 등 이 상품만 구별하는 고유 단어 1~3개 (색상·소재·일반명사 금지)"]}',
          },
          { role: 'user', content: history.slice(-4).map((m) => `${m.role === 'user' ? '고객' : '비서'}: ${m.content}`).join('\n') },
        ],
      }),
      signal: AbortSignal.timeout(3500),
    })
    if (!r.ok) return null
    const d = await r.json()
    const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}')
    const out =
      typeof parsed.keyword === 'string' && parsed.keyword.trim().length >= 2
        ? { keyword: parsed.keyword.trim().slice(0, 60), features: (Array.isArray(parsed.features) ? parsed.features : []).filter((f) => typeof f === 'string').slice(0, 4) }
        : null
    if (out) kwCache.set(key, out)
    return out
  } catch {
    return null // 추출 실패는 치명적이지 않다 — 규칙 기반으로 폴백
  }
}

/**
 * 물건의 큰 갈래.
 *
 * "니트"를 찾는데 "가디건"이 나오는 것은 가까운 대안이지만,
 * "슬리퍼"를 찾는데 "반지갑"이 나오는 것은 그냥 다른 물건이다.
 * 앞은 보여주고 뒤는 막기 위해, 카테고리보다 한 단계 위의 갈래로 비교한다.
 *
 * 카탈로그에 없는 종류(슬리퍼·샌들 등)도 넣어둔다 —
 * "우리가 안 파는 물건"을 인식해야 정직하게 답할 수 있다.
 */
const DOMAIN = {
  신발: ['운동화', '스니커즈', '로퍼', '구두', '슬리퍼', '샌들', '부츠', '신발'],
  지갑: ['카드지갑', '반지갑', '장지갑', '카드홀더', '지갑'],
  가방: ['숄더백', '토트백', '크로스백', '클러치', '백팩', '가방'],
  상의: ['맨투맨', '후드티', '티셔츠', '블라우스', '가디건', '니트', '셔츠'],
  하의: ['청바지', '슬랙스', '스커트', '바지'],
  아우터: ['자켓', '재킷', '코트', '패딩'],
  뷰티: ['선크림', '립스틱', '세럼', '쿠션', '토너', '수분크림', '아이크림', '클렌징폼',
        '향수', '샴푸', '트리트먼트', '바디로션', '핸드크림'],
  생활: ['세탁세제', '주방세제', '프라이팬', '밀폐용기', '수세미', '텀블러', '휴지'],
}

/** 문장에서 물건의 갈래를 찾는다. 긴 단어부터 봐야 '카드지갑'이 '지갑'보다 먼저 잡힌다. */
export function wantedType(text) {
  const f = flat(text)
  for (const [domain, words] of Object.entries(DOMAIN)) {
    const word = [...words].sort((a, b) => b.length - a.length).find((w) => f.includes(w))
    if (word) return { domain, word }
  }
  return null
}

/** 요청한 갈래의 상품이 후보에 하나도 없으면, 그건 '가까운 상품'이 아니라 다른 물건이다. */
export function typeMismatch(userText, matched) {
  const want = wantedType(userText)
  if (!want || matched.length === 0) return null
  const hit = matched.some((p) => wantedType(`${p.category} ${p.name}`)?.domain === want.domain)
  return hit ? null : want
}

// 고객이 쓰는 상위어 ↔ 카탈로그 카테고리.
// 카탈로그에는 '숄더백'만 있고 '가방'은 없어서, 상위어로 물으면 후보가 비었다.
const META_CATEGORY = {
  가방: ['숄더백', '토트백', '크로스백', '클러치', '백팩'],
  지갑: ['카드지갑', '반지갑', '장지갑'],
  신발: ['운동화', '로퍼'],
  상의: ['니트', '가디건', '블라우스', '맨투맨', '후드티'],
  하의: ['청바지', '슬랙스', '스커트'],
  아우터: ['자켓', '코트', '가디건'],
  화장품: ['선크림', '립스틱', '세럼', '쿠션', '토너', '수분크림', '아이크림', '클렌징폼'],
  스킨케어: ['세럼', '토너', '수분크림', '아이크림', '클렌징폼', '선크림'],
}

/** 1단계 검색: 브랜드·카테고리·예산으로 정적 카탈로그를 좁힌다. */
export function buildStaticPool(text, budget) {
  const t = flat(text)
  const brands = detectBrands(text)
  const alt = wantsAlternative(text)
  const cats = new Set(CATEGORY_WORDS.filter((c) => t.includes(flat(c))))
  for (const [meta, list] of Object.entries(META_CATEGORY)) {
    if (t.includes(meta)) list.forEach((c) => cats.add(c))
  }

  const excl = wantsExclusion(text)
  let pool
  if (brands.length > 0 || cats.size > 0) {
    pool = CATALOG.filter(
      (p) =>
        (brands.length === 0 || (excl ? !brands.includes(p.brand) : alt || brands.includes(p.brand))) &&
        (cats.size === 0 || cats.has(p.category))
    )
    if (pool.length === 0 && brands.length > 0 && !alt) pool = CATALOG.filter((p) => brands.includes(p.brand))
    if (pool.length === 0 && cats.size > 0) pool = CATALOG.filter((p) => cats.has(p.category))
  } else {
    const seen = new Map()
    pool = CATALOG.filter((p) => {
      const k = `${p.brand}|${p.category}`
      const n = seen.get(k) || 0
      if (n >= 2) return false
      seen.set(k, n + 1)
      return true
    })
  }
  if (budget) {
    const inBudget = pool.filter((p) => p.price >= budget.min && p.price <= budget.max)
    if (inBudget.length >= 3) pool = inBudget // 예산 안 후보가 충분하면 예산 안만 보여준다
  }
  return pool.slice(0, 300)
}

const catalogBlock = (pool) =>
  pool
    .map(
      (p) =>
        `${p.id}|${p.brand}|${p.category}|${p.model || '-'}|${p.seller}${p.live ? '|라이브' : ''}|${p.price}원|${p.rawTitle.slice(0, 42)}`
    )
    .join('\n')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' })

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
  const lastUser = history.filter((m) => m.role === 'user').slice(-1)[0]?.content || ''
  const userTurns = history.filter((m) => m.role === 'user').length
  const budget = parseBudget(userText)

  // --- 1단계: 정적 카탈로그 검색 ---
  let pool = buildStaticPool(userText, budget)

  // --- 2단계: 라이브 검색 ---
  const brands = detectBrands(userText)
  // '특징어' = 브랜드·카테고리·색상을 뺀 나머지 상품 특징 (예: 스네이크, 킹스네이크, 오블리크)
  const brandWords = new Set(brands.flatMap((b) => [b, ...(BRAND_ALIASES[b] || [])]).map(flat))
  const distinctive = cleanTokens(`${lastUser} ${userText}`).filter(
    (w) =>
      !brandWords.has(flat(w)) &&
      !CATEGORY_WORDS.some((c) => flat(w).includes(flat(c)) || flat(c).includes(flat(w))) &&
      !['가방', '지갑', '신발', '남성', '여성', '남자', '여자', '어떤', '스타일'].includes(w) &&
      !COLOR_WORDS.some((c) => w.startsWith(c))
  )
  // 특징어가 정적 풀 제목에 하나도 없다 = 카탈로그로는 못 찾는 요청 → 풀이 커도 라이브 강제
  let distinctiveFinal = distinctive
  // 특징어 '하나라도' 정적 풀이 못 커버하면 라이브 검색 필요 (사카이는 없는데 '신발'만
  // 우연히 제목에 있다고 라이브를 건너뛰던 논리 오류를 실사용 재현으로 확인 후 수정)
  const distinctiveMiss = distinctive.some(
    (w) => !pool.some((p) => flat(p.rawTitle).includes(flat(w)))
  )
  const staticWeak = pool.length < 12 || (brands.length === 0 && pool.length >= 200) || distinctiveMiss
  let liveItems = []
  if (staticWeak) {
    try {
      // 1순위: LLM 키워드 추출 / 폴백: 규칙 조립.
      // 쇼핑몰 검색 엔진은 검색어가 길면 0건을 내므로, 결과가 나올 때까지
      // 점점 짧은 변형으로 재시도한다 (캐스케이드).
      const ext = await llmKeyword(apiKey, history)
      if (ext?.features?.length) distinctiveFinal = [...new Set([...ext.features, ...distinctive])]
      const catHit = CATEGORY_WORDS.find((c) => flat(userText).includes(flat(c)))
      const feat = ext?.features?.[0] || distinctive[0]
      const variants = []
      if (ext?.keyword) {
        // "나이키 사카이 콜라보 운동화" → 0건이면 "나이키 사카이 콜라보" → "나이키 사카이" 순으로 축약
        const kws = ext.keyword.split(/\s+/).slice(0, 4)
        for (let n = kws.length; n >= 2; n--) variants.push(kws.slice(0, n).join(' '))
      }
      if (brands[0] && feat) {
        if (catHit) variants.push([brands[0], feat, catHit].join(' '))
        variants.push([brands[0], feat].join(' '))
      } else if (feat && catHit) {
        variants.push([feat, catHit].join(' '))
      }
      variants.push(extractKeyword(lastUser) || extractKeyword(userText))
      const includeDanawa = brands.length > 0 || pool.length < 5
      // 특징어(사카이 등)가 실제로 포함된 결과를 낸 변형을 우선한다 —
      // 범용 결과("나이키 신발")로 조기 종료하면 정작 찾던 상품을 놓친다
      let generic = []
      if (process.env.DEBUG_LIVE) console.warn('[live] ext=', JSON.stringify(ext), 'variants=', variants, 'distinctive=', distinctiveFinal)
      for (const kw of [...new Set(variants)].filter((k) => k && k.length >= 2)) {
        const items = await liveSearch(kw, { includeDanawa })
        if (process.env.DEBUG_LIVE) console.warn('[live]', kw, '→', items.length, '건')
        if (items.length === 0) continue
        // 색상은 어느 상품에나 흔해 판정에서 제외 — 사카이·콜라보 같은 강특징만 본다
        const strong = distinctiveFinal.filter((w) => !COLOR_WORDS.some((c) => w.startsWith(c) || c.startsWith(w)))
        const featHit =
          strong.length === 0 ||
          strong.some((w) => items.some((p) => flat(p.rawTitle).includes(flat(w))))
        if (featHit) {
          liveItems = items
          break
        }
        if (generic.length === 0) generic = items
      }
      if (liveItems.length === 0) liveItems = generic
      if (budget) {
        const inBudget = liveItems.filter((p) => p.price >= budget.min && p.price <= budget.max)
        if (inBudget.length >= 2) liveItems = inBudget
      }
      if (liveItems.length > 0) pool = [...liveItems, ...pool].slice(0, 300)
    } catch (e) {
      console.warn('live search failed', String(e).slice(0, 120)) // 라이브 실패는 치명적이지 않다
    }
  }

  const chatMessages = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n[상품 목록] (질문과 관련된 것만 추림. 가격은 참고용 — reply에서 언급 금지)\nid|브랜드|종류|모델|판매처|가격|상품명\n${catalogBlock(pool)}`,
    },
    ...history,
  ]
  if (userTurns >= 2) {
    chatMessages.push({
      role: 'system',
      content: '고객이 이미 추가 정보를 주었다. 이번 턴에는 절대 되묻지 말고(followUpQuestion=null) 지금까지의 정보로 후보를 확정해라.',
    })
  }
  if (budget) {
    chatMessages.push({
      role: 'system',
      content: `고객 예산: ${budget.min.toLocaleString()}원 ~ ${budget.max === Infinity ? '무제한' : budget.max.toLocaleString() + '원'}. 이 범위의 상품을 우선 골라라.`,
    })
  }

  try {
    const callOpenAI = () =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          // 220으로 조였더니 JSON이 중간에 잘려 파싱이 깨지고 502가 나갔다("예쁜 가방" 등).
          // 길이 제한은 아래 reply.slice가 담당하므로, 여기서는 JSON이 온전히 끝날 여유를 준다.
          max_tokens: 500,
          messages: chatMessages,
        }),
      })

    let completion = await callOpenAI()
    if (completion.status === 429) {
      await new Promise((r) => setTimeout(r, 2500))
      completion = await callOpenAI()
    }
    if (!completion.ok) {
      const detail = await completion.text()
      console.error('OpenAI error', completion.status, detail.slice(0, 400))
      return res.status(502).json({
        error:
          completion.status === 429
            ? '지금 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.'
            : 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
      })
    }

    const data = await completion.json()
    const rawContent = data.choices?.[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      // JSON이 잘려도 사용자에게 오류 화면을 주지 않는다.
      // 잘린 문자열에서 matchedIds라도 건져내고, 없으면 아래 키워드 백스톱이 후보를 채운다.
      // (max_tokens를 220으로 조였을 때 이 경로로 502가 나갔었다)
      console.error('JSON parse 실패 — 부분 복구 시도:', rawContent.slice(0, 200))
      const ids = [...rawContent.matchAll(/"([a-zA-Z0-9_-]{4,})"/g)]
        .map((m) => m[1])
        .filter((s) => s !== 'reply' && s !== 'matchedIds' && s !== 'followUpQuestion' && s !== 'followUpOptions')
      parsed = { reply: '', matchedIds: ids.slice(0, 3) }
    }

    const liveById = new Map(liveItems.map((p) => [p.id, p]))
    const lookup = (id) => byId.get(id) || liveById.get(id)

    let matched = [...new Set((Array.isArray(parsed.matchedIds) ? parsed.matchedIds : []).map(String))]
      .slice(0, 3)
      .map(lookup)
      .filter(Boolean)

    // 브랜드 가드 — "말고/대신"이면 언급 브랜드를 제외, "비슷한"이면 모두 허용
    if (brands.length > 0) {
      if (wantsExclusion(userText)) matched = matched.filter((p) => !brands.includes(p.brand))
      else if (!wantsAlternative(userText)) matched = matched.filter((p) => brands.includes(p.brand))
    }
    // 예산 가드 — 예산을 말했는데 범위 밖 상품만 남는 것을 막는다
    if (budget) {
      const inBudget = matched.filter((p) => p.price >= budget.min && p.price <= budget.max)
      if (inBudget.length > 0) matched = inBudget
      else {
        const alt = pool
          .filter((p) => p.price >= budget.min && p.price <= budget.max)
          .sort((a, b) => a.price - b.price)
          .slice(0, 3)
        if (alt.length > 0) matched = alt
      }
    }

    let reply = typeof parsed.reply === 'string' ? parsed.reply : '조금 더 자세히 말씀해 주시겠어요?'
    if (matched.length === 0) {
      const fallback = keywordFallback(userText, pool, distinctiveFinal)
      if (fallback.length > 0) {
        matched = fallback
        // 덧붙이면 "없습니다 … 보여드릴게요"라는 모순이 된다. 통째로 교체한다.
        reply = '딱 맞는 건 못 찾았지만, 가장 가까운 상품으로 골라봤어요.'
      }
    }

    // 요청한 갈래의 상품이 하나도 없으면 후보를 비운다.
    // "슬리퍼"를 물었는데 반지갑을 보여주는 것은 '가까운 상품'이 아니라 다른 물건이고,
    // 그걸 보여주는 순간 이 서비스의 신뢰가 무너진다.
    const mismatch = typeMismatch(userText, matched)
    if (mismatch) {
      // 후보는 틀렸지만 풀에는 요청한 갈래가 남아 있을 수 있다.
      // (특히 실시간 검색 결과 — AI가 정적 카탈로그 쪽만 고른 경우)
      const salvage = pool
        .filter((p) => wantedType(`${p.category} ${p.name}`)?.domain === mismatch.domain)
        .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || a.price - b.price)
        .slice(0, 3)
      if (salvage.length > 0) {
        matched = salvage
        reply = '말씀하신 조건에 가까운 상품으로 골라봤어요.'
      } else {
        matched = []
        // 실시간 검색도 하므로 "안 판다"가 아니라 "지금 못 찾았다"가 정확하다.
        reply = `${mismatch.word}는 지금 찾지 못했어요. 다른 브랜드나 종류로 찾아드릴까요?`
      }
    }

    // 후보를 보여주면서 "없다"고 말하는 모순 차단.
    // 단, 위에서 실제로 없다고 판정한 경우는 모순이 아니라 사실이므로 건드리지 않는다.
    if (!mismatch && matched.length > 0 && /(없|어렵|못 찾|찾지 못)/.test(reply)) {
      reply = '말씀하신 조건에 가까운 상품으로 골라봤어요.'
    }
    // 규칙 6(최대 2문장)의 코드 보증 — 모델이 길게 쓰면 잘라낸다.
    if (reply.length > 120) reply = reply.slice(0, 118).replace(/[,\s]+$/, '') + '…'

    const followUpQuestion =
      userTurns < 2 && typeof parsed.followUpQuestion === 'string' && parsed.followUpQuestion.trim()
        ? parsed.followUpQuestion
        : null
    const followUpOptions =
      followUpQuestion && Array.isArray(parsed.followUpOptions)
        ? parsed.followUpOptions.filter((o) => typeof o === 'string' && o.trim()).slice(0, 4).map((o) => o.slice(0, 12))
        : []

    // 인텔: 라이브 결과가 섞였으면 병합 컬렉션 기준으로 계산
    const collection = liveItems.length > 0 ? [...CATALOG, ...liveItems] : null
    const products = matched.map((p) => ({
      ...p,
      priceIntel: collection ? intelWithin(collection, p) : priceIntel(p),
    }))

    return res.status(200).json({
      reply,
      followUpQuestion,
      followUpOptions,
      products,
      catalogSize: CATALOG.length,
      liveCount: liveItems.length, // 프론트 상태행: "실시간 검색 N건 포함"
      budget,
    })
  } catch (err) {
    console.error('chat handler failed', err)
    return res.status(500).json({ error: '일시적인 오류가 발생했습니다. 다시 시도해 주세요.' })
  }
}

// ---- self-check: node api/chat.js ----
if (process.argv[1]?.endsWith('chat.js')) {
  const { strict: assert } = await import('node:assert')
  assert.deepEqual(parseBudget('10만원 이하로'), { min: 0, max: 100000 })
  assert.deepEqual(parseBudget('10~20만원대 원피스'), { min: 100000, max: 299999 })
  assert.deepEqual(parseBudget('20만원대 가방'), { min: 200000, max: 299999 })
  assert.deepEqual(parseBudget('5만원대 선크림'), { min: 50000, max: 59999 })
  assert.deepEqual(parseBudget('30만원 이상'), { min: 300000, max: Infinity })
  assert.equal(parseBudget('예산 얘기 없음'), null)
  assert.ok(wantsAlternative('샤넬 말고 비슷한 거'), '대체 의도 감지')
  const poolX = buildStaticPool('샤넬 가방 말고 비슷한 느낌 가방', null)
  assert.ok(poolX.length > 0 && poolX.every((p) => p.brand !== '샤넬'), "'말고'는 언급 브랜드 제외")

  const pool1 = buildStaticPool('샤넬 가방 검정', null)
  assert.ok(pool1.length > 0 && pool1.every((p) => p.brand === '샤넬'), '브랜드 풀')
  const pool2 = buildStaticPool('검정 원피스 10만원 아래로', { min: 0, max: 100000 })
  assert.ok(pool2.length > 0 && pool2.every((p) => p.category === '원피스' && p.price <= 100000), '카테고리+예산 풀')
  const fb = keywordFallback('수분크림 추천', buildStaticPool('수분크림 추천', null))
  assert.ok(fb.length > 0 && fb.every((p) => p.category === '수분크림'), '카테고리 백스톱')
  const { cleanTokens: ct } = await import('./_live.js')
  const toks = ct('아니야아니야 내가 원하는건 구찌 남성 반지갑인데 스네이크가 중간에 그려진거야')
  assert.ok(toks.includes('스네이크'), '특징어 스네이크 추출: ' + toks.join(','))
  assert.ok(!toks.includes('아니야아니야') && !toks.includes('중간에'), '대화체 오염 제거')
  console.log('✓ chat 정책 OK — 예산 파서 5케이스 / 대체의도 / 정적 풀 / 백스톱 / 특징어 추출[' + toks.join(',') + ']')
}
