import { classify, colors, consolidatePositions, numberBR, parsePositionSheet, total } from './portfolio'
import type { Asset, AssetClass } from './portfolio'

export type ImportField = 'asset' | 'name' | 'type' | 'quantity' | 'unitPrice' | 'marketTotal' | 'average' | 'cost' | 'originalCost'
export type ColumnMapping = Record<ImportField, number>
export type NumberFormat = 'auto' | 'pt-BR' | 'en-US'
export type ImportSource = { name: string; rows: unknown[][]; group?: string; suggestedClass?: AssetClass; rowsForHeader?: (index: number) => unknown[][] }
export type ImportDraft = { id: string; source: ImportSource; headerIndex: number; endIndex: number; mapping: ColumnMapping; defaultClass: AssetClass | ''; numberFormat: NumberFormat; enabled: boolean }
export type MappedImport = { assets: Asset[]; sourceRows: number; ignoredRows: number; validatedTotals: number; warnings: string[] }
export const importFields: { key: ImportField; label: string; aliases: string[] }[] = [
  { key: 'asset', label: 'Ativo / fundo', aliases: ['ticker', 'codigo de negociacao', 'ativo', 'isin', 'codigo isin', 'cnpj do fundo', 'cnpj', 'codigo', 'produto', 'fundo', 'nome do fundo', 'fundo de investimento', 'papel'] },
  { key: 'name', label: 'Descrição', aliases: ['nome', 'descricao', 'nome do ativo', 'nome do fundo', 'fundo'] },
  { key: 'type', label: 'Classe do ativo', aliases: ['tipo', 'classe', 'classe de ativo', 'tipo de ativo', 'categoria'] },
  { key: 'quantity', label: 'Quantidade / cotas', aliases: ['quantidade', 'qtd', 'qtde', 'qtd total', 'qtde total', 'quantidade total', 'qtd cotas', 'qtde cotas', 'qtd de cotas', 'quantidade de cotas', 'numero de cotas'] },
  { key: 'unitPrice', label: 'Cotação unitária atual', aliases: ['cotacao', 'ultima cotacao', 'preco atual', 'preco de fechamento', 'preco unitario', 'valor unitario', 'valor da cota', 'valor cota'] },
  { key: 'marketTotal', label: 'Valor atual total', aliases: ['valor atual', 'valor de mercado', 'valor atualizado', 'valor total', 'saldo', 'saldo a mercado', 'saldo bruto', 'vr financeiro', 'valor financeiro', 'posicao financeira'] },
  { key: 'average', label: 'Preço médio de compra', aliases: ['preco medio', 'preco medio abertura', 'pm', 'custo medio'] },
  { key: 'cost', label: 'Custo total de compra', aliases: ['custo total', 'valor de compra total', 'valor aplicado', 'valor investido'] },
  { key: 'originalCost', label: 'Custo total original', aliases: ['valor aplicado original', 'custo original'] },
]
export const normalizeImportLabel = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export function parseImportNumber(value: unknown, format: NumberFormat): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').replace(/R\$|\s/g, '')
  if (!text) throw new Error('Valor numérico vazio.')
  if (!/^-?[\d.,]+$/.test(text)) throw new Error(`Valor “${text}” não é uma quantidade ou quantia válida.`)
  if (format === 'auto') {
    if (/^-?\d{1,3}(?:(?:\.\d{3})+|(?:,\d{3})+)$/.test(text)) throw new Error(`Número ambíguo “${text}”. Selecione o formato brasileiro ou internacional da tabela.`)
    if (text.includes(',') && text.includes('.') && text.lastIndexOf('.') > text.lastIndexOf(',')) return parseImportNumber(value, 'en-US')
    return numberBR(text)
  }
  const pattern = format === 'pt-BR' ? /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/ : /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
  if (!pattern.test(text)) throw new Error(`Número “${text}” incompatível com o formato ${format}. Confira os separadores.`)
  const parsed = Number(format === 'pt-BR' ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''))
  if (!Number.isFinite(parsed)) throw new Error(`Número inválido: ${text}.`)
  return parsed
}
export function inferColumnMapping(headers: unknown[]): ColumnMapping {
  const mapping = Object.fromEntries(importFields.map(field => [field.key, -1])) as ColumnMapping
  for (const field of importFields) mapping[field.key] = field.aliases.map(alias => headers.findIndex(header => normalizeImportLabel(alias) === normalizeImportLabel(header))).find(index => index >= 0) ?? -1
  if (mapping.asset < 0 && mapping.name >= 0) { mapping.asset = mapping.name; mapping.name = -1 }
  if (mapping.asset >= 0 && mapping.name === mapping.asset) mapping.name = -1
  return mapping
}
const sectionClass = (value: unknown): AssetClass | '' => {
  const normalized = normalizeImportLabel(value)
  const names: Record<string, AssetClass> = { acoes: 'Ações', fiis: 'FIIs', fundosimobiliarios: 'FIIs', rendafixa: 'Renda fixa', tesourodireto: 'Renda fixa', exterior: 'Exterior', cripto: 'Cripto', fundos: 'Fundos', fundosdeinvestimento: 'Fundos', previdencia: 'Previdência' }
  return names[normalized] || ''
}

export function createImportDrafts(sources: ImportSource[]): ImportDraft[] {
  const drafts: ImportDraft[] = []
  for (const [sourceIndex, source] of sources.entries()) {
    let activeClass: AssetClass | '' = source.suggestedClass || sectionClass(source.name)
    if (/contrib(participante|patrocinadora)/.test(normalizeImportLabel(source.rows.flat().join(' ')))) activeClass = 'Previdência'
    const markers: { index: number; type: AssetClass | ''; mapping: ColumnMapping; end: number }[] = []
    for (const [index, row] of source.rows.entries()) {
      const section = sectionClass(row[0])
      if (section) {
        if (markers.length) markers[markers.length - 1].end = Math.min(markers[markers.length - 1].end, index)
        activeClass = section
      }
      const mapping = inferColumnMapping(row)
      if (mapping.quantity < 0 || (mapping.marketTotal < 0 && mapping.unitPrice < 0)) continue
      if (mapping.asset < 0 && activeClass && /%|posfixado|prefixado|fundoslistados/.test(String(row[0] ?? '').toLowerCase())) mapping.asset = 0
      if (mapping.asset < 0) continue
      if (markers.length) markers[markers.length - 1].end = Math.min(markers[markers.length - 1].end, index)
      const type = activeClass || (normalizeImportLabel(row[mapping.asset]).includes('fundo') ? 'Fundos' : '')
      markers.push({ index, type, mapping, end: source.rows.length })
    }
    if (!markers.length) {
      const candidates = source.rows.slice(0, 40).map((row, index) => ({ index, score: Object.values(inferColumnMapping(row)).filter(column => column >= 0).length }))
      const best = candidates.sort((first, second) => second.score - first.score)[0]
      const index = best?.index ?? 0
      markers.push({ index, type: activeClass, mapping: inferColumnMapping(source.rows[index] || []), end: source.rows.length })
    }
    for (const marker of markers) drafts.push({ id: `${sourceIndex}-${marker.index}`, source, headerIndex: marker.index, endIndex: marker.end, mapping: marker.mapping, defaultClass: marker.type, numberFormat: 'auto', enabled: marker.mapping.asset >= 0 && marker.mapping.quantity >= 0 && (marker.mapping.marketTotal >= 0 || marker.mapping.unitPrice >= 0) })
  }
  if (drafts.length === 1) drafts[0].enabled = true
  return drafts
}

export function changeHeaderRow(draft: ImportDraft, index: number): ImportDraft {
  if (!Number.isInteger(index) || index < 0 || index >= draft.source.rows.length) throw new Error('Linha de cabeçalho inválida.')
  return { ...draft, headerIndex: index, endIndex: Math.max(draft.endIndex, index + 1), mapping: inferColumnMapping(draft.source.rows[index]) }
}

export function parseMappedImports(drafts: ImportDraft[]): MappedImport {
  const enabled = drafts.filter(draft => draft.enabled)
  if (!enabled.length) throw new Error('Selecione pelo menos uma tabela para importar.')
  const positions: Asset[] = []
  const warnings: string[] = []
  const groupTotals = new Map<string, { positions: Asset[]; reported: number[] }>()
  let sourceRows = 0, ignoredRows = 0, validatedTotals = 0
  for (const draft of enabled) {
    const { mapping, source } = draft
    const columns = Object.values(mapping).filter(index => index >= 0)
    if (new Set(columns).size !== columns.length) throw new Error(`${source.name}: a mesma coluna foi atribuída a campos diferentes.`)
    if (mapping.asset < 0 || mapping.quantity < 0 || (mapping.marketTotal < 0 && mapping.unitPrice < 0)) throw new Error(`${source.name}: associe ativo, quantidade e cotação unitária ou valor atual total.`)
    const rows = source.rowsForHeader?.(draft.headerIndex) || source.rows
    if (columns.some(index => index >= (rows[draft.headerIndex]?.length || 0))) throw new Error(`${source.name}: coluna fora do cabeçalho selecionado.`)
    const tablePositions: Asset[] = []
    const reported: number[] = []
    const group = source.group || source.name
    const aggregate = groupTotals.get(group) || { positions: [], reported: [] }
    groupTotals.set(group, aggregate)
    for (const [offset, row] of rows.slice(draft.headerIndex + 1, draft.endIndex).entries()) {
      const line = draft.headerIndex + offset + 2
      const field = (name: ImportField) => mapping[name] < 0 ? '' : String(row[mapping[name]] ?? '').trim()
      const numericField = (name: ImportField) => parseImportNumber(row[mapping[name]], draft.numberFormat)
      if (row.every(value => value === null || value === undefined || String(value).trim() === '')) continue
      const footer = row.find(value => /^(total|subtotal)(\s+(financeiro|geral|da carteira|do patrimonio))?\s*:?$/i.test(String(value ?? '').trim()))
      if (footer) {
        const reportedValue = field('marketTotal')
        if (reportedValue) {
          if (/financeiro|geral|carteira|patrimonio/i.test(String(footer))) aggregate.reported.push(numericField('marketTotal'))
          else reported.push(numericField('marketTotal'))
        }
        ignoredRows++
        continue
      }
      const repeated = inferColumnMapping(row)
      if (repeated.quantity >= 0 && (repeated.marketTotal >= 0 || repeated.unitPrice >= 0)) { ignoredRows++; continue }
      if (!field('quantity') && !field('marketTotal') && !field('unitPrice')) {
        if (field('asset')) warnings.push(`${source.name}, linha ${line}: linha sem quantidade e valor não importada; confira a amostra e o extrato.`)
        ignoredRows++
        continue
      }
      try {
        const currencyColumn = rows[draft.headerIndex].findIndex(header => ['moeda', 'currency'].includes(normalizeImportLabel(header)))
        const currency = currencyColumn < 0 ? '' : normalizeImportLabel(row[currencyColumn])
        if (currency && !['brl', 'r', 'real', 'reais'].includes(currency)) throw new Error('Moeda estrangeira não suportada. Converta os valores para BRL antes de importar.')
        const rawAsset = field('asset')
        if (!rawAsset) throw new Error('Ativo ou fundo não informado.')
        const rawType = field('type') || draft.defaultClass
        const code = rawAsset.toUpperCase().match(/^([A-Z]{4}\d{1,2})(?:\s*[-–]|\s|$)/)?.[1]
        if (!code && !['ticker', 'codigo', 'codigodenegociacao', 'isin', 'codigoisin', 'cnpj', 'cnpjdofundo'].includes(normalizeImportLabel(rows[draft.headerIndex][mapping.asset]))) warnings.push(`${source.name}: ativos identificados pelo nome. Confira homônimos ou associe um código, ISIN ou CNPJ quando disponível.`)
        if (!rawType && !code) throw new Error('Selecione a classe padrão ou associe uma coluna de classe para este ativo.')
        if (rawType && !(rawType in colors) && !/acao|acoes|fii|imobili|fixa|cdb|tesouro|lci|lca|debenture|exterior|internacional|etf|bdr|cripto|bitcoin|fundo|multimercado|previd|pensao|stocks|^(on|pn[a-z]?|unt|ci|cota)$/i.test(normalizeImportLabel(rawType))) throw new Error(`Classe não reconhecida: ${rawType}. Escolha uma classe padrão válida.`)
        const resolvedType = /^(on|pn[a-z]?|unt|ci|cota)$/i.test(rawType) ? draft.defaultClass || (/^(on|pn[a-z]?|unt)$/i.test(rawType) ? 'Ações' : classify('', code || rawAsset)) : rawType ? classify(rawType, code || rawAsset) : classify('', code!)
        const optionalCost = (value: string) => ['indefinido', 'naoinformado', 'naodisponivel', 'na', ''].includes(normalizeImportLabel(value)) ? '' : value
        const asset = parsePositionSheet([
          ['Ativo', 'Nome', 'Tipo', 'Quantidade', 'Valor Atual', 'Cotação', 'Preço Médio', 'Custo Total'],
          [code || rawAsset, field('name') || rawAsset, resolvedType, numericField('quantity'), field('marketTotal') ? numericField('marketTotal') : '', field('marketTotal') ? '' : numericField('unitPrice'), optionalCost(field('average')) ? numericField('average') : '', optionalCost(field('originalCost')) ? numericField('originalCost') : optionalCost(field('cost')) ? numericField('cost') : ''],
        ], source.name)
        tablePositions.push(...asset)
        if (asset.length) sourceRows++
        else ignoredRows++
        if (asset.length && field('marketTotal') && field('unitPrice') && Math.abs(numericField('quantity') * numericField('unitPrice') - numericField('marketTotal')) > 0.02) warnings.push(`${source.name}, linha ${line}: cotação × quantidade difere do saldo; o valor atual total informado foi preservado.`)
      } catch (issue) { throw new Error(`${source.name}, linha ${line}: ${issue instanceof Error ? issue.message : 'posição inválida'}`) }
    }
    if (!tablePositions.length) throw new Error(`${source.name}: nenhuma posição válida na tabela selecionada.`)
    for (const expected of reported) {
      if (Math.abs(total(tablePositions) - expected) > 0.02) throw new Error(`${source.name}: a soma das posições difere do total informado no extrato. Confira o mapeamento e as linhas.`)
      validatedTotals++
    }
    positions.push(...tablePositions)
    aggregate.positions.push(...tablePositions)
    if (mapping.average < 0 && mapping.cost < 0 && mapping.originalCost < 0) warnings.push(`${source.name}: sem custo de aquisição; o lucro ficará pendente.`)
    if (Object.entries(mapping).some(([field, index]) => index >= 0 && normalizeImportLabel(source.rows[draft.headerIndex]?.[index]) === 'valor' && field !== 'name')) warnings.push(`${source.name}: confira se a coluna “Valor” é cotação unitária ou valor total.`)
  }
  for (const [group, aggregate] of groupTotals) for (const expected of [...new Set(aggregate.reported)]) {
    if (Math.abs(total(aggregate.positions) - expected) > 0.02) throw new Error(`${group}: a soma dos ativos difere do total financeiro informado. Nenhum dado foi importado; confira as tabelas selecionadas.`)
    validatedTotals++
  }
  if (!validatedTotals) warnings.push('O arquivo não oferece um total financeiro reconhecido para conferência automática.')
  warnings.push('Valores interpretados em reais (BRL).')
  if (drafts.some(draft => !draft.enabled)) warnings.push('Há tabelas não selecionadas. Confira se todas as posições desejadas foram incluídas.')
  return { assets: consolidatePositions(positions), sourceRows, ignoredRows, validatedTotals, warnings: [...new Set(warnings)] }
}