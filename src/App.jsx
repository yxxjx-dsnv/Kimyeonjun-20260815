import { useState, useRef, useEffect, useMemo } from 'react'

/* 홈 2×2 선택지 — 탭하면 즉시 검색 실행 (실제 쇼포트 동작과 동일) */
const HOME_CARDS = [
  { icon: '🔍', tint: '#eef4ff', label: ['이름은 몰라도', '서술로 찾기'], text: '디올 지갑인데 베이지 바탕에 남색 패턴 있는 얇은 카드지갑 찾아줘' },
  { icon: '🧴', tint: '#eafaf1', label: ['뷰티·생활', '최저가 찾기'], text: '모공에 좋은 수분크림, 판매처별로 제일 싼 거 찾아줘' },
  { icon: '💰', tint: '#fff2e9', label: ['새상품 대비', '절약액 확인'], text: '루이비통 반지갑 중고로 사면 새상품보다 얼마나 아껴?' },
  { icon: '👗', tint: '#f6efff', label: ['패션까지', '한 번에 비교'], text: '검정 원피스 10만원 아래로 추천해줘' },
]

const won = (n) => `${n.toLocaleString('ko-KR')}원`
const FAV_KEY = 'ggij:favs'
const SELLER_TINT = {
  번개장터: '#ef4444', '다나와 최저가': '#16a34a', '29CM': '#111827', 무신사: '#2563eb', 컬리: '#7c3aed',
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
  bell: svg(<path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.6 5.5 1.6 5.5H4.4S6 13.7 6 9.5Z" />, <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />),
  scan: svg(<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />, <path d="M4 12h16" />),
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

/* ---------- 상품 카드 (결과 카드) ---------- */
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
              aria-label={fav ? '찜 해제' : '찜하기'}
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
            <span className={`tag ${product.condition === 'new' ? 'tag--new' : ''}`}>
              {product.condition === 'new' ? '새상품' : '중고'}
            </span>
            <span className="tag">{product.seller}</span>
            {product.category !== '기타' && <span className="tag">{product.category}</span>}
            {product.verified && <span className="tag tag--verify">정품 검수 가능</span>}
            {intel?.stats?.rank === 1 && (
              <span className="tag tag--best">{intel.isModelLevel ? '이 모델 최저가' : '이 종류 최저가'}</span>
            )}
          </div>
        </div>
      </div>

      {intel && <div className="ailabel">AI 가격 분석</div>}
      <SavingsLedger product={product} intel={intel} />
      <MarketRange intel={intel || {}} price={product.price} />

      {intel?.peers?.length > 0 && (
        <button className="card__compare" onClick={() => onCompare(product)}>
          가격 비교·판매처 보기 ({intel.peers.length + 1})
        </button>
      )}

      <div className="card__actions">
        <a className="btn btn--ghost" href={product.url} target="_blank" rel="noreferrer">
          {product.condition === 'new' ? '상세 보기' : '판매글 보기'}
        </a>
        <a className="btn btn--solid" href={intel?.newBest?.url || product.url} target="_blank" rel="noreferrer">
          최저가 구매하기
        </a>
      </div>
    </article>
  )
}

/* ---------- 비교표 (쇼포트 '비교표로 보기') ---------- */
function CompareTable({ products }) {
  const rows = [
    ['가격', (p) => won(p.price)],
    ['상태', (p) => (p.condition === 'new' ? '새상품' : '중고')],
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
    ['새상품 대비', (p) =>
      p.priceIntel?.vsNewPct > 0 ? `${won(p.priceIntel.newBest.price - p.price)} 절약` : '—'],
    ['평점', (p) => (p.rating ? `★ ${p.rating.toFixed(1)}` : '—')],
    ['정품 검수', (p) => (p.verified ? '가능' : '—')],
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

/* ---------- 질문 카드 (쇼포트 설문 카드: 선택 → 선택 완료) ---------- */
function QuestionCard({ turn }) {
  const [picked, setPicked] = useState([])
  const opts = turn.followUpOptions || []
  const toggle = (o) =>
    setPicked((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]))
  if (opts.length === 0) return (
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
      <button
        className="qcard__next"
        disabled={picked.length === 0}
        onClick={() => turn.onAnswer(picked.join(', '))}
      >
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
        {turn.catalogSize && <span className="statusrow__chip">5개 쇼핑몰 · {turn.catalogSize}개 상품</span>}
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

/* ---------- AI 찾기 (홈 + 대화) ---------- */
function ChatView({ favs, toggleFav, onCompare }) {
  const [turns, setTurns] = useState([])
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
    // 재시도(다시 시도)면 같은 발화가 이미 마지막에 있으므로 중복 적재하지 않는다
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
      const data = await res.json().catch(() => ({})) // 게이트웨이 HTML 오류 페이지 대비
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
    // 한글 IME 조합 확정 Enter는 전송이 아니다 — 이 가드가 없으면 타이핑 중 반토막 질의가 전송된다
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  /* ----- 홈 (쇼포트 첫 화면 문법) ----- */
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
            <span className="camtile" aria-hidden="true">{I.camera}</span>
            <button className="sendbtn" onClick={() => send(input)} disabled={!input.trim()} aria-label="전송">
              {I.send}
            </button>
          </div>
        </div>

        <p className="home__label">원하는 질문을 선택해보세요</p>
        <div className="grid2">
          {HOME_CARDS.map((c) => (
            <button key={c.text} className="gcard" onClick={() => send(c.text)}>
              <span className="gcard__icon" style={{ background: c.tint }} aria-hidden="true">{c.icon}</span>
              <span className="gcard__label">
                {c.label[0]}
                <br />
                <b>{c.label[1]}</b>
              </span>
            </button>
          ))}
        </div>

        <p className="peek__caption">
          <span aria-hidden="true">💰</span> 시세가 궁금한 상품이 있다면
        </p>
        <button className="peek" onClick={() => send('디올 오블리크 카드지갑 지금 시세 어때?')}>
          <span className="peek__icon" aria-hidden="true">{I.scan}</span>
          이&nbsp;<b>명품</b>&nbsp;상품, 시세보다 싼 걸까?
        </button>

        <p className="home__note">
          레브잇 PMF 과제 프로토타입 — 쇼포트의 UX 문법을 차용한 데모이며 실제 쇼포트 서비스가
          아닙니다.
        </p>
      </main>
    )
  }

  /* ----- 대화 (결과 화면) ----- */
  return (
    <>
      <main className="thread" aria-live="polite">
        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="upill-wrap">
              <span className="upill">{turn.content}</span>
            </div>
          ) : (
            <AgentTurn key={i} turn={turn} favs={favs} toggleFav={toggleFav} onCompare={onCompare} />
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
            <button onClick={() => send(error.retry)}>다시 시도</button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <div className="composer">
        <span className="camtile camtile--sm" aria-hidden="true">{I.camera}</span>
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
          {product.brand} · {product.seller}
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

function BrowseView({ catalog, favs, toggleFav, onOpen, savedOnly, onRetry }) {
  const [group, setGroup] = useState('전체')
  const [cond, setCond] = useState('전체')

  const groups = useMemo(
    () => ['전체', ...new Set((catalog.products || []).map((p) => p.catGroup))],
    [catalog.products]
  )
  const shown = useMemo(() => {
    let list = catalog.products || []
    if (savedOnly) list = list.filter((p) => favs.includes(p.id))
    if (group !== '전체') list = list.filter((p) => p.catGroup === group)
    if (cond !== '전체') list = list.filter((p) => (cond === '새상품' ? p.condition === 'new' : p.condition === 'used'))
    return list
  }, [catalog.products, savedOnly, favs, group, cond])

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
    return (
      <main className="browse">
        <div className="empty">
          {catalog.error}
          <button className="empty__retry" onClick={onRetry}>다시 불러오기</button>
        </div>
      </main>
    )
  }

  return (
    <main className="browse">
      <div className="filters">
        <div className="filters__row" role="tablist" aria-label="카테고리">
          {groups.map((g) => (
            <button key={g} className={`fchip ${group === g ? 'is-on' : ''}`} onClick={() => setGroup(g)}>
              {g}
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
      <div className="browse__count">{shown.length}개 상품</div>
      {shown.length === 0 ? (
        <div className="empty">{savedOnly ? '마음에 든 상품을 하트로 저장해 두세요.' : '조건에 맞는 상품이 없어요.'}</div>
      ) : (
        <div className="grid">
          {shown.map((p) => (
            <MiniCard key={p.id} product={p} fav={favs.includes(p.id)} onFav={toggleFav} onOpen={onOpen} />
          ))}
        </div>
      )}
    </main>
  )
}

/* ---------- 가격 비교 시트 (쇼포트 '플랫폼 별 판매가' 화면) ---------- */
function CompareSheet({ product, fav, onFav, onClose }) {
  const intel = product.priceIntel
  // 자기 자신 + 비교 매물을 가격순으로
  const rows = [
    { id: product.id, price: product.price, name: product.name, url: product.url, seller: product.seller, condition: product.condition, self: true },
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
              <span className={`tag ${product.condition === 'new' ? 'tag--new' : ''}`}>
                {product.condition === 'new' ? '새상품' : '중고'}
              </span>
              {product.category !== '기타' && <span className="tag">{product.category}</span>}
            </div>
          </div>
        </div>

        <div className="csheet__pricehead">
          <div>
            <div className="csheet__label">지금 이 상품</div>
            <div className="csheet__price">{won(product.price)}</div>
          </div>
          {intel && <div className="csheet__count">{intel.count}개 매물 비교 중</div>}
        </div>
        <div className="csheet__chips">
          {s?.medianReliable && s.discountPct > 0 && (
            <span className="csheet__chip">🔥 시세보다 {s.discountPct}% 저렴해요</span>
          )}
          {intel?.vsNewPct > 0 && (
            <span className="csheet__chip csheet__chip--save">
              💰 새상품 대비 {won(intel.newBest.price - product.price)} 절약
            </span>
          )}
        </div>

        <div className="csheet__sechead">
          <b>판매처 별 판매가</b>
          <span>5개 쇼핑몰 수집 데이터 비교</span>
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

/* ---------- 앱 ---------- */
export default function App() {
  const [view, setView] = useState('chat')
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
  })
  const [catalog, setCatalog] = useState({ products: [], loading: false, error: null, loaded: false })
  const [sheet, setSheet] = useState(null)

  useEffect(() => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)) } catch { /* 저장 실패는 치명적이지 않다 */ }
  }, [favs])

  useEffect(() => {
    if (view === 'chat' || catalog.loaded || catalog.loading || catalog.error) return
    setCatalog((c) => ({ ...c, loading: true }))
    fetch('/api/catalog')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setCatalog({ products: d.products, loading: false, error: null, loaded: true }))
      .catch(() => setCatalog({ products: [], loading: false, error: '목록을 불러오지 못했어요. 잠시 후 다시 열어주세요.', loaded: false }))
  }, [view, catalog.loaded, catalog.loading, catalog.error])

  const retryCatalog = () => setCatalog({ products: [], loading: false, error: null, loaded: false })

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
          <span className="iconbtn" aria-hidden="true">{I.menu}</span>
          <div className="appbar__nav">
            {view !== 'chat' && (
              <button className="iconbtn" onClick={() => setView('chat')} aria-label="AI 찾기 홈">
                {I.home}
              </button>
            )}
            <button className={`iconbtn ${view === 'browse' ? 'is-on' : ''}`} onClick={() => setView('browse')} aria-label="최저가 탐색">
              {I.compass}
            </button>
            <button className="iconbtn iconbtn--heart" onClick={() => setView('saved')} aria-label="찜한 목록">
              {I.heart(true)}
            </button>
          </div>
        </header>

        {view === 'chat' && <ChatView favs={favs} toggleFav={toggleFav} onCompare={setSheet} />}
        {view === 'browse' && (
          <BrowseView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} savedOnly={false} onRetry={retryCatalog} />
        )}
        {view === 'saved' && (
          <BrowseView catalog={catalog} favs={favs} toggleFav={toggleFav} onOpen={setSheet} savedOnly onRetry={retryCatalog} />
        )}

        {sheet && (
          <CompareSheet product={sheet} fav={favs.includes(sheet.id)} onFav={toggleFav} onClose={() => setSheet(null)} />
        )}
      </div>
      <p className="colophon">
        레브잇 PMF 과제 프로토타입 — 쇼포트의 UX 문법을 차용한 데모이며 실제 쇼포트 서비스가
        아닙니다. 데이터: 번개장터 · 다나와 · 29CM · 무신사 · 컬리 (총 756개 상품).
      </p>
    </div>
  )
}
