import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownLeft, ArrowDownToLine, ArrowUpRight, Bell, BriefcaseBusiness, Calculator, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleHelp, Eye, EyeOff, FileCheck2, FileText, FolderUp, Info, LayoutDashboard, LogOut, Menu, Newspaper, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, TrendingUp, Wallet, X } from 'lucide-react'
import Papa from 'papaparse'
import { api } from './account'
import { colors, cost, download, money, percent, sortAssets, today, total, visibleHoldings } from './portfolio'
import type { Asset, AssetClass, AssetSort, ImportRecord } from './portfolio'
import type { SaveStatus, Store, User } from './account'
import { ImportDialog } from './ImportDialog'
import { AveragePricePage } from './AveragePricePage'
import { NewsMercadoPage } from './NewsMercadoPage'
import { averageWithNoteFallback, removePricingNoteFromStore, summarizeStorePurchases } from './b3Notes'
import './lastro.css'
import './holdingsTable.css'
import './profile.css'
import './readableLayout.css'
import './marketNews.css'

type Page = 'News Mercado' | 'Visão geral' | 'Minha carteira' | 'Preço Médio' | 'Importações' | 'Relatórios'
const classes = Object.keys(colors) as AssetClass[]
const navigation = [{ title: 'News Mercado', icon: Newspaper }, { title: 'Visão geral', icon: LayoutDashboard }, { title: 'Minha carteira', icon: Wallet }, { title: 'Preço Médio', icon: Calculator }, { title: 'Importações', icon: FolderUp }, { title: 'Relatórios', icon: FileText }] as const
const holdingsColumns = [
  { key: 'asset', label: 'Ativo', description: 'Ticker e nome do ativo.', width: '20%' },
  { key: 'class', label: 'Classe', description: 'Categoria do investimento.', width: '9%', numeric: false },
  { key: 'quantity', label: 'Quantidade', description: 'Unidades atualmente mantidas na carteira.', width: '8%', numeric: true },
    { key: 'average', label: 'Preço médio', description: 'Média informada pelo extrato da posição.', width: '9%', numeric: true },
    { key: 'quote', label: 'Cotação Atual', description: 'Último preço confirmado pela brapi.', width: '9%', numeric: true },
    { key: 'purchase', label: 'Preço de compra', description: 'Média ponderada das compras importadas.', width: '9%', numeric: true },
    { key: 'invested', label: 'Valor investido', description: 'Quantidade multiplicada pelo preço médio.', width: '10%', numeric: true },
    { key: 'current', label: 'Valor atual', description: 'Quantidade vezes a cotação exibida.', width: '10%', numeric: true },
    { key: 'result', label: 'Lucro / Prejuízo', description: 'Resultado estimado frente ao preço médio.', width: '11%', numeric: true },
    { key: 'allocation', label: 'Alocação', description: 'Percentual do valor total da carteira.', width: '8%', numeric: true },
] as const

function ColumnInfo({ label, description }: { label: string; description: string }) {
  return <button type="button" className="column-info" title={description} aria-label={`${label}: ${description}`}><Info size={12} /></button>
}

function HoldingColumnHeader({ column }: { column: typeof holdingsColumns[number] }) {
  return <th className={'numeric' in column && column.numeric ? 'number' : ''}><span className="column-heading">{column.label}{column.key === 'asset' && <ChevronDown size={12} />}<ColumnInfo label={column.label} description={column.description} /></span></th>
}

type Props = { store: Store; setStore: (next: Store | ((current: Store) => Store)) => void; user: User; saveStatus: SaveStatus; saveError: string; onRetrySave: () => void; onLogout: () => void; signingOut: boolean; legacyAvailable: boolean; onMigrate: () => void; onDismissMigration: () => void }

function UserProfile({ user, onLogout, signingOut, onPreferences, compact = false }: Pick<Props, 'user' | 'onLogout' | 'signingOut'> & { onPreferences: () => void; compact?: boolean }) {
  const profileRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (profileRef.current && event.target instanceof Node && !profileRef.current.contains(event.target)) profileRef.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  return <details ref={profileRef} className={`user-profile ${compact ? 'compact-profile' : 'profile'}`} onKeyDown={event => {
    if (event.key === 'Escape' && profileRef.current) {
      profileRef.current.open = false
      profileRef.current.querySelector('summary')?.focus()
      event.preventDefault()
    }
  }}>
    <summary className={`profile-trigger ${compact ? 'avatar avatar-small' : ''}`} aria-label={compact ? 'Perfil do usuário' : 'Perfil do usuário na barra lateral'} title="Perfil do usuário">
      {compact ? user.name.slice(0, 2).toUpperCase() : <><span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span><div className="profile-details"><strong>{user.name}</strong><small>Minha conta Lastro</small></div><ChevronDown size={16} /></>}
    </summary>
    <div className="profile-menu-panel"><strong>{user.name}</strong><small>{user.email}</small><button onClick={() => { if (profileRef.current) profileRef.current.open = false; onPreferences() }}><Settings2 size={16} />Preferências</button><button onClick={onLogout} disabled={signingOut}><LogOut size={16} />{signingOut ? 'Saindo…' : 'Sair da conta'}</button></div>
  </details>
}

export default function Dashboard({ store, setStore, user, saveStatus, saveError, onRetrySave, onLogout, signingOut, legacyAvailable, onMigrate, onDismissMigration }: Props) {
  const [asOf, setAsOf] = useState(() => new Date())
  const [page, setPage] = useState<Page>('Visão geral')
  const [hidden, setHidden] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [dialog, setDialog] = useState<'import' | 'settings' | 'help' | null>(null)
  const [notifications, setNotifications] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos os ativos')
  const [period, setPeriod] = useState('1A')
  const [sort, setSort] = useState<AssetSort>('default')
  const [toast, setToast] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState('')
  const quoteAttemptDay = useRef('')
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 5500)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!dialog) return
    const lastFocus = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    modalRef.current?.querySelector<HTMLElement>('button')?.focus()
    function trap(event: KeyboardEvent) {
      if (event.key === 'Escape') setDialog(null)
      if (event.key !== 'Tab') return
      const items = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"]), select, a[href]')
      if (!items?.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', trap); lastFocus?.focus() }
  }, [dialog])
  const dailyCheck = useEffectEvent(() => {
    setAsOf(new Date())
    if (!dialog && store.auto && quoteAttemptDay.current !== today() && (store.quoteDay !== today() || store.quoteSource !== 'brapi')) void refreshQuotes()
  })
  useEffect(() => {
    if (!store.auto) return
    const timer = window.setInterval(dailyCheck, 60_000)
    return () => window.clearInterval(timer)
  }, [store.auto])

  const assets = store.assets
  const notePurchaseAverages = new Map(summarizeStorePurchases(store).map(item => [item.ticker, item.average] as const))
  const costBasisFor = (asset: Asset) => ({ ...asset, average: averageWithNoteFallback(asset, notePurchaseAverages) })
  const assetsWithNoteCosts = assets.map(costBasisFor)
  const patrimoine = total(assets)
  const invested = cost(assetsWithNoteCosts)
  const knownCost = assetsWithNoteCosts.length > 0 && assetsWithNoteCosts.every(asset => asset.average !== null)
  const profit = knownCost ? patrimoine - invested : null
  const prior = assets.reduce((sum, asset) => sum + asset.quantity * asset.previous, 0)
  const dayProfit = patrimoine - prior
  const allocation = classes.map(name => ({ name, value: total(assets.filter(asset => asset.type === name)) })).filter(item => item.value > 0)
  const visible = sortAssets(visibleHoldings(assets).filter(asset => (category === 'Todos os ativos' || asset.type === category) && `${asset.ticker} ${asset.name}`.toLowerCase().includes(search.toLowerCase())), sort)
  const visibleWithNoteCosts = visible.map(costBasisFor)
  const cash = (value: number | null) => hidden ? '••••••' : value === null ? '—' : money(value)
  const chartMonths = period === '1M' ? 1 : period === '3M' ? 3 : period === '6M' ? 6 : 12
  const demoHistory = Array.from({ length: 49 }, (_, index) => {
    const point = index / 48; const date = new Date(asOf)
    date.setDate(date.getDate() - (48 - index) * 7)
    return { date: date.toISOString().slice(0, 10), value: Math.round(patrimoine * (0.63 + 0.37 * point + Math.sin(index * 1.8) * 0.014 + Math.cos(index * 0.61) * 0.021)), reference: Math.round(patrimoine * (0.63 + 0.235 * point)) }
  })
  demoHistory[48].value = patrimoine
  const history = store.demo ? demoHistory.slice(-Math.ceil(chartMonths * 4.1)) : store.history.filter(item => period === 'Tudo' || new Date(item.date).getTime() >= asOf.getTime() - chartMonths * 31 * 86400000)

  function navigate(next: Page) { setPage(next); setMobileNav(false); setSearch(''); setCategory('Todos os ativos') }
  function removePricingNote(record: ImportRecord) {
    if (record.kind !== 'Compras B3 · preço médio') return
    if (!window.confirm(`Remover a nota “${record.name}”? As compras dela sairão do Preço Médio e o arquivo poderá ser importado novamente.`)) return
    setStore(current => removePricingNoteFromStore(current, record.id))
    setToast('Nota removida. As compras e o bloqueio de reimportação foram limpos.')
  }
  function exportPortfolio() {
    download(`lastro-carteira-${today()}.csv`, Papa.unparse(assets.map(asset => ({ Ativo: asset.ticker, Nome: asset.name, Tipo: asset.type, Quantidade: asset.quantity, 'Preço Médio': asset.average, Cotação: asset.price, 'Valor Atual': asset.quantity * asset.price, Resultado: asset.average === null ? '' : asset.quantity * (asset.price - asset.average) })), { delimiter: ';', escapeFormulae: true }))
    setToast('Carteira exportada com sucesso.')
  }
  async function refreshQuotes() {
    if (refreshing) return
    const symbols = [...new Set(assets
      .filter(asset => ['Ações', 'FIIs', 'Exterior'].includes(asset.type) && /^[A-Z0-9]{4,6}\d{1,2}$/.test(asset.ticker))
      .map(asset => asset.ticker))]
    if (!symbols.length) {
      setQuoteStatus('Nenhum ativo B3 compatível para consultar.')
      setToast('Nenhum ativo B3 compatível para consultar.')
      return
    }
    quoteAttemptDay.current = today()
    setRefreshing(true)
    setQuoteStatus('Consultando cotações reais…')
    try {
      const { quotes, updatedAt } = await api<{ quotes: Record<string, { price: number; asOf: string | null }>; updatedAt: string }>('/quotes', { symbols })
      const updatedAssets = store.assets.map(asset => {
        const quote = quotes[asset.ticker]
        return quote ? { ...asset, previous: asset.price, price: quote.price, quoteSource: 'brapi' as const, quoteAsOf: quote.asOf } : asset
      })
      const unavailable = symbols.filter(symbol => !quotes[symbol]).length
      const updated = new Date().toISOString()
      setStore(current => ({
        ...current,
        assets: current.assets.map(asset => {
          const quote = quotes[asset.ticker]
          return quote ? { ...asset, previous: asset.price, price: quote.price, quoteSource: 'brapi' as const, quoteAsOf: quote.asOf } : asset
        }),
        quoteDay: today(),
        quoteSource: 'brapi',
        updated,
        history: [...current.history.filter(item => item.date !== today()), { date: today(), value: total(updatedAssets) }],
      }))
      const time = new Date(updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      const message = unavailable
        ? `Cotações atualizadas às ${time}; ${unavailable} ativo(s) sem cobertura mantiveram o preço anterior.`
        : `Cotações reais atualizadas às ${time}.`
      setQuoteStatus(message)
      setToast(message)
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : 'Não foi possível atualizar as cotações.'
      setQuoteStatus(message)
      setToast(message)
    } finally {
      setRefreshing(false)
    }
  }

  return <div className="app-shell" data-page={page}>
    <section className="account-strip" aria-label="Conta e salvamento"><div><ShieldCheck size={15} /><strong>{user.name}</strong><span>{saveStatus === 'saved' ? 'Salvo na sua conta' : saveStatus === 'saving' || saveStatus === 'pending' ? 'Salvando carteira…' : 'Alterações não salvas'}</span></div></section>
    {saveError && <div className="account-notice save-failure" role="alert"><span>{saveError} Suas alterações continuam nesta página. Exporte a carteira antes de recarregar.</span>{saveStatus !== 'conflict' && <button className="button secondary" onClick={onRetrySave}>Tentar salvar novamente</button>}</div>}
    {legacyAvailable && <div className="account-notice"><div><strong>Há uma carteira salva neste navegador.</strong><p>Deseja transferi-la para a conta de {user.name}?</p></div><button className="button secondary" onClick={onDismissMigration}>Agora não</button><button className="button primary" onClick={onMigrate}>Transferir para minha conta</button></div>}
    {mobileNav && <button className="nav-scrim" aria-label="Fechar menu" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a href="#" className="brand" onClick={event => { event.preventDefault(); navigate('Visão geral') }} aria-label="Lastro, visão geral"><span className="brand-mark"><ChartNoAxesCombined size={25} strokeWidth={2.6} /></span>lastro<span className="brand-dot">.</span></a>
      <div className="workspace-switch"><span className="workspace-icon"><BriefcaseBusiness size={17} /></span><div><strong>Meu patrimônio</strong><small>Carteira principal</small></div><ShieldCheck size={16} /></div>
      <span className="nav-caption">PRINCIPAL</span>
      <nav aria-label="Navegação principal">{navigation.map(({ title, icon: Icon }) => <button key={title} className={`nav-item ${page === title ? 'active' : ''}`} onClick={() => navigate(title)}><Icon size={19} /><span>{title}</span>{title === 'Importações' && <span className="nav-count">{store.imports.length || <Plus size={12} />}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={23} /><strong>Seu patrimônio.<br />Sob seu controle.</strong><p>Dados privados, decisões<br />com mais clareza.</p><span className="local-badge"><i /> Carteira protegida por login</span></div><button className="nav-item" onClick={() => setDialog('settings')}><Settings2 size={18} /><span>Preferências</span></button><button className="nav-item" onClick={() => setDialog('help')}><CircleHelp size={18} /><span>Central de ajuda</span><ArrowUpRight size={14} /></button><UserProfile user={user} onLogout={onLogout} signingOut={signingOut} onPreferences={() => setDialog('settings')} /></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={21} /></button><span>Meu patrimônio</span><ChevronRight size={13} /><strong>{page}</strong></div><div className="topbar-right"><span className="top-date">{asOf.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span><span className="header-divider" /><button className="icon-button" title={hidden ? 'Mostrar valores' : 'Ocultar valores'} onClick={() => setHidden(!hidden)}>{hidden ? <EyeOff size={18} /> : <Eye size={18} />}</button><div className="notification-wrap"><button className="icon-button" title="Notificações" onClick={() => setNotifications(!notifications)} aria-expanded={notifications}><Bell size={18} /></button>{notifications && <div className="notification-panel"><strong>Notificações</strong><p>{store.imports.length ? `Última importação: ${store.imports[0].name}` : 'Tudo em dia. Nenhuma nova notificação.'}</p><small>Cotações em modo de simulação.</small></div>}</div><UserProfile user={user} compact onLogout={onLogout} signingOut={signingOut} onPreferences={() => setDialog('settings')} /></div></header>
      <main><div className="page-heading"><div><div className="eyebrow"><i /> SEU PATRIMÔNIO, POR INTEIRO</div><h1>{page === 'Visão geral' ? 'Clareza para o seu próximo passo.' : page}</h1><p>{page === 'Visão geral' ? 'Todos os seus investimentos. Uma visão completa.' : page === 'News Mercado' ? 'Destaques recentes da seção Onde Investir.' : page === 'Minha carteira' ? 'Cada ativo, cada detalhe do seu patrimônio.' : page === 'Preço Médio' ? 'Compras consolidadas e resultado estimado de venda.' : page === 'Importações' ? 'Seus arquivos e movimentações, em um só lugar.' : 'Os números que contam a história da sua carteira.'}</p></div>{page !== 'Preço Médio' && page !== 'News Mercado' && <button className="button primary" onClick={() => setDialog('import')}><Plus size={17} />Importar investimentos</button>}</div>
        <div className={`portfolio-toolbar ${page === 'News Mercado' ? 'news-market-toolbar' : ''}`}><div className="portfolio-name"><i /><strong>Carteira principal</strong><span className={`status-pill ${store.demo ? '' : 'real'}`}>{store.demo ? 'Demonstrativa' : 'Dados importados'}</span></div><div className="sync-info"><i /><span>{quoteStatus || (store.quoteSource === 'brapi' && store.updated ? `Brapi · ${new Date(store.updated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Preço do extrato; sem cotação real')}</span><button className="icon-button" title="Atualizar cotações reais" aria-label="Atualizar cotações reais" disabled={refreshing} onClick={refreshQuotes}><RefreshCw size={14} className={refreshing ? 'spinning' : ''} /></button></div></div>
        {(page === 'Visão geral' || page === 'Relatórios') && <>
          <section className="summary-grid" aria-label="Resumo patrimonial">
            <article className="metric-card principal"><div className="metric-label">Patrimônio total<Wallet size={17} /></div><strong className="metric-value">{cash(patrimoine)}</strong><div className="metric-footer"><span>em {assets.length} ativos</span><TrendingUp className="tiny-graph" size={39} strokeWidth={1.4} /></div></article>
            <article className="metric-card"><div className="metric-label">Valor investido<ArrowDownLeft size={17} /></div><strong className="metric-value">{cash(knownCost ? invested : null)}</strong><div className="metric-footer"><span>{knownCost ? 'Custo total de aquisição' : 'Preço médio pendente'}</span></div></article>
            <article className="metric-card"><div className="metric-label">Lucro total<TrendingUp size={17} /></div><strong className={`metric-value ${profit !== null && profit < 0 ? 'negative' : 'positive'}`}>{cash(profit)}</strong><div className="metric-footer"><span className={`change-badge ${profit !== null && profit < 0 ? 'loss' : ''}`}><ArrowUpRight size={12} />{hidden ? '•••' : profit !== null && invested > 0 ? percent(profit / invested * 100) : '—'}</span><span>sobre o investimento</span></div></article>
            <article className="metric-card"><div className="metric-label">Resultado do dia<ChartNoAxesCombined size={17} /></div><strong className={`metric-value ${dayProfit < 0 ? 'negative' : 'positive'}`}>{cash(dayProfit)}</strong><div className="metric-footer"><span className={`change-badge ${dayProfit < 0 ? 'loss' : ''}`}><ArrowUpRight size={12} />{hidden ? '•••' : percent(prior ? dayProfit / prior * 100 : 0)}</span><span>{store.demo || store.quoteDay ? 'simulação diária' : 'desde a importação'}</span></div></article>
          </section>
          <div className="charts-grid"><section className="evolution-panel"><div className="panel-heading"><div><h2>Evolução patrimonial <span className="info-mark" title={store.demo ? 'Histórico ilustrativo' : 'Histórico registrado no navegador'}>i</span></h2><p>{store.demo ? 'Uma perspectiva do seu crescimento' : 'Patrimônio registrado no navegador'}</p></div><div className="period-control" aria-label="Período do gráfico">{['1M', '3M', '6M', '1A', 'Tudo'].map(item => <button key={item} className={period === item ? 'selected' : ''} onClick={() => setPeriod(item)}>{item}</button>)}</div></div><div className="chart-value-line"><span>{cash(patrimoine)}</span><small>{store.demo ? 'Histórico ilustrativo' : `${history.length} registro(s)`}</small></div><div className="area-chart">{history.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ left: 0, right: 12, top: 15, bottom: 0 }}><defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2c8263" stopOpacity={0.19} /><stop offset="100%" stopColor="#2c8263" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ee" strokeDasharray="3 4" /><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={44} tick={{ fontSize: 10, fill: '#8b928f' }} tickFormatter={value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')} dy={9} /><YAxis axisLine={false} tickLine={false} width={57} tick={{ fontSize: 10, fill: '#8b928f' }} tickFormatter={value => hidden ? '•••' : `${Math.round(value / 1000)} mil`} domain={['auto', 'auto']} tickCount={5} /><Tooltip labelFormatter={value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')} formatter={value => cash(Number(value))} contentStyle={{ borderRadius: 6, border: '1px solid #e3e8e4', fontSize: 12 }} /><Area name="Patrimônio" type="monotone" dataKey="value" stroke="#28795b" fill="url(#portfolioFill)" strokeWidth={2.3} animationDuration={900} />{store.demo && <Area name="Referência ilustrativa" type="monotone" dataKey="reference" stroke="#c5af7e" strokeDasharray="5 5" fill="transparent" strokeWidth={1.3} />}</AreaChart></ResponsiveContainer> : <div className="chart-empty"><ChartNoAxesCombined size={30} /><strong>Um novo ponto de partida</strong><span>O histórico será registrado nas próximas atualizações diárias.</span></div>}</div><div className="chart-legend"><span><i />Meu patrimônio</span>{store.demo && <span><i className="dashed-key" />Referência ilustrativa</span>}<small>Valores em reais (R$)</small></div></section>
            <section className="allocation-panel"><div className="panel-heading"><div><h2>Onde você investe</h2><p>Alocação por classe de ativo</p></div><BriefcaseBusiness className="subtle-icon" size={18} /></div><div className="donut-wrapper"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={allocation} dataKey="value" nameKey="name" innerRadius={66} outerRadius={83} paddingAngle={3} cornerRadius={3} stroke="none" startAngle={90} endAngle={-270}>{allocation.map(item => <Cell key={item.name} fill={colors[item.name]} />)}</Pie><Tooltip formatter={value => cash(Number(value))} contentStyle={{ borderRadius: 6, border: '1px solid #e3e8e4', fontSize: 12 }} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{allocation.length}</strong><small>classes de ativos</small></div></div><div className="allocation-legend">{allocation.map(item => <button key={item.name} onClick={() => { setCategory(item.name); setPage('Minha carteira') }}><span><i style={{ background: colors[item.name] }} />{item.name}</span><strong>{patrimoine ? (item.value / patrimoine * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '0'}<small>%</small></strong></button>)}</div></section></div>
        </>}
        {(page === 'Visão geral' || page === 'Minha carteira') && <section className="holdings-section"><div className="holdings-heading"><div className="holdings-title"><h2>Meus investimentos</h2><span className="count-badge">{assets.length} ativos</span></div><button className="text-button" onClick={exportPortfolio}><ArrowDownToLine size={15} />Exportar carteira</button></div><div className="holdings-controls"><div className="asset-tabs"><button className={category === 'Todos os ativos' ? 'active' : ''} onClick={() => setCategory('Todos os ativos')}>Todos os ativos<span>{assets.length}</span></button>{classes.filter(type => assets.some(asset => asset.type === type)).map(type => <button key={type} className={category === type ? 'active' : ''} onClick={() => setCategory(type)}>{type}</button>)}</div><div className="table-tools"><label className="search-box"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar ativo" aria-label="Buscar ativo" />{search && <button className="icon-button" aria-label="Limpar busca" onClick={() => setSearch('')}><X size={12} /></button>}</label><label className="sort-control" title="Ordenar ativos"><SlidersHorizontal size={15} /><select aria-label="Ordenar ativos" value={sort} onChange={event => setSort(event.target.value as AssetSort)}><option value="default">Ordem original</option><option value="ticker-asc">Ativo (A–Z)</option><option value="ticker-desc">Ativo (Z–A)</option><option value="value-desc">Maior valor</option><option value="value-asc">Menor valor</option></select></label></div></div><div className="table-scroll"><table className="assets-table holdings-assets-table"><colgroup>{holdingsColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}</colgroup><thead><tr>{holdingsColumns.map(column => <HoldingColumnHeader key={column.key} column={column} />)}</tr></thead><tbody>{visible.map(asset => {
          const assetAverage = averageWithNoteFallback(asset, notePurchaseAverages)
          const assetCost = assetAverage === null ? null : asset.quantity * assetAverage
          const result = assetCost === null ? null : asset.quantity * asset.price - assetCost
          return <tr key={asset.ticker}><td><div className={`asset-identity${asset.quoteSource === 'brapi' ? ' quoted' : ''}`} title={asset.quoteAsOf ? `Cotação brapi de ${new Date(asset.quoteAsOf).toLocaleString('pt-BR')}` : undefined}><span className={`asset-logo logo-${asset.ticker}`}><span>{asset.type === 'Cripto' ? '₿' : asset.ticker.slice(0, 2)}</span>{asset.type === 'Ações' && <img src={`https://icons.brapi.dev/icons/${asset.ticker}.svg`} alt="" onError={event => { event.currentTarget.style.display = 'none' }} />}{asset.type === 'Renda fixa' && <span className="logo-cover"><ShieldCheck size={19} /></span>}{asset.type === 'FIIs' && <span className="logo-cover"><BriefcaseBusiness size={18} /></span>}{asset.type === 'Exterior' && <span className="logo-cover"><ChartNoAxesCombined size={19} /></span>}</span><div><strong>{asset.ticker}</strong><small>{asset.name}</small></div></div></td><td><span className="class-tag"><i style={{ background: colors[asset.type] }} />{asset.type}</span></td><td className="number quantity">{asset.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</td><td className="number">{cash(asset.average)}</td><td className="number" title={asset.quoteAsOf ? `brapi · ${new Date(asset.quoteAsOf).toLocaleString('pt-BR')}` : 'Sem cotação brapi confirmada'}>{cash(asset.quoteSource === 'brapi' && asset.quoteAsOf ? asset.price : null)}</td><td className="number">{cash(notePurchaseAverages.get(asset.ticker) ?? null)}</td><td className="number">{cash(assetCost)}</td><td className="number current-value">{cash(asset.quantity * asset.price)}</td><td className={`number result ${result !== null && result < 0 ? 'negative' : 'positive'}`}><strong>{cash(result)}</strong><small>{hidden ? '•••' : result !== null && assetCost ? percent(result / assetCost * 100) : 'Custo pendente'}</small></td><td className="number"><span className="allocation-number">{patrimoine ? (asset.quantity * asset.price / patrimoine * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}%</span><span className="allocation-track"><i style={{ width: `${patrimoine ? asset.quantity * asset.price / patrimoine * 100 : 0}%` }} /></span></td></tr>
        })}</tbody>{visible.length > 0 && <tfoot><tr><td colSpan={4}>Total {category !== 'Todos os ativos' && `· ${category}`}</td><td className="number">—</td><td className="number">—</td><td className="number">{cash(visibleWithNoteCosts.every(asset => asset.average !== null) ? cost(visibleWithNoteCosts) : null)}</td><td className="number">{cash(total(visible))}</td><td className={`number ${total(visible) < cost(visibleWithNoteCosts) ? 'negative' : 'positive'}`}>{cash(visibleWithNoteCosts.every(asset => asset.average !== null) ? total(visible) - cost(visibleWithNoteCosts) : null)}</td><td className="number">{patrimoine ? (total(visible) / patrimoine * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : 0}%</td></tr></tfoot>}</table></div>{!visible.length && <div className="empty-state"><Search size={28} /><h3>Nenhum ativo encontrado</h3><p>Tente outro nome ou classe de ativo.</p><button className="button secondary" onClick={() => { setSearch(''); setCategory('Todos os ativos') }}>Limpar filtros</button></div>}<div className="table-footer"><span>{visible.length} de {assets.length} ativos<span className="footer-separator">·</span>Valores em BRL</span><span className="table-disclaimer"><ShieldCheck size={13} />{store.demo ? 'Carteira demonstrativa' : 'Carteira vinculada à sua conta'}</span></div></section>}
        {page === 'Importações' && <section className="import-page"><div className="import-page-heading"><span className="modal-symbol"><FolderUp size={27} /></span><div><h2>Seus arquivos. Seu ponto de partida.</h2><p>Extratos CSV e notas de compra em PDF ou texto.</p></div><button className="button primary" onClick={() => setDialog('import')}><Plus size={16} />Nova importação</button></div><div className="section-title"><h2>Histórico de importações</h2><span className="count-badge">{store.imports.length} arquivos</span></div>{store.imports.length ? store.imports.map(record => <div className="history-row" key={record.id}><FileCheck2 size={25} /><div><strong>{record.name}</strong><small>{record.kind} · {record.count} registros</small></div><span className="history-date">{new Date(record.date).toLocaleString('pt-BR')}</span><span className="success-label"><Check size={15} />Concluído</span>{record.kind === 'Compras B3 · preço médio' && <button className="icon-button" title="Remover nota" aria-label={`Remover nota ${record.name}`} onClick={() => removePricingNote(record)}><Trash2 size={16} /></button>}</div>) : <div className="empty-state"><FolderUp size={35} /><h3>Um lugar para cada importação</h3><p>Seus arquivos importados aparecerão aqui.</p><button className="button secondary" onClick={() => setDialog('import')}><Plus size={15} />Importar primeiro arquivo</button></div>}</section>}
        {page === 'Relatórios' && <section className="report-section"><div className="holdings-heading"><div><h2>Composição e resultado</h2><p>Consolidado por classe de ativo</p></div><button className="button secondary" onClick={exportPortfolio}><ArrowDownToLine size={16} />Exportar dados</button></div><div className="table-scroll"><table className="assets-table"><thead><tr><th>Classe</th><th className="number">Ativos</th><th className="number">Custo de aquisição</th><th className="number">Patrimônio atual</th><th className="number">Resultado</th></tr></thead><tbody>{allocation.map(item => { const group = assets.filter(asset => asset.type === item.name); const groupCost = group.every(asset => asset.average !== null) ? cost(group) : null; return <tr key={item.name}><td><span className="class-tag"><i style={{ background: colors[item.name] }} />{item.name}</span></td><td className="number">{group.length}</td><td className="number">{cash(groupCost)}</td><td className="number current-value">{cash(item.value)}</td><td className={`number ${groupCost !== null && item.value < groupCost ? 'negative' : 'positive'}`}>{cash(groupCost === null ? null : item.value - groupCost)}</td></tr> })}</tbody></table></div></section>}
        <NewsMercadoPage active={page === 'News Mercado'} />
        <AveragePricePage active={page === 'Preço Médio'} store={store} setStore={setStore} hidden={hidden} />
        <div className="bottom-note"><span><ShieldCheck size={14} />Seu futuro merece uma visão completa.</span><span>{store.demo ? 'Dados demonstrativos' : 'Dados da sua conta'}<span className="footer-separator">·</span>{store.quoteSource === 'brapi' ? 'Cotações brapi podem ter atraso; confira antes de negociar.' : 'Cotação importada, pode estar desatualizada.'}</span></div>
      </main><footer className="app-footer"><span className="footer-brand">lastro<span>.</span></span><span>Mais clareza. Melhores decisões.</span><span>Portal de consolidação patrimonial</span></footer>
    </div>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button className="icon-button" aria-label="Fechar notificação" onClick={() => setToast('')}><X size={15} /></button></div>}
    {dialog && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setDialog(null) }}><div ref={modalRef} className={`modal ${dialog === 'import' ? 'import-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="icon-button modal-close" aria-label="Fechar janela" onClick={() => setDialog(null)}><X size={20} /></button>
      {dialog === 'import' && <ImportDialog store={store} hidden={hidden} onClose={() => setDialog(null)} onConfirm={next => { setStore(next); setDialog(null); setToast('Arquivo processado. Salvando investimentos na sua conta…') }} />}
      {dialog === 'settings' && <><span className="modal-symbol"><Settings2 size={25} /></span><h2 id="modal-title">Suas preferências</h2><p className="modal-subtitle">Controle os dados da sua carteira.</p><div className="setting-row"><div><strong>Atualização diária de cotações</strong><p>Consulta a brapi uma vez por dia enquanto o portal estiver aberto.</p></div><button role="switch" aria-checked={store.auto} aria-label="Atualização diária de cotações" className={`toggle ${store.auto ? 'on' : ''}`} onClick={() => setStore(current => ({ ...current, auto: !current.auto }))}><span /></button></div><div className="setting-row"><div><strong>Privacidade dos valores</strong><p>Ocultar valores financeiros na interface.</p></div><button role="switch" aria-checked={hidden} aria-label="Ocultar valores" className={`toggle ${hidden ? 'on' : ''}`} onClick={() => setHidden(!hidden)}><span /></button></div><div className="privacy-box"><ShieldCheck size={20} /><p>Os arquivos são processados no navegador. Os dados extraídos são salvos em JSON privado no servidor, vinculados à sua conta. Não há conexão com corretoras.</p></div><button className="button secondary full-width" onClick={exportPortfolio}><ArrowDownToLine size={16} />Exportar minha carteira</button></>}
      {dialog === 'help' && <><span className="modal-symbol"><CircleHelp size={25} /></span><h2 id="modal-title">Central de ajuda</h2><p className="modal-subtitle">Informações sobre os seus dados.</p><div className="help-content"><h3>Extratos de posições</h3><p>CSV com ativo, quantidade e cotação unitária ou valor atual total. Sem preço médio, o lucro fica pendente. Separadores vírgula e ponto e vírgula são aceitos.</p><h3>Notas de compra</h3><p>PDF com texto selecionável ou TXT no padrão: <code>COMPRA PETR4 100 32,50</code>. Outros layouts e PDFs digitalizados não são reconhecidos automaticamente. Vendas e taxas não são processadas.</p><h3>Conciliação de custo</h3><p>Preserva as quantidades do extrato e calcula o preço médio pelas notas. O histórico de compras precisa cobrir a quantidade total do ativo.</p><h3>Cotações e moedas</h3><p>A brapi pode atualizar tickers B3 cobertos pelo plano. Sem chave ou sem cobertura, mantém-se o preço do extrato. Outros valores devem estar em reais; o resultado não inclui dividendos, impostos ou taxas.</p></div></>}
    </div></div>}
  </div>
}