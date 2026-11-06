import { consolidatePositions, parsePositionSheet } from './portfolio'
import type { Asset } from './portfolio'
import type { ImportSource } from './importMapping'

export type PdfCell = { text: string; x: number; y: number; width: number }
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const columns: Record<string, string> = {
  ativo: 'Ativo', ticker: 'Ativo', produto: 'Ativo', codigo: 'Ativo', codigodenegociacao: 'Ativo',
  fundo: 'Ativo', nomedofundo: 'Ativo', fundodeinvestimento: 'Ativo',
  nome: 'Nome', descricao: 'Nome', tipo: 'Tipo', classe: 'Tipo', classedeativo: 'Tipo',
  quantidade: 'Quantidade', qtd: 'Quantidade', qtde: 'Quantidade', qtdtotal: 'Quantidade', quantidadetotal: 'Quantidade', quantidadedecotas: 'Quantidade',
  qtdcotas: 'Quantidade', qtdecotas: 'Quantidade', qtddecotas: 'Quantidade',
  precomedio: 'Preço Médio', precomedioabertura: 'Preço Médio', pm: 'Preço Médio', customedio: 'Preço Médio',
  cotacao: 'Cotação', ultimacotacao: 'Cotação', precoatual: 'Cotação', precodefechamento: 'Cotação', precounitario: 'Cotação', valorunitario: 'Cotação',
  valoratual: 'Valor Atual', valordemercado: 'Valor Atual', valoratualizado: 'Valor Atual', valortotal: 'Valor Atual', saldo: 'Valor Atual', saldoamercado: 'Valor Atual', saldobruto: 'Valor Atual',
  vrfinanceiro: 'Valor Atual', valorfinanceiro: 'Valor Atual', valor: 'Cotação',
  custototal: 'Custo Total', valordecompratotal: 'Custo Total', valoraplicado: 'Custo Total', valoraplicadooriginal: 'Custo Original',
}
const sections = new Set(['acoes', 'fiis', 'fundosimobiliarios', 'rendafixa', 'tesourodireto', 'exterior', 'cripto'])

function rowsFromCells(cells: PdfCell[]): PdfCell[][] {
  const rows: PdfCell[][] = []
  for (const cell of [...cells].filter(item => item.text.trim()).sort((first, second) => second.y - first.y || first.x - second.x)) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - cell.y) <= 3)
    if (row) row.push({ ...cell })
    else rows.push([{ ...cell }])
  }
  return rows.map(row => {
    const merged: PdfCell[] = []
    for (const cell of row.sort((first, second) => first.x - second.x)) {
      const previous = merged.at(-1)
      const gap = previous ? cell.x - previous.x - previous.width : Infinity
      if (previous && gap >= -1 && gap <= 7) {
        previous.text = `${previous.text} ${cell.text}`
        previous.width = Math.max(previous.width, cell.x + cell.width - previous.x)
      } else merged.push({ ...cell, text: cell.text.trim() })
    }
    return merged
  })
}

export function pdfImportSources(pages: PdfCell[][]): ImportSource[] {
  if (!pages.some(page => page.some(cell => cell.text.trim()))) throw new Error('O PDF não contém texto selecionável. Se for digitalizado, faça OCR ou importe em Excel/CSV.')
  let carriedClass: ImportSource['suggestedClass'] = pages.some(page => /contrib(participante|patrocinadora)/.test(key(page.map(cell => cell.text).join(' ')))) ? 'Previdência' : undefined
  const sectionTypes: Record<string, NonNullable<ImportSource['suggestedClass']>> = { acoes: 'Ações', fiis: 'FIIs', fundosimobiliarios: 'FIIs', rendafixa: 'Renda fixa', tesourodireto: 'Renda fixa', exterior: 'Exterior', cripto: 'Cripto', fundos: 'Fundos', previdencia: 'Previdência' }
  return pages.map((page, pageIndex) => {
    const cellRows = rowsFromCells(page)
    const suggestedClass = carriedClass
    for (const row of cellRows) if (sectionTypes[key(row[0].text)]) carriedClass = sectionTypes[key(row[0].text)]
    return {
      name: `PDF · página ${pageIndex + 1}`,
      group: 'Documento PDF',
      suggestedClass,
      rows: cellRows.map(row => row.map(cell => cell.text)),
      rowsForHeader: (index: number) => {
        const header = cellRows[index]
        if (!header?.length) throw new Error('Selecione uma linha de cabeçalho com colunas no PDF.')
        return cellRows.map((row, rowIndex) => {
          if (rowIndex <= index) return row.map(cell => cell.text)
          const values = header.map(() => '')
          for (const cell of row) {
            const distance = (column: PdfCell) => Math.min(Math.abs(cell.x - column.x), Math.abs(cell.x + cell.width - column.x - column.width))
            const column = header.reduce((best, candidate, candidateIndex) => distance(candidate) < distance(header[best]) ? candidateIndex : best, 0)
            values[column] = [values[column], cell.text].filter(Boolean).join(' ')
          }
          return values
        })
      },
    }
  }).filter(source => source.rows.length > 0)
}

export function parsePDFPositions(pages: PdfCell[][]): Asset[] {
  if (!pages.some(page => page.some(cell => cell.text.trim()))) throw new Error('O PDF não contém texto selecionável. Se for digitalizado, faça OCR ou importe o extrato em Excel/CSV.')
  const positions: Asset[] = []
  let section = pages.some(page => /contrib(participante|patrocinadora)/.test(key(page.map(cell => cell.text).join(' ')))) ? 'Previdência' : ''
  let header: { x: number; width: number; name: string | null }[] | null = null
  for (const [pageIndex, page] of pages.entries()) {
    for (const [rowIndex, row] of rowsFromCells(page).entries()) {
      if (sections.has(key(row[0].text))) { section = row[0].text; header = null; continue }
      const detected = row.map(cell => ({ x: cell.x, width: cell.width, name: columns[key(cell.text)] || null }))
      if (detected.some(cell => cell.name === 'Quantidade') && detected.some(cell => cell.name === 'Cotação' || cell.name === 'Valor Atual')) {
        if (!detected.some(cell => cell.name === 'Ativo')) {
          if (!section) throw new Error(`Página ${pageIndex + 1}: não foi possível identificar a coluna de ativo do PDF.`)
          detected[0].name = 'Ativo'
        }
        header = detected
        if (!section && row.some(cell => ['fundo', 'nomedofundo', 'fundodeinvestimento'].includes(key(cell.text)))) section = 'Fundos'
        continue
      }
      if (!header) continue
      const record: Record<string, string> = {}
      for (const cell of row) {
        const distance = (candidate: { x: number; width: number }) => Math.min(Math.abs(cell.x - candidate.x), Math.abs(cell.x + cell.width - candidate.x - candidate.width))
        const column = header.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest)
        if (column.name) record[column.name] = [record[column.name], cell.text].filter(Boolean).join(' ')
      }
      if (/^(total|subtotal)(\b|\s|:|$)/i.test(record.Ativo || '')) continue
      if (!record.Quantidade && !record['Valor Atual'] && !record['Cotação']) continue
      for (const name of ['Preço Médio', 'Custo Total', 'Custo Original']) {
        if (['indefinido', 'naoinformado', 'naodisponivel', 'na', ''].includes(key(record[name] || ''))) record[name] = ''
      }
      if (record['Custo Original']) record['Custo Total'] = record['Custo Original']
      if (record['Valor Atual']) record['Cotação'] = ''
      record.Tipo ||= section
      try {
        positions.push(...parsePositionSheet([Object.keys(record), Object.values(record)], 'PDF'))
      } catch (issue) {
        throw new Error(`Página ${pageIndex + 1}, linha ${rowIndex + 1}: ${issue instanceof Error ? issue.message : 'posição inválida'}`)
      }
    }
  }
  if (!positions.length) throw new Error('Nenhuma posição reconhecida no PDF. Use uma tabela com ativo, quantidade e cotação ou valor atual total. Você também pode importar o extrato em Excel/CSV.')
  return consolidatePositions(positions)
}