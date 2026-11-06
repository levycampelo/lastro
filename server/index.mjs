import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'

try { process.loadEnvFile() }
catch (error) { if (error.code !== 'ENOENT') throw error }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT || 3001)
if (production && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('Em produção, defina APP_ORIGIN com a URL HTTPS pública do portal.')
const app = createApp({ directory: process.env.LASTRO_DATA_DIR || path.join(root, 'data'), origin: process.env.APP_ORIGIN || ['http://localhost:5173', 'http://127.0.0.1:5173'], secureCookies: production })
if (production) {
  app.use(express.static(path.join(root, 'dist')))
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')))
}
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`API Lastro disponível em http://${process.env.HOST || '127.0.0.1'}:${port} (PID ${process.pid})`))
server.on('error', error => { console.error('Não foi possível iniciar a API:', error.code); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))