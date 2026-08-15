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

  useEffect(() => {
    if (turns.length > 0) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, loading])

  async function send(text) {
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
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
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
          elapsed: ((performance.now() - t0) / 1000).toFixed(1),
          onAnswer: send,
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
            <AgentTurn key={i} turn={{ ...turn, onAnswer: send }} favs={favs} toggleFav={toggleFav} onCompare={onCompare} />
          )
        )}

        {loading && (
          <div className="statusrow statusrow--busy" aria-label="답변 작성 중">
            <span className="spin" aria-hidden="true" />
            5개 쇼핑몰에서 찾고 있어요…
          </div>
        )}
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
          placeholder="결과를 좁히거나 다른 상품을 찾아드려요"
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

        <div className="csheet__sechead">
          <b>판매처 별 판매가</b>
          <span>5개 쇼핑몰 데이터 비교</span>
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
          <a className="btn btn--solid" href={rows[0].url} target="_blank" rel="noreferrer">
            최저가 구매하기
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
    </div>
  )
}
