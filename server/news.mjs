import { load } from 'cheerio'

const pageUrl = 'https://www.infomoney.com.br/onde-investir/'

export class NewsProviderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NewsProviderError'
  }
}

export function parseInfoMoneyPage(html) {
  const $ = load(html)
  const articles = []
  const seen = new Set()

  $('a[href]').each((_index, element) => {
    let url
    try { url = new URL($(element).attr('href'), pageUrl) } catch { return }
    const title = $(element).text().replace(/\s+/g, ' ').trim()
    if (url.origin !== new URL(pageUrl).origin || !url.pathname.startsWith('/onde-investir/') || url.pathname === '/onde-investir/' || !title || seen.has(url.href)) return
    if (title.length > 240) return
    let node = $(element)
    let image = null
    for (let depth = 0; depth < 8; depth++) {
      const source = node.find('img').first().attr('src')
      if (source) {
        try {
          const imageUrl = new URL(source, pageUrl)
          if (imageUrl.hostname === 'www.infomoney.com.br' && imageUrl.protocol === 'https:') image = imageUrl.href
        } catch {}
        if (image) break
      }
      const tag = node.get(0)?.tagName
      if (tag === 'article' || tag === 'li') break
      node = node.parent()
    }
    seen.add(url.href)
    articles.push({ title, url: url.href, image, publishedAt: null, categories: ['InfoMoney'] })
  })
  if (!articles.length) throw new NewsProviderError('A página Onde Investir não retornou manchetes reconhecíveis.')
  return articles
}

export async function fetchInfoMoneyNews(fetchImpl = fetch) {
  let response
  try {
    response = await fetchImpl(pageUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new NewsProviderError('Não foi possível conectar ao feed do InfoMoney.')
  }
  if (!response.ok) throw new NewsProviderError(`A página Onde Investir respondeu com HTTP ${response.status}.`)
  return parseInfoMoneyPage(await response.text())
}