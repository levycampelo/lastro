import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createApp } from './app.mjs'
import { createStorage } from './storage.mjs'

let server, directory, base, first, second
let newsFetchCount = 0
const origin = 'http://localhost:5173'
const password = 'Synthetic-test-password-2026'
const emptyStore = { assets: [], demo: false, imports: [], hashes: [], purchases: [], history: [], updated: null, quoteDay: '', auto: false }
async function request(route, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
  return fetch(`${base}${route}`, { method, headers: { Origin: requestOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function register(email, name) {
  const response = await request('/api/auth/register', { method: 'POST', body: { email, name, password } })
  expect(response.status).toBe(201)
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'lastro-auth-'))
  server = createApp({ directory, origin: [origin, 'http://127.0.0.1:5173'], quoteProvider: async symbols => Object.fromEntries(symbols.map(symbol => [symbol, { price: 64.21, asOf: '2026-11-05T14:59:00.000Z' }])), newsProvider: async () => { newsFetchCount++; return [{ title: 'Destaque de teste', url: 'https://www.infomoney.com.br/onde-investir/teste/', publishedAt: '2026-11-06T13:00:00.000Z', categories: ['Onde Investir'] }] } }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  first = await register('first@example.test', 'Cliente A')
  second = await register('second@example.test', 'Cliente B')
})
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })

describe('autenticação e acesso às carteiras', () => {
  it('bloqueia leitura e escrita sem sessão', async () => {
    expect((await request('/api/portfolio')).status).toBe(401)
    expect((await request('/api/portfolio', { method: 'PUT', body: { revision: 0, store: emptyStore } })).status).toBe(401)
  })
  it('salva somente a carteira do cliente autenticado, mesmo com outro id no corpo', async () => {
    const saved = await request('/api/portfolio', { method: 'PUT', cookie: first.cookie, body: { revision: 0, store: emptyStore, userId: second.user.id } })
    expect(saved.status).toBe(200)
    expect((await (await request('/api/portfolio', { cookie: first.cookie })).json()).revision).toBe(1)
    expect(await (await request('/api/portfolio', { cookie: second.cookie })).json()).toEqual({ revision: 0, store: null })
  })
  it('recusa origem externa, formato inválido e revisão desatualizada', async () => {
    expect((await request('/api/portfolio', { method: 'PUT', cookie: first.cookie, requestOrigin: 'https://other.example', body: {} })).status).toBe(403)
    expect((await request('/api/portfolio', { method: 'PUT', cookie: first.cookie, body: { revision: 1, store: { ...emptyStore, assets: [{ ticker: '../other' }] } } })).status).toBe(400)
    expect((await request('/api/portfolio', { method: 'PUT', cookie: first.cookie, body: { revision: 0, store: emptyStore } })).status).toBe(409)
  })
  it('aceita carteiras de fundos e previdência com custo desconhecido', async () => {
    const assets = ['Fundos', 'Previdência'].map((type, index) => ({ ticker: `FUNDO-${index}`, name: `Fundo de teste ${index}`, type, quantity: 10, price: 100, previous: 100, average: null }))
    const result = await request('/api/portfolio', { method: 'PUT', cookie: second.cookie, body: { revision: 0, store: { ...emptyStore, assets } } })
    expect(result.status).toBe(200)
    expect((await result.json()).store.assets.map(asset => asset.type)).toEqual(['Fundos', 'Previdência'])
  })
  it('persiste compras analisadas sem alterar posições da carteira', async () => {
    const savedPortfolio = await request('/api/portfolio', { cookie: second.cookie })
    const { revision } = await savedPortfolio.json()
    const pricingNotes = [{ importId: 'note-1', hash: 'a'.repeat(64), purchases: [{ ticker: 'PETR4', quantity: 100, price: 30, type: 'Ações' }] }]
    const saved = await request('/api/portfolio', { method: 'PUT', cookie: second.cookie, body: { revision, store: { ...emptyStore, pricingNotes } } })
    expect(saved.status).toBe(200)
    expect((await saved.json()).store).toMatchObject({ assets: [], pricingNotes })
  })
  it('serve cotações apenas para a sessão autenticada e valida tickers', async () => {
    expect((await request('/api/quotes', { method: 'POST', body: { symbols: ['TRXF11'] } })).status).toBe(401)
    const response = await request('/api/quotes', { method: 'POST', cookie: first.cookie, body: { symbols: ['TRXF11', 'TRXF11'] } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ quotes: { TRXF11: { price: 64.21 } } })
    expect((await request('/api/quotes', { method: 'POST', cookie: first.cookie, body: { symbols: ['../secrets'] } })).status).toBe(400)
  })
  it('serve notícias autenticadas e reutiliza a coleta diária do RSS', async () => {
    expect((await request('/api/news')).status).toBe(401)
    const firstResponse = await request('/api/news', { cookie: first.cookie })
    const secondResponse = await request('/api/news', { cookie: second.cookie })
    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect((await firstResponse.json()).articles[0].title).toBe('Destaque de teste')
    expect(newsFetchCount).toBe(1)
  })
  it('protege senhas com hash e nunca devolve credenciais na sessão', async () => {
    const account = JSON.parse(await readFile(path.join(directory, 'clients', `${first.user.id}.json`), 'utf8'))
    expect(account.passwordHash).toMatch(/^scrypt:/)
    expect(JSON.stringify(account)).not.toContain(password)
    const response = await request('/api/auth/me', { cookie: first.cookie })
    expect(await response.json()).toEqual({ user: first.user })
    const sessions = await readdir(path.join(directory, 'sessions'))
    expect(sessions).not.toContain(`${first.cookie.split('=')[1]}.json`)
  })
  it('usa cookie HttpOnly, SameSite e rejeita senha incorreta', async () => {
    const invalid = await request('/api/auth/login', { method: 'POST', body: { email: 'first@example.test', password: 'Incorrect-test-password' } })
    expect(invalid.status).toBe(401)
    const valid = await request('/api/auth/login', { method: 'POST', body: { email: 'first@example.test', password } })
    expect(valid.status).toBe(200)
    expect(valid.headers.get('set-cookie')).toContain('HttpOnly')
    expect(valid.headers.get('set-cookie')).toContain('SameSite=Lax')
    const loopbackOrigin = await request('/api/auth/login', { method: 'POST', requestOrigin: 'http://127.0.0.1:5173', body: { email: 'first@example.test', password } })
    expect(loopbackOrigin.status).toBe(200)
  })
  it('exige pelo menos seis caracteres na senha', async () => {
    const tooShort = await request('/api/auth/register', { method: 'POST', body: { name: 'Cliente C', email: 'third@example.test', password: 'abcde' } })
    expect(tooShort.status).toBe(400)
    const accepted = await request('/api/auth/register', { method: 'POST', body: { name: 'Cliente C', email: 'third@example.test', password: 'abc123' } })
    expect(accepted.status).toBe(201)
    const login = await request('/api/auth/login', { method: 'POST', body: { email: 'third@example.test', password: 'abc123' } })
    expect(login.status).toBe(200)
  })
  it('invalida a sessão no logout e rejeita cadastro duplicado', async () => {
    expect((await request('/api/auth/register', { method: 'POST', body: { name: 'Outro nome', email: 'SECOND@EXAMPLE.TEST', password } })).status).toBe(409)
    expect((await request('/api/auth/logout', { method: 'POST', cookie: second.cookie, body: {} })).status).toBe(200)
    expect((await request('/api/portfolio', { cookie: second.cookie })).status).toBe(401)
  })
  it('recupera sessões após reinício e usa cookie Secure em produção', async () => {
    const restarted = createApp({ directory, origin, secureCookies: true }).listen(0, '127.0.0.1')
    await new Promise(resolve => restarted.once('listening', resolve))
    const url = `http://127.0.0.1:${restarted.address().port}`
    try {
      expect((await fetch(`${url}/api/auth/me`, { headers: { Cookie: first.cookie } })).status).toBe(200)
      const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'first@example.test', password }) })
      expect(login.headers.get('set-cookie')).toContain('Secure')
    } finally { await new Promise(resolve => restarted.close(resolve)) }
  })
  it('rejeita sessões expiradas e limita tentativas de autenticação', async () => {
    const token = first.cookie.split('=')[1]
    await createStorage(directory).saveSession(createHash('sha256').update(token).digest('hex'), { userId: first.user.id, expiresAt: 0 })
    expect((await request('/api/portfolio', { cookie: first.cookie })).status).toBe(401)
    let response
    for (let attempt = 0; attempt < 21; attempt++) response = await request('/api/auth/login', { method: 'POST', body: {} })
    expect(response.status).toBe(429)
  })
})