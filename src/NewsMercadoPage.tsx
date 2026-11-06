import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle, Newspaper, TriangleAlert } from 'lucide-react'
import { api } from './account'
import './marketNews.css'

type Article = { title: string; url: string; image: string | null; publishedAt: string | null; categories: string[] }
type Feed = { day: string; fetchedAt: string; articles: Article[]; stale?: boolean }

type Props = { active: boolean }

export function NewsMercadoPage({ active }: Props) {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    api<Feed>('/news')
      .then(result => { if (!cancelled) { setFeed(result); setError('') } })
      .catch(issue => { if (!cancelled) setError(issue instanceof Error ? issue.message : 'Não foi possível carregar as notícias.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active, retry])

  return (
    <section className="market-news-page" hidden={!active}>
      <header className="market-news-heading">
        <div className="market-news-brand"><span className="market-news-icon"><Newspaper size={20} /></span><div><h2>Destaques do mercado</h2><p>Manchetes da seção Onde Investir, do InfoMoney.</p></div></div>
        <a className="text-button market-news-source" href="https://www.infomoney.com.br/onde-investir/" target="_blank" rel="noreferrer">Fonte: InfoMoney<ExternalLink size={14} /></a>
      </header>
      {feed && <div className={`market-news-status ${feed.stale ? 'is-stale' : ''}`} role="status">
        {feed.stale && <TriangleAlert size={14} />}
        {feed.stale ? 'Feed indisponível; mostrando a última coleta salva.' : `Coletado em ${new Date(feed.fetchedAt).toLocaleString('pt-BR')}. Atualização diária.`}
      </div>}
      {loading && <div className="market-news-state"><LoaderCircle size={20} className="spinning" /><span>Carregando destaques…</span></div>}
      {!loading && error && <div className="market-news-error" role="alert"><TriangleAlert size={17} /><span>{error}</span><button className="button secondary" onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Tentar novamente</button></div>}
      {!loading && !error && feed?.articles.length === 0 && <div className="market-news-state">Nenhum destaque disponível no feed hoje.</div>}
      {!loading && !error && feed && feed.articles.length > 0 && <ol className="market-news-list">{feed.articles.map(article => (
        <li key={article.url}>
          <a className="market-news-image" href={article.url} target="_blank" rel="noreferrer" aria-label={`Abrir: ${article.title}`}>
            {article.image ? <img src={article.image} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : <span className="market-news-image-fallback"><Newspaper size={25} /></span>}
          </a>
          <div className="market-news-body">
            <div className="market-news-meta">{article.publishedAt && <time dateTime={article.publishedAt}>{new Date(article.publishedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>}{article.categories.filter(category => category !== 'Onde Investir').slice(0, 2).map(category => <span className="market-news-tag" key={category}>{category}</span>)}</div>
            <a className="market-news-title" href={article.url} target="_blank" rel="noreferrer"><span>{article.title}</span><ExternalLink size={15} /></a>
            <span className="market-news-source-label">InfoMoney</span>
          </div>
        </li>
      ))}</ol>}
      <p className="market-news-disclaimer">Conteúdo e links pertencem ao InfoMoney. Acompanhe a matéria original antes de tomar decisões.</p>
    </section>
  )
}