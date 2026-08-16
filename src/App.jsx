import { useState, useRef, useEffect, useMemo } from 'react'
import { buildIndex, instantSearch } from './instant.js'

/* 홈 2×2 선택지 — 탭하면 즉시 실행 (실제 쇼포트 동작과 동일) */
const won = (n) => `${n.toLocaleString('ko-KR')}원`
const FAV_KEY = 'ggij:favs'
const SESSION_KEY = 'ggij:sessions'
const SELLER_TINT = {
  '다나와 최저가': '#16a34a', '29CM': '#111827', 무신사: '#2563eb', 컬리: '#7c3aed', KREAM: '#0d0d0d',
}

/* ---------- 아이콘 ---------- */
const svg = (path, extra = null) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
    {extra}
  </svg>
)
const I = {
  menu: svg(<path d="M4 6.5h16M4 12h16M4 17.5h16" />),
  home: svg(<path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" />),
  compass: svg(<circle cx="12" cy="12" r="9" />, <path d="m15.5 8.5-2.2 5-5 2.2 2.2-5z" />),
  back: svg(<path d="M14.5 5.5 8 12l6.5 6.5" />),
  edit: svg(<path d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17Z" />, <path d="M13.5 6.5l3 3" />),
  heart: (filled) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.3S4 15 4 9.6A4.4 4.4 0 0 1 8.4 5c1.5 0 2.9.8 3.6 2A4.2 4.2 0 0 1 15.6 5 4.4 4.4 0 0 1 20 9.6c0 5.4-8 10.7-8 10.7Z" />
    </svg>
  ),
  camera: svg(<path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />, <circle cx="12" cy="13" r="3.4" />),
  send: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M6.5 4.8c-1-.6-2.2.4-1.8 1.5l1.9 5.2c.1.3.4.5.7.5h5.2c.6 0 .6.9 0 .9H7.3c-.3 0-.6.2-.7.5l-1.9 5.2c-.4 1.1.8 2.1 1.8 1.5l13-7.6c.9-.5.9-1.8 0-2.3Z" />
    </svg>
  ),
}

/* ---------- 사진 → 검색 문장 (리사이즈 후 /api/vision) ---------- */
async function imageToQuery(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 768 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.query) throw new Error(data.error || '사진 분석에 실패했어요.')
  return data.query
}

function PhotoButton({ className, onQuery, onError }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button
        className={className}
        onClick={() => ref.current?.click()}
        disabled={busy}
        aria-label="사진으로 찾기"
      >
        {busy ? <span className="spin" aria-hidden="true" /> : I.camera}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            onQuery(await imageToQuery(file))
          } catch (err) {
            onError(err.message)
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

/* ---------- 시세 분포 ---------- */
function MarketRange({ intel, price }) {
  const s = intel.stats
  if (!s) return null
  const span = s.max - s.min
  const left = span > 0 ? ((price - s.min) / span) * 100 : 50
  const group = intel.isModelLevel ? '같은 모델' : '같은 브랜드·종류'
  return (
    <div className="range">
      <div className="range__label">
        {group} {intel.count}건 중{' '}
        {s.medianReliable ? (
          s.discountPct > 0 ? (
            <b className="good">시세보다 {s.discountPct}% 저렴</b>
          ) : s.discountPct === 0 ? (
            <b>시세와 같은 수준</b>
          ) : (
            <b className="over">시세보다 {Math.abs(s.discountPct)}% 비쌈</b>
          )
        ) : (
          <b className={s.rank <= Math.ceil(intel.count / 2) ? 'good' : ''}>{s.rank}번째로 저렴</b>
        )}
      </div>
      <div className="range__bar">
        <span className="range__dot" style={{ left: `${Math.min(100, Math.max(0, left))}%` }} />
      </div>
      <div className="range__scale">
        <span>{won(s.min)}</span>
        <span>{won(s.max)}</span>
      </div>
      {!s.medianReliable && (
        <p className="range__note">상품마다 모델·구성 차이가 커서 평균 시세는 계산하지 않았어요.</p>
      )}
    </div>
  )
}

/* ---------- 상품 카드 ---------- */
function ProductCard({ product, fav, onFav, rank, onCompare }) {
  const intel = product.priceIntel
  return (
    <article className="card">
      <div className="card__main">
        <div className="card__thumbwrap">
          {rank && <span className="rankbadge">{rank}위</span>}
          {product.image ? (
            <img className="card__thumb" src={product.image} alt={product.name} loading="lazy" />
          ) : (
            <div className="card__thumb card__thumb--empty">{product.brand.slice(0, 1)}</div>
          )}
        </div>
        <div className="card__body">
          <div className="card__top">
            <span className="card__brand">{product.brand}</span>
            <button
              className={`favbtn ${fav ? 'is-fav' : ''}`}
              onClick={() => onFav(product.id)}
              aria-label={fav ? '추적 해제' : '가격 추적'}
            >
              {I.heart(fav)}
            </button>
          </div>
          <h3 className="card__name">{product.name}</h3>
          {product.rating && (
            <div className="card__rating">
              ★ {product.rating.toFixed(1)}
              {product.reviewCount ? <span> ({product.reviewCount.toLocaleString()})</span> : null}
            </div>
          )}
          <div className="card__price">{won(product.price)}</div>
          <div className="card__tags">
            <span className="tag">{product.seller}</span>
            {product.live && <span className="tag tag--live">실시간 검색</span>}
            {product.category !== '기타' && <span className="tag">{product.category}</span>}
            {intel?.stats?.rank === 1 && (
              <span className="tag tag--best">{intel.isModelLevel ? '이 모델 최저가' : '이 종류 최저가'}</span>
            )}
          </div>
        </div>
      </div>

      {intel && <div className="ailabel">AI 가격 분석</div>}
      <MarketRange intel={intel || {}} price={product.price} />

      {intel?.peers?.length > 0 && (
        <button className="card__compare" onClick={() => onCompare(product)}>
          가격 비교·판매처 보기 ({intel.peers.length + 1})
        </button>
      )}

      <div className="card__actions">
        <a className="btn btn--ghost" href={product.url} target="_blank" rel="noreferrer">
          상세 보기
        </a>
        <a className="btn btn--solid" href={product.url} target="_blank" rel="noreferrer">
          최저가 구매하기
        </a>
      </div>
    </article>
  )
}

/* ---------- 비교표 ---------- */
function CompareTable({ products }) {
  const rows = [
    ['가격', (p) => won(p.price)],
    ['판매처', (p) => p.seller],
    ['시세 대비', (p) => {
      const s = p.priceIntel?.stats
      if (!s) return '—'
      return s.medianReliable
        ? s.discountPct > 0
          ? `${s.discountPct}% 저렴`
          : s.discountPct === 0
            ? '시세 수준'
            : `${Math.abs(s.discountPct)}% 비쌈`
        : `${p.priceIntel.count}건 중 ${s.rank}위`
    }],
    ['평점', (p) => (p.rating ? `★ ${p.rating.toFixed(1)}` : '—')],
    ['리뷰 수', (p) => (p.reviewCount ? p.reviewCount.toLocaleString() : '—')],
  ]
  return (
    <div className="ctable-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th />
            {products.map((p, i) => (
              <th key={p.id}>
                <span className="ctable__rank">{i + 1}위</span>
                {p.image && <img src={p.image} alt="" loading="lazy" />}
                <span className="ctable__name">{p.name.slice(0, 22)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label}>
              <td>{label}</td>
              {products.map((p) => (
                <td key={p.id}>{fn(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- 질문 카드 ---------- */
function QuestionCard({ turn }) {
  const [picked, setPicked] = useState([])
  const opts = turn.followUpOptions || []
  const toggle = (o) => setPicked((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]))
  if (opts.length === 0)
    return (
      <div className="qcard">
        <div className="qcard__title">{turn.followUpQuestion}</div>
        <p className="qcard__sub">아래 입력창에 편하게 답해주세요.</p>
      </div>
    )
  return (
    <div className="qcard">
      <div className="qcard__title">{turn.followUpQuestion}</div>
      <p className="qcard__sub">해당하는 것을 골라주세요. 직접 입력하셔도 돼요.</p>
      <div className="qcard__opts">
        {opts.map((o) => (
          <button key={o} className={picked.includes(o) ? 'is-on' : ''} onClick={() => toggle(o)}>
            {o}
          </button>
        ))}
      </div>
      <button className="qcard__next" disabled={picked.length === 0} onClick={() => turn.onAnswer(picked.join(', '))}>
        {picked.length > 0 ? '선택 완료' : '선택해주세요'}
      </button>
    </div>
  )
}

/* ---------- 에이전트 응답 턴 ---------- */
function AgentTurn({ turn, favs, toggleFav, onCompare }) {
  const [mode, setMode] = useState('cards')
  const many = (turn.products?.length || 0) >= 2
  return (
    <div className="aturn">
      <div className="statusrow">
        <span className="statusrow__check" aria-hidden="true">✓✓</span>
        결과 정리 완료
        {turn.elapsed && <span className="statusrow__time">{turn.elapsed}s</span>}
        {turn.liveCount > 0 ? (
          <span className="statusrow__chip statusrow__chip--live">실시간 검색 {turn.liveCount}건 포함</span>
        ) : (
          turn.catalogSize && <span className="statusrow__chip">5개 쇼핑몰 · {turn.catalogSize}개 상품</span>
        )}
        {turn.budget && (
          <span className="statusrow__chip">
            예산 {turn.budget.max === null ? '' : `~${Math.round(turn.budget.max / 10000)}만원`} 반영
          </span>
        )}
      </div>
      <p className="atext">{turn.content}</p>

      {many && (
        <div className="viewtabs" role="tablist">
          <button className={mode === 'cards' ? 'is-on' : ''} onClick={() => setMode('cards')}>추천 상품 보기</button>
          <button className={mode === 'table' ? 'is-on' : ''} onClick={() => setMode('table')}>비교표로 보기</button>
        </div>
      )}

      {turn.products?.length > 0 && mode === 'cards' && (
        <div className="cards">
          {turn.products.map((p, pi) => (
            <ProductCard key={p.id} product={p} fav={favs.includes(p.id)} onFav={toggleFav} rank={pi + 1} onCompare={onCompare} />
          ))}
        </div>
      )}
      {turn.products?.length > 0 && mode === 'table' && <CompareTable products={turn.products} />}

      {/* 보유 데이터에서 못 찾았을 때 — '없다'로 끝내지 않고 넓혀 찾을지 묻는다.
          웹까지 뒤지는 것은 느리고 결과 품질도 달라지므로, 고객이 누른 경우에만 한다. */}
      {turn.canBroaden && (
        <div className="broaden">
          <p className="broaden__t">
            보유한 <b>948개 상품</b> 안에서는 찾지 못했어요.
          </p>
          <p className="broaden__s">웹 검색까지 넓혀서 찾아드릴까요? 조금 더 걸립니다.</p>
          <button className="broaden__btn" onClick={turn.onBroaden}>
            웹에서 더 찾아보기
          </button>
        </div>
      )}
      {turn.broadened && turn.products?.length > 0 && (
        <p className="broaden__done">웹 검색까지 넓혀 찾은 결과입니다.</p>
      )}

      {turn.followUpQuestion && <QuestionCard turn={turn} />}
    </div>
  )
}

/* ---------- 인스턴트 검색 패널 (Netflix/네이버식 — 타이핑 즉시) ---------- */
function InstantPanel({ index, query, onPick, onAsk }) {
  const { products, suggestions } = useMemo(
    () => (index && query.trim() ? instantSearch(index, query.trim(), 5) : { products: [], suggestions: [] }),
    [index, query]
  )
  if (!query.trim() || (products.length === 0 && suggestions.length === 0)) return null
  return (
    <div className="instant">
      {suggestions.length > 0 && (
        <div className="instant__sugs">
          {suggestions.map((sg) => (
            <button key={sg} onClick={() => onAsk(sg)}>🔍 {sg}</button>
          ))}
        </div>
      )}
      <ul className="instant__list">
        {products.map((p) => (
          <li key={p.id}>
            <button onClick={() => onPick(p)}>
              {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="instant__noimg">{p.brand.slice(0, 1)}</span>}
              <span className="instant__meta">
                <em>{p.brand} · {p.seller}</em>
                <span>{p.name}</span>
              </span>
              <b>{won(p.price)}</b>
            </button>
          </li>
        ))}
      </ul>
      <p className="instant__hint">상품을 탭하면 가격 비교, 제안을 탭하면 AI 검색으로 이어져요</p>
    </div>
  )
}

/* ---------- AI 찾기 (홈 + 대화) ---------- */
function ChatView({ favs, toggleFav, onCompare, turns, setTurns, goDeals, index }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const heroRef = useRef(null)

  const answerRef = useRef(null)
  useEffect(() => {
    if (turns.length === 0) return
    // 최하단으로 보내면 답변과 상품 카드를 지나쳐 되묻기 카드에 착지한다.
    // 답변이 도착하면 답변 시작 지점에, 그 외에는 하단에 맞춘다.
    const last = turns[turns.length - 1]
    if (last?.role === 'assistant' && answerRef.current) {
      answerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [turns, loading])

  // broaden — 보유 카탈로그에서 못 찾았을 때, 고객이 동의한 경우에만 웹까지 넓혀 찾는다.
  async function send(text, { broaden = false } = {}) {
    const question = text.trim()
    if (!question || loading) return
    const last = turns[turns.length - 1]
    const next =
      last?.role === 'user' && last.content === question ? [...turns] : [...turns, { role: 'user', content: question }]
    setTurns(next)
    setInput('')
    setError(null)
    setLoading(true)
    const t0 = performance.now()
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), broaden }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.reply !== 'string') {
        throw new Error(data.error || '서버 응답에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content: data.reply,
          products: data.products || [],
          followUpQuestion: data.followUpQuestion,
          followUpOptions: data.followUpOptions || [],
          catalogSize: data.catalogSize,
          liveCount: data.liveCount || 0,
          budget: data.budget || null,
          canBroaden: Boolean(data.canBroaden),
          broadened: Boolean(data.broadened),
          askedText: question, // 넓혀 찾기에서 같은 질의를 다시 보내기 위해
          elapsed: ((performance.now() - t0) / 1000).toFixed(1),
          onAnswer: send,
          onBroaden: () => send(question, { broaden: true }),
        },
      ])
    } catch (err) {
      setError({ message: err.message, retry: question })
      setTurns(next)
    } finally {
      setLoading(false)
    }
  }

  const onKey = (e) => {
    // 한글 IME 조합 확정 Enter는 전송이 아니다
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const HOME_CARDS = [
    { icon: '🔍', tint: '#eef4ff', label: ['이름은 몰라도', '서술로 찾기'], run: () => send('디올 지갑인데 베이지 바탕에 남색 패턴 있는 얇은 카드지갑 찾아줘') },
    { icon: '🏷️', tint: '#eafaf1', label: ['예산 안에서', '최저가 찾기'], run: () => send('검정 원피스 10만원 아래로 추천해줘') },
    { icon: '🔥', tint: '#fff2e9', label: ['역대급 최저가', '모아 보기'], run: goDeals },
    { icon: '📷', tint: '#f6efff', label: ['사진으로', '비슷한 상품 찾기'], photo: true },
  ]

  /* ----- 홈 ----- */
  if (turns.length === 0) {
    return (
      <main className="home">
        <span className="blob" aria-hidden="true" />
        <div className="home__headrow">
          <h2 className="home__title">
            구매하고 싶은
            <br />
            상품이 있으신가요?
          </h2>
          <div className="home__cats" aria-hidden="true">
            <span>명품</span>
            <span className="on">▸ 패션</span>
            <span>뷰티</span>
          </div>
        </div>

        <div className="hero">
          <textarea
            ref={heroRef}
            rows={2}
            value={input}
            placeholder="샤넬 가방인데 검정 누빔에 금색 체인 달린 거 찾아줘"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            aria-label="찾는 상품 설명"
          />
          <div className="hero__bar">
            <PhotoButton className="camtile" onQuery={send} onError={(m) => setError({ message: m, retry: null })} />
            <button className="sendbtn" onClick={() => send(input)} disabled={!input.trim()} aria-label="전송">
              {I.send}
            </button>
          </div>
        </div>
        <InstantPanel index={index} query={input} onPick={onCompare} onAsk={send} />
        {error && <div className="errrow">{error.message}</div>}

        <p className="home__label">원하는 질문을 선택해보세요</p>
        <div className="grid2">
          {HOME_CARDS.map((c) =>
            c.photo ? (
              <PhotoCard key="photo" card={c} onQuery={send} onError={(m) => setError({ message: m, retry: null })} />
            ) : (
              <button key={c.label[1]} className="gcard" onClick={c.run}>
                <span className="gcard__icon" style={{ background: c.tint }} aria-hidden="true">{c.icon}</span>
                <span className="gcard__label">
                  {c.label[0]}
                  <br />
                  <b>{c.label[1]}</b>
                </span>
              </button>
            )
          )}
        </div>

      </main>
    )
  }

  /* ----- 대화 ----- */
  return (
    <>
      <main className="thread" aria-live="polite">
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="upill-wrap">
              <span className="upill">{turn.content}</span>
            </div>
          ) : (
            // 마지막 답변 시작 지점에 ref — 결과 도착 시 여기에 스크롤을 맞춘다
            <div key={i} ref={i === turns.length - 1 ? answerRef : null}>
              <AgentTurn turn={{ ...turn, onAnswer: send }} favs={favs} toggleFav={toggleFav} onCompare={onCompare} />
            </div>
          )
        )}

        {loading && <SearchProgress />}
        {error && (
          <div className="errrow">
            {error.message}
            {error.retry && <button onClick={() => send(error.retry)}>다시 시도</button>}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <div className="composer-wrap">
        <InstantPanel index={index} query={input} onPick={onCompare} onAsk={send} />
      </div>
      <div className="composer">
        <PhotoButton className="camtile camtile--sm" onQuery={send} onError={(m) => setError({ message: m, retry: null })} />
        <textarea
          rows={1}
          value={input}
          /* 이전 문구는 한 줄에 안 들어가 두 번째 줄이 잘려 보였다. */
          placeholder="조건을 더 말씀해 주세요"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          aria-label="메세지 입력"
        />
        <button className="sendbtn" onClick={() => send(input)} disabled={loading || !input.trim()} aria-label="전송">
          {I.send}
        </button>
      </div>
    </>
  )
}

function PhotoCard({ card, onQuery, onError }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button className="gcard" onClick={() => ref.current?.click()} disabled={busy}>
        <span className="gcard__icon" style={{ background: card.tint }} aria-hidden="true">
          {busy ? <span className="spin" /> : card.icon}
        </span>
        <span className="gcard__label">
          {card.label[0]}
          <br />
          <b>{busy ? '사진 분석 중…' : card.label[1]}</b>
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            onQuery(await imageToQuery(file))
          } catch (err) {
            onError(err.message)
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

/* ---------- 역대급 최저가 + 추적중 (나침반) ---------- */
function DealsView({ catalog, favs, toggleFav, onOpen, onRetry }) {
  const [tab, setTab] = useState('deals')
  const [group, setGroup] = useState('전체')

  const deals = useMemo(
    () =>
      (catalog.products || [])
        .filter((p) => p.priceIntel?.stats?.medianReliable && p.priceIntel.stats.discountPct >= 10)
        .sort((a, b) => b.priceIntel.stats.discountPct - a.priceIntel.stats.discountPct),
    [catalog.products]
  )
  const groups = useMemo(() => ['전체', ...new Set(deals.map((p) => p.catGroup))], [deals])
  const shown = group === '전체' ? deals : deals.filter((p) => p.catGroup === group)
  const tracked = (catalog.products || []).filter((p) => favs.includes(p.id))

  if (catalog.loading)
    return (
      <main className="browse">
        <div className="grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="mini mini--skeleton" />)}</div>
      </main>
    )
  if (catalog.error)
    return (
      <main className="browse">
        <div className="empty">
          {catalog.error}
          <button className="empty__retry" onClick={onRetry}>다시 불러오기</button>
        </div>
      </main>
    )

  return (
    <main className="browse">
      <div className="dtabs" role="tablist">
        <button className={tab === 'tracked' ? 'is-on' : ''} onClick={() => setTab('tracked')}>추적중 {tracked.length}</button>
        <button className={tab === 'deals' ? 'is-on' : ''} onClick={() => setTab('deals')}>역대급 최저가</button>
      </div>

      {tab === 'deals' && (
        <>
          <div className="deals__head">
            <p className="gradhead">
              같은 상품, 어디가
              <br />더 싼지 알려드릴게요
            </p>
            <p className="deals__sub">🔥 시세보다 크게 싼 상품이에요 · 하트를 누르면 추적 목록에 담겨요</p>
          </div>
          <div className="filters__row filters__row--pad" role="tablist" aria-label="카테고리">
            {groups.map((g) => (
              <button key={g} className={`fchip ${group === g ? 'is-on' : ''}`} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
          <ul className="deals">
            {shown.slice(0, 40).map((p) => (
              <li key={p.id}>
                <button className="deals__hit" onClick={() => onOpen(p)}>
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="deals__noimg">{p.brand.slice(0, 1)}</span>}
                  <span className="deals__meta">
                    <em>{p.brand} · {p.seller}</em>
                    <span className="deals__name">{p.name}</span>
                    <span className="deals__price">
                      {won(p.price)} <i>시세보다 {p.priceIntel.stats.discountPct}%↓</i>
                    </span>
                  </span>
                </button>
                <button className={`favbtn ${favs.includes(p.id) ? 'is-fav' : ''}`} onClick={() => toggleFav(p.id)} aria-label="추적">
                  {I.heart(favs.includes(p.id))}
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <div className="empty">이 카테고리엔 아직 큰 할인 상품이 없어요.</div>}
        </>
      )}

      {tab === 'tracked' && (
        <>
          {tracked.length === 0 ? (
            <div className="empty">
              하트를 눌러 가격을 지켜볼 상품을 담아보세요.
              <br />
              역대급 최저가 탭에서 골라 담을 수 있어요.
            </div>
          ) : (
            <ul className="deals">
              {tracked.map((p) => (
                <li key={p.id}>
                  <button className="deals__hit" onClick={() => onOpen(p)}>
                    {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="deals__noimg">{p.brand.slice(0, 1)}</span>}
                    <span className="deals__meta">
                      <em>{p.brand} · {p.seller}</em>
                      <span className="deals__name">{p.name}</span>
                      <span className="deals__price">
                        {won(p.price)}
                        {p.priceIntel?.stats?.medianReliable && p.priceIntel.stats.discountPct > 0 && (
                          <i>시세보다 {p.priceIntel.stats.discountPct}%↓</i>
                        )}
                      </span>
                    </span>
                  </button>
                  <button className="favbtn is-fav" onClick={() => toggleFav(p.id)} aria-label="추적 해제">
                    {I.heart(true)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}

/* ---------- 찜 그리드 ---------- */
function SavedView({ catalog, favs, toggleFav, onOpen, onRetry }) {
  const shown = (catalog.products || []).filter((p) => favs.includes(p.id))
  if (catalog.loading)
    return (
      <main className="browse">
        <div className="grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="mini mini--skeleton" />)}</div>
      </main>
    )
  if (catalog.error)
    return (
      <main className="browse">
        <div className="empty">
          {catalog.error}
          <button className="empty__retry" onClick={onRetry}>다시 불러오기</button>
        </div>
      </main>
    )
  return (
    <main className="browse">
      <div className="browse__count">찜한 상품 {shown.length}개</div>
      {shown.length === 0 ? (
        <div className="empty">마음에 든 상품을 하트로 저장해 두세요.</div>
      ) : (
        <div className="grid">
          {shown.map((p) => (
            <div key={p.id} className="mini">
              <button className="mini__hit" onClick={() => onOpen(p)} aria-label={`${p.name} 자세히 보기`}>
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="mini__empty">{p.brand.slice(0, 1)}</span>}
              </button>
              <button className="favbtn mini__fav is-fav" onClick={() => toggleFav(p.id)} aria-label="찜 해제">
                {I.heart(true)}
              </button>
              <div className="mini__meta" onClick={() => onOpen(p)}>
                <span className="mini__brand">{p.brand} · {p.seller}</span>
                <span className="mini__name">{p.name}</span>
                <span className="mini__price">{won(p.price)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

/* ---------- 가격 비교 시트 ---------- */
function CompareSheet({ product, fav, onFav, onClose }) {
  const intel = product.priceIntel
  const rows = [
    { id: product.id, price: product.price, name: product.name, url: product.url, seller: product.seller, self: true },
    ...(intel?.peers || []),
  ].sort((a, b) => a.price - b.price)
  const s = intel?.stats

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="가격 비교">
      <button className="sheet__dim" onClick={onClose} aria-label="닫기" />
      <div className="sheet__panel">
        <div className="csheet__top">
          <button className="iconbtn" onClick={onClose} aria-label="뒤로">{I.back}</button>
        </div>

        <div className="csheet__product">
          {product.image && <img src={product.image} alt="" />}
          <div>
            <span className="csheet__brand">{product.brand}</span>
            <div className="csheet__name">{product.name}</div>
            <div className="card__tags">
              <span className="tag">{product.seller}</span>
              {product.category !== '기타' && <span className="tag">{product.category}</span>}
            </div>
          </div>
        </div>

        <div className="csheet__pricehead">
          <div>
            <div className="csheet__label">지금 이 상품</div>
            <div className="csheet__price">{won(product.price)}</div>
          </div>
          {intel && <div className="csheet__count">{intel.count}개 상품 비교 중</div>}
        </div>
        <div className="csheet__chips">
          {s?.medianReliable && s.discountPct > 0 && (
            <span className="csheet__chip">🔥 시세보다 {s.discountPct}% 저렴해요</span>
          )}
          {intel?.sellerCount >= 2 && (
            <span className="csheet__chip csheet__chip--save">🛒 {intel.sellerCount}개 판매처 비교</span>
          )}
        </div>

        {/* peers는 '같은 상품의 다른 판매처'가 아니라 '같은 그룹의 다른 매물'이다.
            실제로 판매처가 2곳 이상일 때만 판매처 비교라고 부른다. */}
        <div className="csheet__sechead">
          <b>{intel?.sellerCount >= 2 ? '판매처 별 판매가' : '같은 종류 다른 매물'}</b>
          <span>
            {intel?.sellerCount >= 2 ? `${intel.sellerCount}개 판매처 비교` : `${rows.length}건 가격순`}
          </span>
        </div>
        <ul className="csheet__rows">
          {rows.map((r, i) => (
            <li key={r.id} className={r.self ? 'is-self' : ''}>
              <a href={r.url} target="_blank" rel="noreferrer">
                <span className="sellerdot" style={{ background: SELLER_TINT[r.seller] || '#6b7280' }}>
                  {r.seller.slice(0, 1)}
                </span>
                <span className="csheet__rowname">
                  {r.seller}
                  {r.self && <em> · 이 상품</em>}
                  {i === 0 && <i className="csheet__low">최저가</i>}
                </span>
              </a>
              <b>{won(r.price)}</b>
            </li>
          ))}
        </ul>

        <div className="csheet__actions">
          <button className={`btn btn--ghost ${fav ? 'is-fav' : ''}`} onClick={() => onFav(product.id)}>
            {fav ? '추적 중 🔔' : '가격 추적하기'}
          </button>
          {/* 사용자가 연 상품을 사야 한다. rows[0]은 더 싼 '다른' 상품일 수 있다. */}
          <a className="btn btn--solid" href={product.url} target="_blank" rel="noreferrer">
            구매하러 가기
          </a>
        </div>
      </div>
    </div>
  )
}

/* ---------- 대화 기록 서랍 ---------- */
function Drawer({ sessions, onNew, onLoad, onClose }) {
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="대화 기록">
      <button className="sheet__dim" onClick={onClose} aria-label="닫기" />
      <div className="drawer__panel">
        <div className="drawer__head">
          <span className="drawer__profile" aria-hidden="true" />
          <b>쇼핑 메이트님</b>
          <button className="iconbtn" onClick={onClose} aria-label="닫기">{I.back}</button>
        </div>
        <div className="drawer__label">최근 대화 기록</div>
        {sessions.length === 0 ? (
          <p className="drawer__empty">아직 대화 기록이 없어요</p>
        ) : (
          <ul className="drawer__list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button onClick={() => onLoad(s.id)}>
                  <span className="drawer__title">{s.title}</span>
                  <span className="drawer__time">{s.time}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="drawer__new" onClick={onNew}>
          {I.edit} 새 대화
        </button>
      </div>
    </div>
  )
}

/* ---------- 앱 ---------- */
/* ---------- 데스크톱 사이드 가이드 ----------
   폰 폭(448px) 셸이라 넓은 화면에서 양옆이 비는데, 이 공간을 설명에 쓴다.
   왼쪽은 배경(왜 만들었나·데이터), 오른쪽은 지금 화면에서 해볼 것.
   좁은 화면에서는 숨긴다. */

const GUIDE_STEPS = [
  {
    key: 'home',
    n: '01',
    title: '이름 대신 생김새로 찾기',
    how: [
      '아래 입력창에 기억나는 특징을 문장으로 쓰세요.',
      '예: "메종 키츠네 니트인데 큰 여우가 가운데 그려진거"',
      '카메라 버튼으로 사진을 넣어 찾을 수도 있어요.',
    ],
    why: '고객은 상품을 이름이 아니라 색·무늬·형태로 기억합니다. 명품 상품명은 "크리스찬디올 SADDLE 플랩 카드 지갑 S5611CTZQ M928"처럼 외워서 검색할 수 있는 문자열이 아닙니다.',
    tech: {
      name: '2단계 검색 (retrieve → rerank)',
      body: '948건을 전부 AI에 넣으면 요청당 24k 토큰이라 분당 한도에 걸립니다. 브랜드·갈래·예산으로 먼저 100건 안팎까지 좁힌 뒤 AI가 그 안에서 고릅니다. 2~7k 토큰으로 줄었고, 상품이 늘어도 버팁니다.',
      ref: '정보검색의 cascade ranking — 넓게 거르고 정밀하게 재순위',
    },
  },
  {
    key: 'thread',
    n: '02',
    title: '후보는 최대 3개만',
    how: [
      '조건이 부족하면 되묻습니다. 칩을 탭하면 답이 됩니다.',
      '입력창에 조건을 더 붙여 결과를 좁힐 수 있어요.',
      '카드의 [상세 보기]를 누르면 가격 비교가 열립니다.',
    ],
    why: '후보를 길게 나열하면 결국 고객이 목록을 다시 훑어야 해서 기존 검색과 같아집니다. 되묻기를 대화 전체에서 1회로 제한한 것도 같은 이유입니다 — 질문만 반복하는 챗봇이 되지 않도록 서버 코드로 강제했습니다.',
    tech: {
      name: '선택 과부하를 피한 3개 제한',
      body: '선택지가 많을수록 만족도와 구매 결정률이 떨어진다는 연구가 있습니다. 24종을 진열했을 때보다 6종일 때 실제 구매가 훨씬 많았던 실험이 대표적입니다. 그래서 후보를 3개로 잘랐습니다.',
      ref: 'Iyengar & Lepper (2000), 선택 과부하 — 이후 Chernev 등의 메타분석으로 조건부 재확인',
    },
  },
  {
    key: 'deals',
    n: '03',
    title: '가격은 근거가 있을 때만 말합니다',
    how: [
      '나침반 아이콘 → 시세보다 싼 상품만 모아 봅니다.',
      '"시세보다 N% 저렴"은 같은 모델끼리 비교된 경우에만 붙습니다.',
      '근거가 약하면 % 대신 "N건 중 1번째로 저렴"으로 바뀝니다.',
    ],
    why: '이 제품이 파는 것은 "싸게 샀다는 확신"이라, 그 근거가 틀리면 기능이 없느니만 못합니다. 편차가 큰 그룹은 % 주장을 포기하도록 막아서, 948건 중 % 표기가 붙는 건 73건(7.7%)뿐입니다.',
    tech: {
      name: '준거가격을 만들어 구매를 확정시키기',
      body: '사람은 절대 가격이 아니라 기준점과의 차이로 싸다·비싸다를 느낍니다. 기준이 없으면 판단을 미루고, 미룬 구매는 대부분 돌아오지 않습니다. 그래서 같은 모델의 가격 분포를 함께 보여줍니다. 다만 그 기준이 틀리면 역효과라, 편차가 1.5배를 넘는 그룹에서는 % 주장을 포기합니다.',
      ref: '앵커링(Tversky & Kahneman, 1974) · 거래 효용과 준거가격(Thaler, 1985)',
    },
  },
  {
    key: 'saved',
    n: '04',
    title: '하트로 담아두기',
    how: ['하트를 누르면 찜 목록에 담깁니다.', '오른쪽 위 하트 아이콘에서 모아 볼 수 있어요.'],
    why: '고액 상품은 한 번에 결정하지 않습니다. 다시 찾아오는 비용을 줄이는 것이 이탈을 막는 가장 싼 방법입니다.',
    tech: {
      name: '탐색 비용을 0으로 만들어 재방문 유도',
      body: '한 번 찾아낸 상품을 다시 찾으려면 처음의 탐색을 반복해야 합니다. 그 비용이 곧 이탈 확률입니다. 찜은 기능이라기보다, 이 서비스가 해결한 "찾기 어려움"이 두 번째 방문에서 되살아나지 않게 하는 장치입니다.',
      ref: '탐색 비용(search cost)이 전환에 미치는 영향 — 고관여·고가 카테고리에서 특히 큼',
    },
  },
]

/**
 * 검색 진행 표시.
 *
 * 예전에는 "5개 쇼핑몰에서 찾고 있어요…" 한 줄이 4~5초 동안 멈춰 있었다.
 * 같은 대기 시간이라도 무엇을 하고 있는지 보이면 체감이 달라지고,
 * 무엇보다 이 서비스가 '여러 곳을 실제로 뒤진다'는 것이 드러난다.
 * 단계는 서버의 실제 처리 순서와 같다.
 */
const PROGRESS_STAGES = [
  { t: '말씀하신 특징을 정리하는 중', s: 'AI' },
  { t: '보유 카탈로그 948건 조회', s: '내부' },
  { t: '무신사 검색 중', s: '무신사' },
  { t: '29CM 검색 중', s: '29CM' },
  { t: '컬리 검색 중', s: '컬리' },
  { t: '다나와 최저가 조회 중', s: '다나와' },
  { t: '가장 가까운 후보 고르는 중', s: 'AI' },
  { t: '가격 비교 계산 중', s: '내부' },
]

function SearchProgress() {
  const [i, setI] = useState(0)
  useEffect(() => {
    // 마지막 단계에서 멈춰 대기한다 — 끝나지 않았는데 끝난 것처럼 보이지 않도록.
    const id = setInterval(() => setI((n) => Math.min(n + 1, PROGRESS_STAGES.length - 1)), 620)
    return () => clearInterval(id)
  }, [])
  const cur = PROGRESS_STAGES[i]
  return (
    <div className="prog" role="status" aria-live="polite">
      <div className="prog__head">
        <span className="spin" aria-hidden="true" />
        <b>{cur.t}</b>
        <span className="prog__src">{cur.s}</span>
      </div>
      <div className="prog__bar" aria-hidden="true">
        <i style={{ width: `${((i + 1) / PROGRESS_STAGES.length) * 100}%` }} />
      </div>
      <ul className="prog__list" aria-hidden="true">
        {PROGRESS_STAGES.map((s, n) => (
          <li key={n} className={n < i ? 'is-done' : n === i ? 'is-now' : ''}>
            {s.s}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* 한 번의 검색이 지나는 경로 — 사이드 가이드용 축약 다이어그램.
   숫자는 실제 값이다(카탈로그 948건, 좁힌 뒤 ~100건, 최종 3건). */
function PipelineDiagram() {
  const rows = [
    { n: '948', label: '수집한 상품', sub: '5개 쇼핑몰', tone: 'dim' },
    { n: '~100', label: '1단계 검색', sub: '브랜드·갈래·예산으로 좁힘', tone: 'mid' },
    { n: '+α', label: '실시간 검색 병합', sub: '카탈로그에 없으면 그 자리에서', tone: 'mid' },
    { n: '3', label: 'AI 재순위', sub: '묘사와 가장 가까운 후보', tone: 'hot' },
    { n: '5', label: '서버 가드 통과', sub: '틀린 후보를 걸러냄', tone: 'mid' },
    { n: '✓', label: '가격 계산', sub: '시세 분포·순위는 서버가', tone: 'dim' },
  ]
  return (
    <ol className="pipe" aria-label="검색 처리 단계">
      {rows.map((r, i) => (
        <li key={i} className={`pipe__row pipe__row--${r.tone}`}>
          <span className="pipe__n">{r.n}</span>
          <span className="pipe__txt">
            <b>{r.label}</b>
            <em>{r.sub}</em>
          </span>
        </li>
      ))}
    </ol>
  )
}

function GuideRail({ side, view, hasTurns }) {
  const active =
    view === 'deals' ? 'deals' : view === 'saved' ? 'saved' : hasTurns ? 'thread' : 'home'

  // 화면을 옮기면 해당 단계가 가이드 안에서 보이도록 따라간다.
  // (가이드 내용이 세로로 길어 03·04는 스크롤해야 보인다)
  const railRef = useRef(null)
  useEffect(() => {
    if (side !== 'right') return
    const el = railRef.current?.querySelector('.gstep.is-on')
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [active, side])

  if (side === 'left') {
    return (
      <aside className="guide guide--left" aria-label="프로토타입 설명">
        <div className="guide__inner">
          <div className="guide__badge">레브잇 PMF 직무 과제</div>
          <h2 className="guide__h">서술형 상품 탐색 에이전트</h2>
          <p className="guide__lead">
            정확한 상품명을 몰라도 <b>기억나는 특징을 말하면</b> 찾아주고,
            그 가격이 같은 종류 안에서 어디쯤인지까지 보여줍니다.
          </p>

          <div className="guide__sec">
            <h3>풀려는 문제</h3>
            <ul>
              <li>상품명을 특정하지 못해 <b>탐색 단계에서 이탈</b></li>
              <li>가격 판단 기준이 없어 <b>결제 직전 유보</b></li>
            </ul>
          </div>

          <div className="guide__sec">
            <h3>쓰는 데이터</h3>
            <p className="guide__p">
              5개 쇼핑몰에서 직접 수집한 <b>948건</b>
              <span className="guide__dim"> · 다나와 480 · 컬리 204 · 29CM 112 · 무신사 104 · KREAM 48</span>
            </p>
            <p className="guide__p guide__dim">
              카탈로그에 없는 상품은 질의 시점에 실시간 검색으로 보완합니다.
            </p>
          </div>

          <div className="guide__sec">
            <h3>한 번의 검색에서 일어나는 일</h3>
            <PipelineDiagram />
            <p className="guide__p guide__dim">
              AI에게 맡기는 것은 <b>고르는 일</b>뿐입니다. 좁히기·가격 계산·검증은 전부 서버 코드가 합니다.
            </p>
          </div>

          <div className="guide__sec">
            <h3>AI가 틀려도 사용자에게 닿지 않게</h3>
            <ul className="gguard">
              <li><b>브랜드 가드</b> 말한 브랜드 외 상품 차단</li>
              <li><b>갈래 가드</b> 슬리퍼를 물었는데 지갑이 나오면 차단</li>
              <li><b>예산 가드</b> 범위 밖 상품 차단</li>
              <li><b>모순 가드</b> 상품이 있는데 "없다"·0건인데 "추천" 차단</li>
              <li><b>id 조인</b> AI가 지어낸 상품은 화면에 못 올라옴</li>
            </ul>
            <p className="guide__p guide__dim">
              근거가 약하면 숫자를 만들지 않습니다. AI는 가격을 말할 수 없고, 가격은 전부 서버가 계산합니다.
            </p>
          </div>

          <p className="guide__note">
            실제 쇼포트 서비스가 아니라 과제용 프로토타입입니다.
            UI는 쇼포트 앱의 UX 문법을 참고해 재현했습니다.
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="guide guide--right" aria-label="사용 가이드" ref={railRef}>
      <div className="guide__inner">
        <div className="guide__badge guide__badge--live">지금 화면에서 해볼 것</div>
        {GUIDE_STEPS.map((s) => (
          <div key={s.key} className={`gstep ${active === s.key ? 'is-on' : ''}`}>
            <div className="gstep__head">
              <span className="gstep__n">{s.n}</span>
              <b>{s.title}</b>
            </div>
            <ul className="gstep__how">
              {s.how.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
            <p className="gstep__why">
              <span>왜 이렇게 했나</span>
              {s.why}
            </p>
            {s.tech && (
              <div className="gtech">
                <div className="gtech__name">{s.tech.name}</div>
                <p className="gtech__body">{s.tech.body}</p>
                <p className="gtech__ref">{s.tech.ref}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function App() {
  const [view, setView] = useState('chat')
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
  })
  const [catalog, setCatalog] = useState({ products: [], loading: false, error: null, loaded: false })
  const [sheet, setSheet] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [turns, setTurns] = useState([])
  const [sessions, setSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '[]') } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)) } catch { /* 무시 */ }
  }, [favs])

  // 대화가 진행되면 세션으로 저장 (첫 질문이 제목)
  useEffect(() => {
    if (turns.length < 2) return
    const first = turns.find((t) => t.role === 'user')
    if (!first) return
    setSessions((prev) => {
      const id = turns.sessionId || first.content.slice(0, 40) // 첫 질문 기준 업데이트
      const entry = {
        id,
        title: first.content.slice(0, 40),
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        turns: turns.map(({ onAnswer, ...t }) => t),
      }
      const next = [entry, ...prev.filter((s) => s.id !== id)].slice(0, 10)
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)) } catch { /* 무시 */ }
      return next
    })
  }, [turns])

  useEffect(() => {
    if (catalog.loaded || catalog.loading || catalog.error) return
    // 인스턴트 검색이 홈에서도 필요하므로 첫 진입 시 바로 프리페치한다
    setCatalog((c) => ({ ...c, loading: true }))
    fetch('/api/catalog')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setCatalog({ products: d.products, loading: false, error: null, loaded: true }))
      .catch(() => setCatalog({ products: [], loading: false, error: '목록을 불러오지 못했어요. 잠시 후 다시 열어주세요.', loaded: false }))
  }, [view, catalog.loaded, catalog.loading, catalog.error])

  const retryCatalog = () => setCatalog({ products: [], loading: false, error: null, loaded: false })
  const index = useMemo(() => (catalog.products.length ? buildIndex(catalog.products) : null), [catalog.products])
  const toggleFav = (id) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  useEffect(() => {
    if (!sheet && !drawer) return
    const onKey = (e) => {
      if (e.key === 'Escape') { setSheet(null); setDrawer(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, drawer])

  return (
    <div className="stage">
      <GuideRail side="left" view={view} hasTurns={turns.length > 0} />
      <div className="phone">
        <header className="appbar">
          <button className="iconbtn" onClick={() => setDrawer(true)} aria-label="대화 기록">{I.menu}</button>
          <div className="appbar__nav">
            {(view !== 'chat' || turns.length > 0) && (
              <button className="iconbtn" onClick={() => { setView('chat'); setTurns([]) }} aria-label="AI 찾기 홈">
                {I.home}
              </button>
            )}
            <button className={`iconbtn ${view === 'deals' ? 'is-on' : ''}`} onClick={() => setView('deals')} aria-label="최저가 추적">
              {I.compass}
            </button>
            <button className="iconbtn iconbtn--heart" onClick={() => setView('saved')} aria-label="찜한 목록">
              {I.heart(true)}
            </button>
          </div>
        </header>

        {view === 'chat' && (
          <ChatView
            favs={favs}
            toggleFav={toggleFav}
            onCompare={setSheet}
            turns={turns}
            setTurns={setTurns}
            goDeals={() => setView('deals')}
            index={index}
          />
        )}
        {view === 'deals' && (
          <DealsView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} onRetry={retryCatalog} />
        )}
        {view === 'saved' && (
          <SavedView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} onRetry={retryCatalog} />
        )}

        {sheet && <CompareSheet product={sheet} fav={favs.includes(sheet.id)} onFav={toggleFav} onClose={() => setSheet(null)} />}
        {drawer && (
          <Drawer
            sessions={sessions}
            onNew={() => { setTurns([]); setView('chat'); setDrawer(false) }}
            onLoad={(id) => {
              const s = sessions.find((x) => x.id === id)
              if (s) { setTurns(s.turns); setView('chat') }
              setDrawer(false)
            }}
            onClose={() => setDrawer(false)}
          />
        )}
      </div>
      <GuideRail side="right" view={view} hasTurns={turns.length > 0} />
    </div>
  )
}
