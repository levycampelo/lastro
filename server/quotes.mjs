export class QuoteProviderError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function fetchBrapiQuotes(symbols, apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new QuoteProviderError(503, 'Configure BRAPI_API_KEY no servidor para consultar cotações reais.')

  const quotes = {}
  for (const symbol of [...new Set(symbols)]) {
    const url = new URL('https://brapi.dev/api/v2/stocks/quote')
    url.searchParams.set('symbols', symbol)
    let response
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new QuoteProviderError(502, 'Não foi possível conectar ao provedor de cotações.')
    }

    if (!response.ok) {
      if (response.status === 401) throw new QuoteProviderError(503, 'A chave BRAPI_API_KEY está ausente ou inválida.')
      if (response.status === 403) throw new QuoteProviderError(503, 'O plano do provedor não inclui estas cotações.')
      if (response.status === 429) throw new QuoteProviderError(503, 'Limite de consultas do provedor atingido. Tente mais tarde.')
      if (response.status === 400 || response.status === 404) continue
      throw new QuoteProviderError(502, 'O provedor não conseguiu consultar as cotações solicitadas.')
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new QuoteProviderError(502, 'O provedor retornou uma resposta inválida.')
    }

    const result = payload.results?.find(item => String(item.requestedSymbol || item.symbol).toUpperCase() === symbol.toUpperCase())
    const price = result?.data?.regularMarketPrice
    if (Number.isFinite(price) && price > 0) {
      quotes[symbol.toUpperCase()] = { price, asOf: result.data.regularMarketTime || payload.requestedAt || null }
    }
  }
  if (!Object.keys(quotes).length) throw new QuoteProviderError(404, 'Nenhuma cotação foi encontrada para os ativos consultados.')
  return quotes
}