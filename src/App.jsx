import { useState, useRef, useEffect, useMemo } from 'react'

const EXAMPLES = [
  '디올 지갑인데 베이지 바탕에 남색 패턴이 깔려 있고, 카드 넣는 얇은 거였어',
  '샤넬 가방, 검정 누빔에 금색 체인 달린 어깨에 메는 거',
  '보테가 지갑 그 짜임 가죽으로 된 초록색 있잖아',
]

const won = (n) => `${n.toLocaleString('ko-KR')}원`
const FAV_KEY = 'ggij:favs'

/* ---------- 아이콘 (인라인 SVG) ---------- */
const I = {
  chat: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.9 8.9 0 0 1-3.9-.9L3 20l1.2-4.3a8.1 8.1 0 0 1-1.2-4.2A8.38 8.38 0 0 1 11.5 3.2a8.38 8.38 0 0 1 9.5 8.3Z" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  ),
  heart: (filled) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.3S4 15 4 9.6A4.4 4.4 0 0 1 8.4 5c1.5 0 2.9.8 3.6 2A4.2 4.2 0 0 1 15.6 5 4.4 4.4 0 0 1 20 9.6c0 5.4-8 10.7-8 10.7Z" />
    </svg>
  ),
}

/* ---------- 절약 계산서 (시그니처) ---------- */
function SavingsLedger({ product, intel }) {
  if (!intel?.newBest) return null
  const saving = intel.newBest.price - product.price
  return (
    <div className="ledger">
      <div className="ledger__row">
        <span>새상품 최저가 <em>다나와 집계</em></span>
        <b>{won(intel.newBest.price)}</b>
      </div>
      <div className="ledger__row">
        <span>이 중고 매물</span>
        <b>{won(product.price)}</b>
      </div>
      {saving > 0 ? (
        <div className="ledger__total">
          <span>지금 사면 절약</span>
          <strong>
            {won(saving)} <i>({intel.vsNewPct}%)</i>
          </strong>
        </div>
      ) : (
        <a className="ledger__flip" href={intel.newBest.url} target="_blank" rel="noreferrer">
          이 매물보다 새상품이 더 저렴해요 → 새상품 보기
        </a>
      )}
    </div>
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
        <p className="range__note">매물마다 모델·상태 차이가 커서 평균 시세는 계산하지 않았어요.</p>
      )}
    </div>
  )
}

/* ---------- 가격 비교 리스트 ---------- */
function PeerList({ intel }) {
  const [open, setOpen] = useState(false)
  if (!intel?.peers?.length) return null
  return (
    <div className="peers">
      <button className="peers__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '가격 비교 접기' : `판매처 가격 비교 (${intel.peers.length})`}
      </button>
      {open && (
        <ul>
          {intel.peers.map((p, idx) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <span className={`seller ${p.condition === 'new' ? 'seller--new' : ''}`}>
                  {p.condition === 'new' ? '새상품' : p.seller}
                </span>
                <span className="peers__name">{p.name}</span>
              </a>
              <b>
                {idx === 0 && <i className="lowest">최저</i>}
                {won(p.price)}
              </b>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- 상품 카드 ---------- */
function ProductCard({ product, fav, onFav }) {
  const intel = product.priceIntel
  return (
    <article className="card">
      <div className="card__main">
        {product.image ? (
          <img className="card__thumb" src={product.image} alt={product.name} loading="lazy" />
        ) : (
          <div className="card__thumb card__thumb--empty">{product.brand.slice(0, 1)}</div>
        )}
        <div className="card__body">
          <div className="card__top">
            <span className="card__brand">{product.brand}</span>
            <button
              className={`favbtn ${fav ? 'is-fav' : ''}`}
              onClick={() => onFav(product.id)}
              aria-label={fav ? '찜 해제' : '찜하기'}
            >
              {I.heart(fav)}
            </button>
          </div>
          <h3 className="card__name">{product.name}</h3>
          <div className="card__price">{won(product.price)}</div>
          <div className="card__tags">
            <span className={`tag ${product.condition === 'new' ? 'tag--new' : ''}`}>
              {product.condition === 'new' ? '새상품' : '중고'}
            </span>
            {product.category !== '기타' && <span className="tag">{product.category}</span>}
            {product.verified && <span className="tag tag--verify">정품 검수 가능</span>}
            {intel?.stats?.rank === 1 && (
              <span className="tag tag--best">{intel.isModelLevel ? '이 모델 최저가' : '이 종류 최저가'}</span>
            )}
          </div>
        </div>
      </div>

      <SavingsLedger product={product} intel={intel} />
      <MarketRange intel={intel || {}} price={product.price} />
      <PeerList intel={intel} />

      <a className="card__cta" href={product.url} target="_blank" rel="noreferrer">
        {product.seller === '다나와 최저가' ? '판매처별 가격 보기' : `${product.seller}에서 보기`}
      </a>
    </article>
  )
}

/* ---------- AI 찾기 탭 ---------- */
function ChatView({ favs, toggleFav }) {
  const [turns, setTurns] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
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
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
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
          followUpOptions: data.followUpOptions || [],
        },
      ])
    } catch (err) {
      setError({ message: err.message, retry: question })
      setTurns(next)
    } finally {
      setLoading(false)
    }
  }

  const lastTurn = turns[turns.length - 1]
  const quickReplies = !loading && lastTurn?.role === 'assistant' ? lastTurn.followUpOptions : []

  return (
    <>
      <main className="thread" aria-live="polite">
        {turns.length === 0 && (
          <div className="intro">
            <p className="intro__hello">
              아 그거… <span>뭐였지?</span>
            </p>
            <p className="intro__lead">
              이름은 몰라도 괜찮아요. 색, 무늬, 모양 — 기억나는 대로 말하면 찾아드리고,
              새상품·중고 가격까지 비교해 드려요.
            </p>
            <p className="intro__label">이렇게 말해보세요</p>
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => { setInput(ex); inputRef.current?.focus() }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`turn ${turn.role === 'user' ? 'turn--user' : ''}`}>
            <div className={`bubble ${turn.role === 'user' ? 'bubble--user' : ''}`}>
              {turn.content}
              {turn.followUpQuestion && <div className="bubble__ask">{turn.followUpQuestion}</div>}
            </div>
            {turn.products?.length > 0 && (
              <div className="cards">
                {turn.products.map((p) => (
                  <ProductCard key={p.id} product={p} fav={favs.includes(p.id)} onFav={toggleFav} />
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="bubble bubble--typing" aria-label="답변 작성 중">
            <span /><span /><span />
          </div>
        )}
        {error && (
          <div className="bubble bubble--error">
            {error.message}
            <button onClick={() => send(error.retry)}>다시 시도</button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {quickReplies.length > 0 && (
        <div className="quickies">
          {quickReplies.map((q) => (
            <button key={q} onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="예) 검정 가죽에 금장 달린 샤넬 반지갑"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
          aria-label="찾는 물건 설명"
        />
        <button className="composer__send" onClick={() => send(input)} disabled={loading || !input.trim()}>
          찾아줘
        </button>
      </div>
    </>
  )
}

/* ---------- 둘러보기 / 찜 ---------- */
function MiniCard({ product, fav, onFav, onOpen }) {
  return (
    <div className="mini">
      <button className="mini__hit" onClick={() => onOpen(product)} aria-label={`${product.name} 자세히 보기`}>
        {product.image ? (
          <img src={product.image} alt="" loading="lazy" />
        ) : (
          <span className="mini__empty">{product.brand.slice(0, 1)}</span>
        )}
      </button>
      <button className={`favbtn mini__fav ${fav ? 'is-fav' : ''}`} onClick={() => onFav(product.id)} aria-label={fav ? '찜 해제' : '찜하기'}>
        {I.heart(fav)}
      </button>
      <div className="mini__meta" onClick={() => onOpen(product)}>
        <span className="mini__brand">
          {product.brand} · {product.condition === 'new' ? '새상품' : '중고'}
        </span>
        <span className="mini__name">{product.name}</span>
        <span className="mini__price">
          {won(product.price)}
          {product.priceIntel?.vsNewPct > 0 && <i>새상품 대비 -{product.priceIntel.vsNewPct}%</i>}
        </span>
      </div>
    </div>
  )
}

function GridView({ products, favs, toggleFav, onOpen, empty }) {
  if (!products.length) return <div className="empty">{empty}</div>
  return (
    <div className="grid">
      {products.map((p) => (
        <MiniCard key={p.id} product={p} fav={favs.includes(p.id)} onFav={toggleFav} onOpen={onOpen} />
      ))}
    </div>
  )
}

function BrowseView({ catalog, favs, toggleFav, onOpen, savedOnly }) {
  const [brand, setBrand] = useState('전체')
  const [cond, setCond] = useState('전체')

  const brands = useMemo(
    () => ['전체', ...new Set((catalog.products || []).map((p) => p.brand))],
    [catalog.products]
  )
  const shown = useMemo(() => {
    let list = catalog.products || []
    if (savedOnly) list = list.filter((p) => favs.includes(p.id))
    if (brand !== '전체') list = list.filter((p) => p.brand === brand)
    if (cond !== '전체') list = list.filter((p) => (cond === '새상품' ? p.condition === 'new' : p.condition === 'used'))
    return list
  }, [catalog.products, savedOnly, favs, brand, cond])

  if (catalog.loading) {
    return (
      <main className="browse">
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="mini mini--skeleton" />)}
        </div>
      </main>
    )
  }
  if (catalog.error) {
    return <main className="browse"><div className="empty">{catalog.error}</div></main>
  }

  return (
    <main className="browse">
      <div className="filters">
        <div className="filters__row" role="tablist" aria-label="브랜드">
          {brands.map((b) => (
            <button key={b} className={`fchip ${brand === b ? 'is-on' : ''}`} onClick={() => setBrand(b)}>
              {b}
            </button>
          ))}
        </div>
        <div className="filters__seg" role="tablist" aria-label="상태">
          {['전체', '새상품', '중고'].map((c) => (
            <button key={c} className={cond === c ? 'is-on' : ''} onClick={() => setCond(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <GridView
        products={shown}
        favs={favs}
        toggleFav={toggleFav}
        onOpen={onOpen}
        empty={savedOnly ? '마음에 든 매물을 하트로 저장해 두세요.' : '조건에 맞는 매물이 없어요.'}
      />
    </main>
  )
}

/* ---------- 앱 ---------- */
export default function App() {
  const [tab, setTab] = useState('chat')
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
  })
  const [catalog, setCatalog] = useState({ products: [], loading: false, error: null, loaded: false })
  const [sheet, setSheet] = useState(null)

  useEffect(() => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)) } catch { /* 저장 실패는 치명적이지 않다 */ }
  }, [favs])

  useEffect(() => {
    if (tab === 'chat' || catalog.loaded || catalog.loading) return
    setCatalog((c) => ({ ...c, loading: true }))
    fetch('/api/catalog')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setCatalog({ products: d.products, loading: false, error: null, loaded: true }))
      .catch(() => setCatalog({ products: [], loading: false, error: '목록을 불러오지 못했어요. 잠시 후 다시 열어주세요.', loaded: false }))
  }, [tab, catalog.loaded, catalog.loading])

  const toggleFav = (id) =>
    setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  useEffect(() => {
    if (!sheet) return
    const onKey = (e) => e.key === 'Escape' && setSheet(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  return (
    <div className="stage">
      <div className="phone">
        <header className="appbar">
          <h1 className="wordmark">그거 있잖아</h1>
          <p className="appbar__sub">이름은 몰라도 찾아드려요</p>
        </header>

        {tab === 'chat' && <ChatView favs={favs} toggleFav={toggleFav} />}
        {tab === 'browse' && (
          <BrowseView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} savedOnly={false} />
        )}
        {tab === 'saved' && (
          <BrowseView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} savedOnly />
        )}

        <nav className="tabbar" aria-label="주요 메뉴">
          {[
            ['chat', 'AI 찾기', I.chat],
            ['browse', '둘러보기', I.grid],
            ['saved', `찜${favs.length ? ` ${favs.length}` : ''}`, I.heart(false)],
          ].map(([key, label, icon]) => (
            <button key={key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)} aria-current={tab === key}>
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {sheet && (
          <div className="sheet" role="dialog" aria-modal="true" aria-label="매물 상세">
            <button className="sheet__dim" onClick={() => setSheet(null)} aria-label="닫기" />
            <div className="sheet__panel">
              <button className="sheet__close" onClick={() => setSheet(null)}>닫기</button>
              <ProductCard product={sheet} fav={favs.includes(sheet.id)} onFav={toggleFav} />
            </div>
          </div>
        )}
      </div>
      <p className="colophon">번개장터(중고 매물)·다나와(새상품 가격)를 수집해 만든 데모입니다.</p>
    </div>
  )
}
