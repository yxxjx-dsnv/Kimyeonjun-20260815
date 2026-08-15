import { useState, useRef, useEffect } from 'react'

const EXAMPLES = [
  '디올 지갑인데 베이지 바탕에 남색 패턴이 깔려 있고, 카드 넣는 얇은 거였어',
  '샤넬 가방인데 검정 누빔에 금색 체인 달린 거… 어깨에 메는 거야',
  '루이비통 장지갑, 갈색 바탕에 로고가 촘촘하게 박힌 거 찾아줘',
]

const won = (n) => `${n.toLocaleString('ko-KR')}원`

/** 같은 모델 매물들 사이에서 이 가격이 어디쯤인지 보여준다. */
function PriceIntel({ intel, price }) {
  const [open, setOpen] = useState(false)
  const cheaper = intel.discountPct > 0
  // 최저~최고 구간에서 현재 가격의 위치(%)
  const span = intel.max - intel.min
  const dotLeft = span > 0 ? ((price - intel.min) / span) * 100 : 50

  return (
    <div className="intel">
      <div className="intel__headline">
        {intel.isModelLevel ? '같은 모델' : '같은 브랜드·종류'} 매물 {intel.count}건 기준{' '}
        {cheaper ? (
          <>
            시세({won(intel.median)})보다 <b>{intel.discountPct}% 저렴</b>
          </>
        ) : (
          <>
            시세({won(intel.median)})보다 <b className="over">{Math.abs(intel.discountPct)}% 비쌈</b>
          </>
        )}
      </div>

      <div className="intel__bar">
        <span className="intel__dot" style={{ left: `${Math.min(100, Math.max(0, dotLeft))}%` }} />
      </div>
      <div className="intel__scale">
        <span>최저 {won(intel.min)}</span>
        <span>최고 {won(intel.max)}</span>
      </div>

      {intel.peers.length > 0 && (
        <>
          <button className="intel__toggle" onClick={() => setOpen(!open)}>
            {open ? '가격 비교 접기' : `다른 매물 ${intel.peers.length}건과 가격 비교`}
          </button>
          {open && (
            <ul className="peers">
              {intel.peers.map((p) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.verified ? '✓ ' : ''}
                    {p.name}
                  </a>
                  <b>{won(p.price)}</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function ProductCard({ product }) {
  const intel = product.priceIntel
  return (
    <article className="card">
      <div className="card__main">
        {product.image && (
          <img className="card__thumb" src={product.image} alt={product.name} loading="lazy" />
        )}
        <div className="card__body">
          <div className="card__brand">{product.brand}</div>
          <h3 className="card__name">{product.name}</h3>
          <div className="card__price">{won(product.price)}</div>
          <div className="card__tags">
            {product.category !== '기타' && <span className="tag">{product.category}</span>}
            {product.verified && <span className="tag tag--verified">정품 검수 가능</span>}
            {intel?.rank === 1 && <span className="tag tag--deal">이 모델 최저가</span>}
            {product.location && <span className="tag">{product.location.split(' ')[0]}</span>}
          </div>
        </div>
      </div>

      {intel && <PriceIntel intel={intel} price={product.price} />}

      <a className="card__cta" href={product.url} target="_blank" rel="noreferrer">
        {product.seller}에서 보기 →
      </a>
    </article>
  )
}

export default function App() {
  const [turns, setTurns] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, loading])

  async function send(text) {
    const question = text.trim()
    if (!question || loading) return

    const next = [...turns, { role: 'user', content: question }]
    setTurns(next)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 서버에는 대화 내용만 보낸다 (상품 카드는 서버가 다시 붙여준다)
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.')

      setTurns([
        ...next,
        {
          role: 'assistant',
          content: data.reply,
          products: data.products || [],
          followUpQuestion: data.followUpQuestion,
        },
      ])
    } catch (err) {
      setError({ message: err.message, retry: question })
      setTurns(next)
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>
          그거 <span>있잖아</span>
        </h1>
        <p>이름은 몰라도 괜찮아요. 기억나는 대로 말해보세요.</p>
      </header>

      <main className="thread">
        {turns.length === 0 && (
          <div className="intro">
            <p className="intro__lead">
              “아 그거… <strong>디올에서 나온 건데</strong>, 베이지에 남색 무늬 있는 얇은 지갑”
              <br />
              이렇게만 말해도 찾아드려요. 찾아드린 매물이 <strong>시세보다 싼지</strong>도 같이
              알려드릴게요.
            </p>
            <p className="intro__label">이렇게 물어보세요</p>
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="chip"
                  onClick={() => {
                    setInput(ex)
                    inputRef.current?.focus()
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`turn turn--${turn.role === 'user' ? 'user' : 'ai'}`}>
            <div className={`bubble bubble--${turn.role === 'user' ? 'user' : 'ai'}`}>
              {turn.content}
              {turn.followUpQuestion && <div className="followup">{turn.followUpQuestion}</div>}
            </div>
            {turn.products?.length > 0 && (
              <div className="cards">
                {turn.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="status">
            찾고 있어요
            <span className="dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}

        {error && (
          <div className="status status--error">
            {error.message}
            <button onClick={() => send(error.retry)}>다시 시도</button>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="예) 검정 가죽에 금색 잠금장식 달린 샤넬 반지갑"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="찾는 물건 설명"
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()}>
          찾기
        </button>
      </div>
      <p className="foot">번개장터 중고 명품 매물을 수집해 만든 데모입니다.</p>
    </div>
  )
}
