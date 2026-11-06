import { describe, expect, it, vi } from 'vitest'
import { fetchInfoMoneyNews, parseInfoMoneyPage } from './news.mjs'

const page = `<main><a href="/onde-investir/">Onde Investir</a><article><a href="/onde-investir/destaque-selic/"><img src="/wp-content/uploads/destaque.jpg"/><h2>Selic e investimentos: destaque do dia</h2></a></article><article><a href="https://www.infomoney.com.br/onde-investir/fii-em-alta/"><h2>FIIs em alta: análise do mercado</h2></a></article><a href="/politica/outro-tema/">Notícia fora da seção</a><a href="https://example.com/noticia">Link externo</a></main>`

describe('notícias InfoMoney Onde Investir', () => {
  it('extrai manchetes da seção e ignora navegação, duplicatas e links externos', () => {
    expect(parseInfoMoneyPage(page)).toEqual([
      { title: 'Selic e investimentos: destaque do dia', url: 'https://www.infomoney.com.br/onde-investir/destaque-selic/', image: 'https://www.infomoney.com.br/wp-content/uploads/destaque.jpg', publishedAt: null, categories: ['InfoMoney'] },
      { title: 'FIIs em alta: análise do mercado', url: 'https://www.infomoney.com.br/onde-investir/fii-em-alta/', image: null, publishedAt: null, categories: ['InfoMoney'] },
    ])
  })

  it('busca a página indicada pelo usuário', async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.headers.Accept).toBe('text/html')
      return new Response(page, { status: 200 })
    })
    expect(await fetchInfoMoneyNews(fetchImpl)).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://www.infomoney.com.br/onde-investir/')
  })
})