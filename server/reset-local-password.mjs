import { randomBytes, randomInt, scrypt } from 'node:crypto'
import { open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const dataDirectory = path.resolve('data')
const accountPath = path.join(dataDirectory, 'clients', 'e225b84f-c6c7-4057-a4c8-58747007f531.json')
const account = JSON.parse(await readFile(accountPath, 'utf8'))
if (account.email !== 'levycampelo@gmail.com') throw new Error('Conta não corresponde ao e-mail esperado.')

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
const password = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
const salt = randomBytes(16).toString('hex')
const key = await new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, value) => {
    if (error) reject(error)
    else resolve(value)
  })
})
account.passwordHash = `scrypt:${salt}:${key.toString('hex')}`

const temporaryPath = `${accountPath}.reset.tmp`
const handle = await open(temporaryPath, 'wx', 0o600)
try {
  await handle.writeFile(`${JSON.stringify(account, null, 2)}\n`, 'utf8')
  await handle.sync()
} finally {
  await handle.close()
}
await rename(temporaryPath, accountPath)

let invalidatedSessions = 0
const sessionsPath = path.join(dataDirectory, 'sessions')
for (const file of await readdir(sessionsPath)) {
  if (!file.endsWith('.json')) continue
  const sessionPath = path.join(sessionsPath, file)
  const session = JSON.parse(await readFile(sessionPath, 'utf8'))
  if (session.userId === account.id) {
    await rm(sessionPath, { force: true })
    invalidatedSessions++
  }
}

const response = await fetch('http://127.0.0.1:3001/api/auth/login', {
  method: 'POST',
  headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: account.email, password }),
})
if (!response.ok) throw new Error(`A senha foi gravada, mas a validação de login falhou: ${response.status}`)
console.log(JSON.stringify({ password, loginVerified: response.ok, invalidatedSessions }))