import { describe, expect, it, vi } from 'vitest'
import { fetchBrapiQuotes, QuoteProviderError } from './quotes.mjs'

describe('cotações brapi', () => {
  it('consulta cada ticker separadamente e mantém resultados parciais', async () => {
    const fetchImpl = vi.fn(async url => {
      const symbol = new URL(url).searchParams.get('symbols')
      return new Response(JSON.stringify({
        requestedAt: '2026-11-05T15:00:00.000Z',
        results: symbol === 'TRXF11' ? [{ requestedSymbol: symbol, data: { regularMarketPrice: 64.21, regularMarketTime: '2026-11-05T14:59:00.000Z' } }] : [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const quotes = await fetchBrapiQuotes(['TRXF11', 'HGLG11'], 'test-key', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).searchParams.get('symbols'))).toEqual(['TRXF11', 'HGLG11'])
    expect(fetchImpl.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer test-key')).toBe(true)
    expect(quotes).toEqual({ TRXF11: { price: 64.21, asOf: '2026-11-05T14:59:00.000Z' } })
  })

  it('recusa consulta sem chave sem fazer requisição externa', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchBrapiQuotes(['TRXF11'], '', fetchImpl)).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('traduz limite do provedor sem substituir a cotação atual', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }))
    await expect(fetchBrapiQuotes(['TRXF11'], 'test-key', fetchImpl))
      .rejects.toThrowError(new QuoteProviderError(503, 'Limite de consultas do provedor atingido. Tente mais tarde.'))
  })
})