import { classify } from './portfolio'
import type { Purchase } from './portfolio'
import type { PdfCell } from './pdfPositions'
import type { Store } from './account'

const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export type PurchaseSummary = { ticker: string; type: Purchase['type']; quantity: number; totalCost: number; average: number }
export type PricingNoteImport = { importId: string; hash: string; name: string; date: string; count: number; purchases: Purchase[] }

export async function processB3NoteBatch<FileLike extends { name: string; size: number }>(
  files: FileLike[],
  existingHashes: string[],
  hashFile: (file: FileLike) => Promise<string>,
  parseFile: (file: FileLike) => Promise<Purchase[]>,
): Promise<{ notes: PricingNoteImport[]; errors: string[] }> {
  const hashes = new Set(existingHashes)
  const notes: PricingNoteImport[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error('selecione uma nota B3 em PDF.')
      if (file.size > 15 * 1024 * 1024) throw new Error('o arquivo deve ter no máximo 15 MB.')
      const hash = await hashFile(file)
      if (hashes.has(hash)) throw new Error('esta nota já foi importada.')
      const purchases = await parseFile(file)
      hashes.add(hash)
      notes.push({ importId: crypto.randomUUID(), hash, name: file.name, date: new Date().toISOString(), count: purchases.length, purchases })
    } catch (issue) {
      errors.push(`${file.name}: ${issue instanceof Error ? issue.message : 'não foi possível processar o arquivo.'}`)
    }
  }
  return { notes, errors }
}

export function summarizePurchases(purchases: Purchase[]): PurchaseSummary[] {
  const summaries = new Map<string, PurchaseSummary>()
  for (const purchase of purchases) {
    const summary = summaries.get(purchase.ticker) || { ticker: purchase.ticker, type: purchase.type, quantity: 0, totalCost: 0, average: 0 }
    summary.quantity += purchase.quantity
    summary.totalCost += purchase.quantity * purchase.price
    summary.average = summary.totalCost / summary.quantity
    summaries.set(purchase.ticker, summary)
  }
  return [...summaries.values()]
}

export function summarizeStorePurchases(store: Pick<Store, 'purchases' | 'pricingPurchases' | 'pricingNotes'>): PurchaseSummary[] {
  return summarizePurchases([
    ...store.purchases,
    ...(store.pricingPurchases ?? []),
    ...(store.pricingNotes ?? []).flatMap(note => note.purchases),
  ])
}

export function averageWithNoteFallback(asset: Pick<import('./portfolio').Asset, 'ticker' | 'average'>, noteAverages: ReadonlyMap<string, number>): number | null {
  return asset.average ?? noteAverages.get(asset.ticker) ?? null
}

export function removePricingNoteFromStore(store: Store, importId: string): Store {
  const record = store.imports.find(item => item.id === importId)
  if (!record || record.kind !== 'Compras B3 · preço médio') return store

  const linkedNote = store.pricingNotes?.find(note => note.importId === record.id)
  const legacyNotes = store.imports
    .filter(item => item.kind === 'Compras B3 · preço médio' && !store.pricingNotes?.some(note => note.importId === item.id))
    .sort((first, second) => first.date.localeCompare(second.date))
  const legacyIndex = legacyNotes.findIndex(item => item.id === record.id)
  const legacyStart = legacyNotes.slice(0, legacyIndex).reduce((sum, item) => sum + item.count, 0)
  const legacyPurchases = [...(store.pricingPurchases ?? [])]
  if (!linkedNote && legacyIndex >= 0) legacyPurchases.splice(legacyStart, record.count)

  const chronologicalImports = [...store.imports].sort((first, second) => first.date.localeCompare(second.date))
  const hashIndex = chronologicalImports.findIndex(item => item.id === record.id)
  const hash = linkedNote?.hash ?? (hashIndex >= 0 ? store.hashes[hashIndex] : undefined)
  return {
    ...store,
    imports: store.imports.filter(item => item.id !== record.id),
    hashes: hash ? store.hashes.filter(item => item !== hash) : store.hashes,
    pricingPurchases: legacyPurchases,
    pricingNotes: (store.pricingNotes ?? []).filter(note => note.importId !== record.id),
  }
}

function rowsFromCells(cells: PdfCell[]) {
  const rows: PdfCell[][] = []
  for (const cell of [...cells].filter(item => item.text.trim()).sort((first, second) => second.y - first.y || first.x - second.x)) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - cell.y) <= 3)
    if (row) row.push({ ...cell })
    else rows.push([{ ...cell }])
  }
  return rows.map(row => row.sort((first, second) => first.x - second.x))
}

function numberFromCell(value: string) {
  const match = value.replace(/R\$|\s/g, '').match(/-?\d[\d.,]*/)
  if (!match) return NaN
  const text = match[0]
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text
  return Number(normalized)
}

function parseFlatTradeRow(rowText: string): Purchase | null {
  const operation = rowText.match(/\b(C|V)\s+(VISTA|FRACIONARIO|OPCOES?|TERMO)\b/i)
  if (!operation || operation[1].toUpperCase() !== 'C') return null
  const tickers = rowText.toUpperCase().match(/\b(?=[A-Z0-9]{4,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) || []
  const tickerFromDescription = [
    [/\bITAUSA\s+PN\b/i, 'ITSA4'],
    [/\bIT\s+NOW\s+IBOV\b/i, 'BOVV11'],
    [/\bFIAGRO\s+KINEA\b/i, 'KNCA11'],
    [/\bITAUINFRA\b/i, 'IFRA11'],
    [/\bECORODOVIAS\b/i, 'ECOR3'],
    [/\bODONTOPREV\b/i, 'ODPV3'],
    [/\bSCHULZ\s+PN\b/i, 'SHUL4'],
    [/\bVIAVAREJO\b/i, 'VVAR3'],
  ].find(([pattern]) => (pattern as RegExp).test(rowText))?.[1] as string | undefined
  const ticker = tickers.at(-1)
    || tickerFromDescription
  const numbers = rowText.match(/\d[\d.,]*/g) || []
  if (!ticker || numbers.length < 3) return null
  const quantity = numberFromCell(numbers.at(-3)!)
  const price = numberFromCell(numbers.at(-2)!)
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0)
    throw new Error(`A compra de ${ticker} está sem quantidade ou preço unitário válido.`)
  return { ticker, quantity, price, type: classify('', ticker) }
}

function parseFlatTradeRows(rows: PdfCell[][], start: number): { purchase: Purchase | null; lastIndex: number } {
  const rowText = (index: number) => rows[index].map(cell => cell.text).join(' ').replace(/\s+/g, ' ').trim()
  const isBuy = (text: string) => {
    const operation = text.match(/\b(C|V)\s+(VISTA|FRACIONARIO|OPCOES?|TERMO)\b/i)
    return operation?.[1].toUpperCase() === 'C'
  }
  const firstText = rowText(start)
  const direct = parseFlatTradeRow(firstText)
  if (direct || !isBuy(firstText)) return { purchase: direct, lastIndex: start }

  let combined = firstText
  for (let index = start + 1; index < Math.min(rows.length, start + 4); index++) {
    const nextText = rowText(index)
    if (isBuy(nextText)) break
    combined = `${combined} ${nextText}`
    const purchase = parseFlatTradeRow(combined)
    if (purchase) return { purchase, lastIndex: index }
  }
  throw new Error('Uma compra da nota B3 está incompleta. Confira ticker, quantidade e preço.')
}

export function parseB3NotePages(pages: PdfCell[][]): Purchase[] {
  const purchases: Purchase[] = []
  let sawSale = false
  let header: { cells: PdfCell[]; side: number; title: number; quantity: number; price: number } | null = null
  let flatTable = false

  for (const page of pages) {
    const rows = rowsFromCells(page)
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      const rowText = row.map(cell => cell.text).join(' ').replace(/\s+/g, ' ').trim()
      if (/\bV\s+(VISTA|FRACIONARIO|OPCOES?|TERMO)\b/i.test(rowText)) sawSale = true
      const labels = row.map(cell => key(cell.text))
      const sideColumn = labels.findIndex(label => ['cv', 'compraevenda', 'operacao'].includes(label))
      const titleColumn = labels.findIndex(label => /especificacao|titulo|papel/.test(label))
      const quantityColumn = labels.findIndex(label => /^(quantidade|qtd|qtde)$/.test(label))
      const priceColumn = labels.findIndex(label => /preco|ajuste/.test(label))
      if (sideColumn >= 0 && titleColumn >= 0 && quantityColumn >= 0 && priceColumn >= 0) {
        header = { cells: row, side: sideColumn, title: titleColumn, quantity: quantityColumn, price: priceColumn }
        flatTable = false
        continue
      }
      const normalizedRow = key(rowText)
      if (normalizedRow.includes('cv') && normalizedRow.includes('especificacao') && normalizedRow.includes('quantidade') && normalizedRow.includes('preco')) {
        header = null
        flatTable = true
        continue
      }
      if (!header) {
        if (flatTable) {
          const parsed = parseFlatTradeRows(rows, rowIndex)
          if (parsed.purchase) purchases.push(parsed.purchase)
          rowIndex = parsed.lastIndex
        }
        continue
      }

      const flatParsed = parseFlatTradeRows(rows, rowIndex)
      if (flatParsed.purchase) {
        purchases.push(flatParsed.purchase)
        rowIndex = flatParsed.lastIndex
        continue
      }

      const values = Array.from({ length: header.cells.length }, () => '')
      for (const cell of row) {
        const center = cell.x + cell.width / 2
        const nearest = header.cells.reduce((best, candidate, index) => {
          const candidateCenter = candidate.x + candidate.width / 2
          const bestCenter = header!.cells[best].x + header!.cells[best].width / 2
          return Math.abs(center - candidateCenter) < Math.abs(center - bestCenter) ? index : best
        }, 0)
        values[nearest] = [values[nearest], cell.text].filter(Boolean).join(' ')
      }

      const operation = key(values[header.side])
      if (operation !== 'c' && operation !== 'compra') continue
      const titleText = values[header.title].toUpperCase()
      const ticker = titleText.match(/\b(?=[A-Z0-9]{4,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/)?.[0]
      if (!ticker) throw new Error('Uma compra da nota B3 não contém um ticker reconhecível. Confira a especificação do ativo.')
      const quantity = numberFromCell(values[header.quantity])
      const price = numberFromCell(values[header.price])
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0)
        throw new Error(`A compra de ${ticker} está sem quantidade ou preço unitário válido.`)
      purchases.push({ ticker, quantity, price, type: classify('', ticker) })
    }
  }

  if (!purchases.length && !sawSale) throw new Error('Nenhuma compra reconhecida. Use uma nota B3 em PDF com texto selecionável e tabela de negócios realizados.')
  return purchases
}