import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { createHash, randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ConflictError, createStorage } from './storage.mjs'
import { fetchBrapiQuotes, QuoteProviderError } from './quotes.mjs'
import { fetchInfoMoneyNews, NewsProviderError } from './news.mjs'

const scrypt = promisify(deriveKey)
const sessionDuration = 7 * 24 * 60 * 60 * 1000
const cookieName = 'lastro_session'
const digest = value => createHash('sha256').update(value).digest('hex')
const publicUser = account => ({ id: account.id, name: account.name, email: account.email })
const amount = z.number().finite().nonnegative()
const assetClass = z.enum(['Ações', 'FIIs', 'Renda fixa', 'Exterior', 'Cripto', 'Fundos', 'Previdência'])
const timestamp = z.string().datetime()
const asset = z.object({ ticker: z.string().trim().min(1).max(200), name: z.string().max(300), type: assetClass, quantity: z.number().finite().positive(), average: amount.nullable(), price: amount, previous: amount, quoteSource: z.enum(['brapi', '']).optional(), quoteAsOf: timestamp.nullable().optional() })
const purchase = z.object({ ticker: z.string().min(1).max(200), quantity: z.number().finite().positive(), price: amount, type: assetClass })
const storeSchema = z.object({
  assets: z.array(asset).max(10000).refine(assets => new Set(assets.map(item => item.ticker)).size === assets.length),
  demo: z.boolean(),
  imports: z.array(z.object({ id: z.string().max(100), name: z.string().max(500), date: timestamp, count: z.number().int().nonnegative(), kind: z.string().max(100) })).max(10000),
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10000),
  purchases: z.array(purchase).max(100000),
  pricingPurchases: z.array(purchase).max(100000).optional(),
  pricingNotes: z.array(z.object({ importId: z.string().max(100), hash: z.string().regex(/^[a-f0-9]{64}$/), purchases: z.array(purchase).max(100000) })).max(10000).optional(),
  history: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: amount })).max(10000),
  updated: timestamp.nullable(), quoteDay: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]), quoteSource: z.enum(['brapi', '']).optional(), auto: z.boolean(),
})
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(6).max(128) })
const registration = credentials.extend({ name: z.string().trim().min(2).max(100) })

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
  return `scrypt:${salt}:${key.toString('hex')}`
}

async function verifyPassword(password, hash) {
  const [, salt, encoded] = hash.split(':')
  const key = await scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
  const expected = Buffer.from(encoded, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export function createApp({ directory, origin = 'http://localhost:5173', secureCookies = false, quoteProvider = symbols => fetchBrapiQuotes(symbols, process.env.BRAPI_API_KEY), newsProvider = fetchInfoMoneyNews } = {}) {
  if (!directory) throw new Error('Diretório de dados não informado.')
  const app = express()
  const storage = createStorage(directory)
  let newsRequest = null
  async function dailyNews() {
    if (newsRequest) return newsRequest
    newsRequest = (async () => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
      const cached = await storage.dailyNews()
      if (cached?.day === day) return cached
      try {
        const news = { day, fetchedAt: new Date().toISOString(), articles: await newsProvider() }
        await storage.saveDailyNews(news)
        return news
      } catch (error) {
        if (cached?.articles?.length) return { ...cached, stale: true }
        throw error
      } finally {
        newsRequest = null
      }
    })()
    return newsRequest
  }
  const allowedOrigins = new Set((Array.isArray(origin) ? origin : [origin]).map(value => new URL(value).origin))
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https://icons.brapi.dev'] } } }))
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!allowedOrigins.has(req.get('origin')) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Origem da requisição não autorizada.' })
      if (!req.is('application/json')) return res.status(415).json({ error: 'Envie os dados no formato JSON.' })
    }
    next()
  })
  app.use('/api', express.json({ limit: '8mb' }))
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.' } })
  app.use(['/api/auth/login', '/api/auth/register'], authLimit)
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/', maxAge: sessionDuration }
  const sessionHash = req => {
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    return cookie && /^[a-f0-9]{64}$/.test(cookie) ? digest(cookie) : null
  }
  async function currentAccount(req) {
    const hash = sessionHash(req)
    if (!hash) return null
    const session = await storage.session(hash)
    if (!session) return null
    if (session.expiresAt <= Date.now()) { await storage.deleteSession(hash); return null }
    return storage.account(session.userId)
  }
  async function startSession(req, res, account) {
    const previous = sessionHash(req)
    if (previous) await storage.deleteSession(previous)
    const token = randomBytes(32).toString('hex')
    await storage.saveSession(digest(token), { userId: account.id, expiresAt: Date.now() + sessionDuration })
    res.cookie(cookieName, token, cookieOptions)
  }
  async function authenticated(req, res, next) {
    const account = await currentAccount(req)
    if (!account) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' })
    req.account = account
    next()
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/auth/me', async (req, res) => {
    const account = await currentAccount(req)
    if (!account) return res.status(401).json({ error: 'Entre para acessar sua carteira.' })
    res.json({ user: publicUser(account) })
  })
  app.post('/api/auth/register', async (req, res) => {
    const parsed = registration.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Informe nome, e-mail válido e uma senha de 6 a 128 caracteres.' })
    const { name, email, password } = parsed.data
    const account = { id: randomUUID(), name, email, passwordHash: await passwordHash(password), createdAt: new Date().toISOString() }
    await storage.register(account)
    await startSession(req, res, account)
    res.status(201).json({ user: publicUser(account) })
  })
  app.post('/api/auth/login', async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
    const { email, password } = parsed.data
    const account = await storage.findAccount(email)
    const valid = await verifyPassword(password, account?.passwordHash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`)
    if (!account || !valid) return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
    await startSession(req, res, account)
    res.json({ user: publicUser(account) })
  })
  app.post('/api/auth/logout', async (req, res) => {
    const hash = sessionHash(req)
    if (hash) await storage.deleteSession(hash)
    res.clearCookie(cookieName, { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' })
    res.json({ ok: true })
  })
  app.get('/api/portfolio', authenticated, async (req, res) => res.json(await storage.portfolio(req.account.id)))
  app.get('/api/news', authenticated, async (_req, res) => {
    try {
      res.json(await dailyNews())
    } catch (error) {
      if (error instanceof NewsProviderError) return res.status(502).json({ error: error.message })
      throw error
    }
  })
  app.post('/api/quotes', authenticated, async (req, res) => {
    const parsed = z.object({ symbols: z.array(z.string().regex(/^[A-Z0-9.-]{1,15}$/)).min(1).max(100) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Informe tickers válidos para consultar.' })
    try {
      const quotes = await quoteProvider([...new Set(parsed.data.symbols)])
      res.json({ quotes, updatedAt: new Date().toISOString() })
    } catch (error) {
      if (error instanceof QuoteProviderError) return res.status(error.status).json({ error: error.message })
      throw error
    }
  })
  app.put('/api/portfolio', authenticated, async (req, res) => {
    const parsed = z.object({ revision: z.number().int().nonnegative(), store: storeSchema }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Os dados da carteira são inválidos. Nenhuma alteração foi salva.' })
    res.json(await storage.savePortfolio(req.account.id, parsed.data.store, parsed.data.revision))
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }))
  app.use((error, _req, res, _next) => {
    if (error instanceof ConflictError) return res.status(409).json({ error: error.message })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'A carteira ultrapassou o limite de 8 MB.' })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' })
    console.error('Falha na API Lastro:', error.code || error.name)
    res.status(500).json({ error: 'Não foi possível concluir a operação no servidor. Tente novamente.' })
  })
  return app
}