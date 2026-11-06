import { useRef, useState } from 'react'
import { Calculator, CircleHelp, FileText, LoaderCircle, Upload } from 'lucide-react'
import { money } from './portfolio'
import type { Purchase } from './portfolio'
import type { Store } from './account'
import { parseB3NotePages, processB3NoteBatch, summarizeStorePurchases } from './b3Notes'
import type { PdfCell } from './pdfPositions'
import './averagePrice.css'

type Props = {
  active: boolean
  store: Store
  setStore: (next: Store | ((current: Store) => Store)) => void
  hidden: boolean
}

async function fileHash(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}

async function readB3Pdf(file: File): Promise<Purchase[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pages: PdfCell[][] = []
  try {
    const pdf = await loadingTask.promise
    if (pdf.numPages > 100) throw new Error(`${file.name}: o PDF excede o limite de 100 páginas.`)
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent()
      const cells: PdfCell[] = []
      for (const item of content.items) {
        if ('str' in item) cells.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width })
      }
      pages.push(cells)
    }
  } catch (issue) {
    if (issue instanceof Error && issue.name === 'PasswordException') throw new Error(`${file.name}: o PDF está protegido por senha.`)
    if (issue instanceof Error && issue.message.includes('limite de 100')) throw issue
    throw new Error(`${file.name}: não foi possível ler o PDF. Use uma nota com texto selecionável.`)
  } finally {
    await loadingTask.destroy()
  }
  try {
    return parseB3NotePages(pages)
  } catch (issue) {
    throw new Error(`${file.name}: ${issue instanceof Error ? issue.message : 'nota não reconhecida.'}`)
  }
}

function parseSalePrice(value: string) {
  const text = value.replace(/R\$|\s/g, '')
  if (!text) return null
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? price : null
}

export function AveragePricePage({ active, store, setStore, hidden }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [salePrices, setSalePrices] = useState<Record<string, string>>({})
  const [saleQuantities, setSaleQuantities] = useState<Record<string, string>>({})
  const summaries = summarizeStorePurchases(store)
  const totalQuantity = summaries.reduce((sum, item) => sum + item.quantity, 0)
  const totalCost = summaries.reduce((sum, item) => sum + item.totalCost, 0)
  const cash = (value: number) => hidden ? '••••••' : money(value)

  async function processFiles(files: FileList | File[]) {
    const selected = Array.from(files)
    if (!selected.length || processing) return
    setProcessing(true)
    setError('')
    setNotice('')
    try {
      const { notes, errors } = await processB3NoteBatch(selected, store.hashes, fileHash, readB3Pdf)
      if (!notes.length) {
        setError(errors.join(' '))
        return
      }
      setStore(current => ({
        ...current,
        pricingNotes: [...(current.pricingNotes ?? []), ...notes.map(({ importId, hash, purchases }) => ({ importId, hash, purchases }))],
        hashes: [...current.hashes, ...notes.map(note => note.hash)],
        imports: [...notes.map(({ importId, name, date, count }) => ({ id: importId, name, date, count, kind: 'Compras B3 · preço médio' })), ...current.imports],
      }))
      const purchaseCount = notes.reduce((sum, note) => sum + note.count, 0)
      const saleOnlyCount = notes.filter(note => note.count === 0).length
      setNotice(purchaseCount
        ? `${purchaseCount} compra(s) importada(s) de ${notes.length} nota(s).${saleOnlyCount ? ` ${saleOnlyCount} nota(s) sem compras; vendas não alteram o preço médio.` : ''}`
        : 'Nota registrada. Ela contém apenas vendas, que não entram no cálculo do preço médio.')
      if (errors.length) setError(`Alguns arquivos não foram importados: ${errors.join(' ')}`)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Não foi possível processar as notas B3.')
    } finally {
      setProcessing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="average-price-page" hidden={!active}>
      <div className="average-price-heading">
        <div>
          <h2>Notas de negociação</h2>
          <p>As compras são agrupadas por ativo e salvas sem alterar as quantidades da carteira.</p>
        </div>
        <button className="button primary" disabled={processing} onClick={() => inputRef.current?.click()}>
          {processing ? <LoaderCircle size={16} className="spinning" /> : <Upload size={16} />}
          {processing ? 'Lendo notas…' : 'Importar notas B3'}
        </button>
      </div>
      <input ref={inputRef} className="sr-only" type="file" accept=".pdf,application/pdf" multiple onChange={event => { if (event.target.files) void processFiles(event.target.files) }} />
      <div className={`b3-note-drop ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!processing) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void processFiles(event.dataTransfer.files) }}>
        <FileText size={22} />
        <span>PDFs B3 com texto selecionável · até 15 MB por arquivo</span>
      </div>
      {error && <div className="import-error" role="alert"><CircleHelp size={17} />{error}</div>}
      {notice && <div className="pricing-notice" role="status">{notice}</div>}
      <div className="pricing-summary">
        <div><small>Ativos analisados</small><strong>{summaries.length}</strong></div>
        <div><small>Quantidade comprada</small><strong>{hidden ? '••••••' : totalQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</strong></div>
        <div><small>Custo total das compras</small><strong>{cash(totalCost)}</strong></div>
      </div>
      {summaries.length ? (
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead><tr><th>Ativo</th><th className="number">Comprado</th><th className="number">Preço médio / empate</th><th>Preço de venda (R$)</th><th>Qtd. para vender</th><th className="number">Lucro / prejuízo bruto</th></tr></thead>
            <tbody>{summaries.map(item => {
              const salePrice = parseSalePrice(salePrices[item.ticker] ?? '')
              const quantityText = saleQuantities[item.ticker] ?? String(item.quantity)
              const quantity = Number(quantityText)
              const result = salePrice !== null && Number.isFinite(quantity) && quantity > 0 ? (salePrice - item.average) * quantity : null
              return <tr key={item.ticker}>
                <td><strong>{item.ticker}</strong></td>
                <td className="number">{hidden ? '••••••' : item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</td>
                <td className="number">{cash(item.average)}</td>
                <td><input aria-label={`Preço de venda de ${item.ticker}`} inputMode="decimal" placeholder="Ex.: 35,50" value={salePrices[item.ticker] ?? ''} onChange={event => setSalePrices(current => ({ ...current, [item.ticker]: event.target.value }))} /></td>
                <td><input aria-label={`Quantidade para vender de ${item.ticker}`} type="number" min="0" step="any" value={quantityText} onChange={event => setSaleQuantities(current => ({ ...current, [item.ticker]: event.target.value }))} /></td>
                <td className={`number ${result === null ? '' : result < 0 ? 'negative' : 'positive'}`}>{result === null ? '—' : <strong>{cash(result)}</strong>}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      ) : <div className="pricing-empty"><Calculator size={27} /><p>Importe as notas para calcular o preço médio por ativo.</p></div>}
      <p className="pricing-disclaimer">O cálculo considera as compras identificadas. Vendas anteriores, taxas, emolumentos e impostos não estão incluídos.</p>
    </section>
  )
}