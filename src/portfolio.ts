import Papa from 'papaparse'

export type AssetClass = 'Ações' | 'FIIs' | 'Renda fixa' | 'Exterior' | 'Cripto' | 'Fundos' | 'Previdência'
export type Asset = { ticker: string; name: string; type: AssetClass; quantity: number; average: number | null; price: number; previous: number; quoteSource?: 'brapi' | ''; quoteAsOf?: string | null }
export type ImportRecord = { id: string; name: string; date: string; count: number; kind: string }
export type Purchase = { ticker: string; quantity: number; price: number; type: AssetClass }
export type AssetSort = 'default' | 'ticker-asc' | 'ticker-desc' | 'value-asc' | 'value-desc'
export const visibleHoldings = (assets: Asset[]) => assets.filter(asset => !(asset.type === 'FIIs' && asset.ticker.endsWith('12')))
export function sortAssets(assets: Asset[], sort: AssetSort): Asset[] {
  if (sort === 'default') return assets
  return [...assets].sort((first, second) => {
    if (sort === 'ticker-asc') return first.ticker.localeCompare(second.ticker, 'pt-BR')
    if (sort === 'ticker-desc') return second.ticker.localeCompare(first.ticker, 'pt-BR')
    const firstValue = first.quantity * first.price
    const secondValue = second.quantity * second.price
    return sort === 'value-asc' ? firstValue - secondValue : secondValue - firstValue
  })
}
export const colors: Record<AssetClass, string> = { 'Ações': '#246b56', FIIs: '#639b88', 'Renda fixa': '#e5b55d', Exterior: '#788cc2', Cripto: '#c98873', Fundos: '#4d8c9d', 'Previdência': '#9b7c55' }
export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const percent = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
export const total = (assets: Asset[]) => assets.reduce((sum, asset) => sum + asset.quantity * asset.price, 0)
export const cost = (assets: Asset[]) => assets.reduce((sum, asset) => sum + asset.quantity * (asset.average ?? 0), 0)
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const today = () => new Date().toLocaleDateString('en-CA')

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function numberBR(value: string): number {
  const clean = value.replace(/R\$|\s|%/g, '')
  if (!clean || !/^-?[\d.,]+$/.test(clean)) throw new Error(`Valor numérico inválido: ${value || '(vazio)'}`)
  const parsed = Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean)
  if (!Number.isFinite(parsed)) throw new Error(`Valor numérico inválido: ${value}`)
  return parsed
}

export function classify(value: string, ticker: string): AssetClass {
  const normalized = normalize(value)
  if (/fii|imobili/.test(normalized)) return 'FIIs'
  if (/previd|pensao/.test(normalized)) return 'Previdência'
  if (/fundo|multimercado/.test(normalized)) return 'Fundos'
  if (/fixa|cdb|tesouro|lci|lca|debenture/.test(normalized + normalize(ticker))) return 'Renda fixa'
  if (/exterior|internacional|etf|bdr/.test(normalized)) return 'Exterior'
  if (/cripto|bitcoin/.test(normalized) || /^(BTC|ETH)/.test(ticker)) return 'Cripto'
  if (/acoes|acao|stocks/.test(normalized)) return 'Ações'
  if (/^(BOVA|BOVV)11$/.test(ticker)) return 'Ações'
  if (/^(IFRA|KNCA)11$/.test(ticker)) return 'Fundos'
  if (/^(IVVB|SPXI|WRLD|NASD)11$/.test(ticker)) return 'Exterior'
  return /11$/.test(ticker) ? 'FIIs' : 'Ações'
}

export function parseCSV(text: string): Asset[] {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: normalize })
  if (result.errors.length) throw new Error(`CSV inválido: ${result.errors[0].message}`)
  if (!result.data.length) throw new Error('O arquivo não contém posições.')
  const assets = result.data.map((row, index) => {
    const field = (...names: string[]) => names.map(normalize).map(name => row[name]).find(value => value?.trim()) || ''
    const ticker = field('ticker', 'ativo', 'codigo', 'produto').trim().toUpperCase()
    if (!ticker) throw new Error(`Linha ${index + 2}: ativo não informado.`)
    const quantity = numberBR(field('quantidade', 'qtd', 'qtde'))
    const unitPrice = field('cotacao', 'preco atual', 'preco', 'fechamento')
    const marketTotal = field('valor atual', 'valor de mercado', 'valor atual de mercado', 'saldo bruto')
    if (quantity <= 0) throw new Error(`Linha ${index + 2}: quantidade deve ser positiva.`)
    if (!unitPrice && !marketTotal) throw new Error(`Linha ${index + 2}: informe cotação ou valor atual total.`)
    const price = unitPrice ? numberBR(unitPrice) : numberBR(marketTotal) / quantity
    const averageText = field('preco medio', 'pm', 'custo medio')
    const purchaseTotal = field('valor de compra total', 'custo total')
    const average = averageText ? numberBR(averageText) : purchaseTotal ? numberBR(purchaseTotal) / quantity : null
    if (price < 0 || (average !== null && average < 0)) throw new Error(`Linha ${index + 2}: preços não podem ser negativos.`)
    return { ticker, name: field('nome', 'descricao') || ticker, type: classify(field('tipo', 'classe', 'classe de ativo'), ticker), quantity, average, price, previous: price }
  })
  if (new Set(assets.map(asset => asset.ticker)).size !== assets.length) throw new Error('Há ativos duplicados no CSV. Consolide as posições por ticker.')
  return assets
}

export function parsePositionSheet(rows: unknown[][], sheetName = ''): Asset[] {
  const tickerHeaders = ['ticker', 'ativo', 'codigo', 'produto', 'codigo de negociacao']
  const quantityHeaders = ['quantidade', 'qtd', 'qtde', 'quantidade total']
  const matches = (header: string, names: string[]) => names.some(name => normalize(name) === header)
  const headerIndex = rows.findIndex(row => {
    const headers = row.map(value => normalize(String(value ?? '')))
    return headers.some(header => matches(header, tickerHeaders)) && headers.some(header => matches(header, quantityHeaders))
  })
  if (headerIndex < 0) return parseSectionedPositionSheet(rows, sheetName)
  const headers = rows[headerIndex].map(value => normalize(String(value ?? '')))
  const positions: Asset[] = []
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    if (row.every(value => value === null || value === undefined || value === '')) continue
    const field = (...names: string[]) => {
      for (const name of names) {
        const index = headers.indexOf(normalize(name))
        if (index >= 0 && row[index] !== null && row[index] !== undefined && String(row[index]).trim() !== '') return String(row[index]).trim()
      }
      return ''
    }
    const product = field('produto', 'nome', 'descricao')
    const tickerValue = field('codigo de negociacao', 'ticker', 'ativo', 'codigo', 'produto')
    if (/^(total|subtotal)(\b|\s|:)/i.test(tickerValue) || /^(total|subtotal)$/i.test(tickerValue) || /^(total|subtotal)(\b|\s|:)/i.test(String(row[0] ?? ''))) continue
    const quantity = field(...quantityHeaders)
    if (!tickerValue && !quantity) continue
    try {
      if (quantity && numberBR(quantity) === 0) continue
      const ticker = tickerValue.toUpperCase().match(/^([A-Z]{4}\d{1,2})(?:\s*[-–]|\s|$)/)?.[1] || tickerValue
      const type = field('classe', 'classe de ativo', 'tipo de ativo', 'tipo')
      const classHint = /^(ON|PN[A-Z]?|UNT|CI|COTA)$/i.test(type) ? sheetName : type || sheetName
      const parsed = parseCSV(Papa.unparse([{
        Ativo: ticker,
        Nome: product || ticker,
        Tipo: classHint,
        Quantidade: quantity,
        'Preço Médio': field('preco medio', 'pm', 'custo medio'),
        'Custo Total': field('custo total', 'valor de compra total'),
        Cotacao: field('cotacao', 'preco atual', 'preco', 'fechamento', 'preco de fechamento', 'preco unitario', 'valor unitario'),
        'Valor Atual': field('valor atual', 'valor de mercado', 'valor atual de mercado', 'saldo bruto', 'valor atualizado', 'valor total')
      }], { delimiter: ';' }))
      positions.push(...parsed)
    } catch (issue) {
      throw new Error(`Aba ${sheetName || 'Posições'}, linha ${headerIndex + offset + 2}: ${issue instanceof Error ? issue.message : 'posição inválida'}`)
    }
  }
  return positions
}

function parseSectionedPositionSheet(rows: unknown[][], sheetName: string): Asset[] {
  const sectionTypes: Record<string, AssetClass> = {
    rendafixa: 'Renda fixa', tesourodireto: 'Renda fixa', fundosimobiliarios: 'FIIs',
    acoes: 'Ações', exterior: 'Exterior', cripto: 'Cripto',
  }
  let section: AssetClass | null = null
  let headers: string[] | null = null
  const positions: Asset[] = []
  for (const [index, row] of rows.entries()) {
    if (row.every(value => value === null || value === undefined || value === '')) continue
    const first = String(row[0] ?? '').trim()
    const label = normalize(first)
    if (sectionTypes[label]) {
      section = sectionTypes[label]
      headers = null
      continue
    }
    const candidate = row.map(value => normalize(String(value ?? '')))
    const hasBalance = candidate.some(header => ['saldo', 'saldoamercado'].includes(header))
    const hasQuantity = candidate.some(header => ['quantidade', 'qtdtotal', 'quantidadedecotas'].includes(header))
    if (hasBalance && hasQuantity) {
      if (!section) throw new Error(`Aba ${sheetName}, linha ${index + 1}: classe da seção não reconhecida.`)
      headers = candidate
      continue
    }
    if (!headers || !section) continue
    if (/^(total|subtotal)(\b|\s|:|$)/i.test(first)) continue
    const field = (...names: string[]) => {
      for (const name of names) {
        const column = headers!.indexOf(normalize(name))
        const value = column < 0 ? '' : String(row[column] ?? '').trim()
        if (value) return value
      }
      return ''
    }
    const optionalCost = (value: string) => ['indefinido', 'naoinformado', 'naodisponivel', 'na', ''].includes(normalize(value)) ? '' : value
    try {
      const quantity = field('Qtd. total', 'Quantidade', 'Quantidade de Cotas')
      if (quantity && numberBR(quantity) === 0) continue
      const parsed = parsePositionSheet([
        ['Ativo', 'Nome', 'Tipo', 'Quantidade', 'Valor Atual', 'Preço Médio', 'Custo Total'],
        [first, first, section, quantity, field('Saldo a mercado', 'Saldo'), optionalCost(field('Preço médio (abertura)', 'Preço médio')), optionalCost(field('Valor aplicado original', 'Valor aplicado'))],
      ], sheetName)
      positions.push(...parsed)
    } catch (issue) {
      throw new Error(`Aba ${sheetName}, linha ${index + 1}: ${issue instanceof Error ? issue.message : 'posição inválida'}`)
    }
  }
  return positions
}

export function consolidatePositions(positions: Asset[]): Asset[] {
  const consolidated: Asset[] = []
  for (const position of positions) {
    const existing = consolidated.find(asset => asset.ticker === position.ticker)
    if (!existing) { consolidated.push({ ...position }); continue }
    if (existing.type !== position.type) throw new Error(`${position.ticker}: classes divergentes na planilha. Confira os dados antes de importar.`)
    const quantity = existing.quantity + position.quantity
    existing.price = (existing.quantity * existing.price + position.quantity * position.price) / quantity
    existing.previous = existing.price
    existing.average = existing.average === null || position.average === null ? null : (existing.quantity * existing.average + position.quantity * position.average) / quantity
    existing.quantity = quantity
  }
  return consolidated
}

export function parseNote(text: string): Purchase[] {
  const purchases: Purchase[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/\b(VENDA|V)\b/i.test(line) && /\b[A-Z]{4}\d{1,2}\b/.test(line)) throw new Error('A nota contém vendas. Esta versão aceita apenas operações de compra.')
    const match = line.match(/\b(?:COMPRA|C)\s+([A-Z]{4}\d{1,2})\s+(\d[\d.,]*)\s+(?:R\$\s*)?(\d[\d.,]*)\b/i)
    if (!match) {
      if (/\b(?:COMPRA|C)\s+[A-Z]{4}\d{1,2}\b/i.test(line)) throw new Error('Uma linha de compra está incompleta ou usa um formato não suportado. Nenhuma operação foi importada.')
      continue
    }
    const [, ticker, quantityText, priceText] = match
    const quantity = numberBR(quantityText)
    const price = numberBR(priceText)
    if (quantity <= 0 || price <= 0) throw new Error('A nota contém quantidade ou preço inválido.')
    purchases.push({ ticker: ticker.toUpperCase(), quantity, price, type: classify('', ticker.toUpperCase()) })
  }
  if (!purchases.length) throw new Error('Nenhuma compra reconhecida. Formato aceito: COMPRA PETR4 100 32,50. PDFs digitalizados precisam de OCR externo.')
  return purchases
}

export function applyPurchases(assets: Asset[], purchases: Purchase[]): Asset[] {
  const next = assets.map(asset => ({ ...asset }))
  for (const purchase of purchases) {
    const existing = next.find(asset => asset.ticker === purchase.ticker)
    if (existing) {
      if (existing.average === null) throw new Error(`${existing.ticker}: concilie o custo da posição antes de adicionar novas compras.`)
      existing.average = (existing.quantity * existing.average + purchase.quantity * purchase.price) / (existing.quantity + purchase.quantity)
      existing.quantity += purchase.quantity
    } else next.push({ ...purchase, name: purchase.ticker, average: purchase.price, previous: purchase.price })
  }
  return next
}

export const demoAssets: Asset[] = [
  { ticker: 'PETR4', name: 'Petrobras', type: 'Ações', quantity: 800, average: 31.52, price: 37.85, previous: 37.23 },
  { ticker: 'ITUB4', name: 'Itaú Unibanco', type: 'Ações', quantity: 700, average: 28.36, price: 34.92, previous: 34.68 },
  { ticker: 'VALE3', name: 'Vale', type: 'Ações', quantity: 350, average: 65.2, price: 61.48, previous: 62.11 },
  { ticker: 'WEGE3', name: 'WEG', type: 'Ações', quantity: 300, average: 35.8, price: 42.64, previous: 42.19 },
  { ticker: 'HGLG11', name: 'Pátria Log', type: 'FIIs', quantity: 160, average: 155.2, price: 160.35, previous: 160.1 },
  { ticker: 'KNRI11', name: 'Kinea Renda Imobiliária', type: 'FIIs', quantity: 120, average: 145.8, price: 149.72, previous: 149.2 },
  { ticker: 'CDB-2028', name: 'CDB · 110% do CDI', type: 'Renda fixa', quantity: 40, average: 1000, price: 1128.42, previous: 1128.01 },
  { ticker: 'TESOURO', name: 'Tesouro IPCA+ 2029', type: 'Renda fixa', quantity: 15, average: 2450, price: 2785.33, previous: 2782.6 },
  { ticker: 'IVVB11', name: 'iShares S&P 500', type: 'Exterior', quantity: 90, average: 268.5, price: 327.8, previous: 324.6 },
  { ticker: 'BTC', name: 'Bitcoin', type: 'Cripto', quantity: 0.045, average: 310000, price: 389500, previous: 385200 },
]