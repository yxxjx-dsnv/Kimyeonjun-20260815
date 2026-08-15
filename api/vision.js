/**
 * POST /api/vision — 사진으로 상품 찾기.
 * 프론트에서 리사이즈한 이미지(dataURL)를 받아 gpt-4o-mini Vision으로
 * "검색 가능한 한국어 상품 묘사 문장"을 만들어 돌려준다.
 * 이미지는 저장하지 않으며, 반환된 문장이 일반 검색 플로우(/api/chat)로 이어진다.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' })
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' })

  const { image } = req.body || {}
  if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 1_500_000) {
    return res.status(400).json({ error: '이미지를 다시 선택해 주세요. (최대 1MB)' })
  }

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              '사진 속 상품을 쇼핑 검색어로 묘사해라. 형식: 한국어 한 문장, "브랜드(보이면)+종류+색상+특징+찾아줘". 브랜드가 안 보이면 추측하지 말 것. 상품이 아니면 "상품을 찾지 못했어요"라고만 답해라.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '이 상품을 검색 문장으로 묘사해줘.' },
              { type: 'image_url', image_url: { url: image, detail: 'low' } },
            ],
          },
        ],
      }),
    })
    if (!completion.ok) {
      console.error('vision error', completion.status, (await completion.text()).slice(0, 300))
      return res.status(502).json({ error: '사진 분석에 실패했어요. 다시 시도해 주세요.' })
    }
    const data = await completion.json()
    const query = (data.choices?.[0]?.message?.content || '').trim()
    if (!query || query.includes('찾지 못했')) {
      return res.status(422).json({ error: '사진에서 상품을 찾지 못했어요. 상품이 잘 보이게 찍어주세요.' })
    }
    return res.status(200).json({ query })
  } catch (err) {
    console.error('vision handler failed', err)
    return res.status(500).json({ error: '일시적인 오류가 발생했습니다.' })
  }
}
