import { describe, expect, it } from 'vitest'
import { applyPurchases, classify, consolidatePositions, numberBR, parseCSV, parseNote, parsePositionSheet, sortAssets, total, cost, visibleHoldings } from './portfolio'
import { parsePDFPositions, pdfImportSources } from './pdfPositions'
import type { PdfCell } from './pdfPositions'
import { createImportDrafts, inferColumnMapping, parseImportNumber, parseMappedImports } from './importMapping'
import { averageWithNoteFallback, parseB3NotePages, processB3NoteBatch, removePricingNoteFromStore, summarizePurchases, summarizeStorePurchases } from './b3Notes'
import { initialStore } from './account'

const pdfRow = (y: number, values: [number, string][]): PdfCell[] => values.map(([x, text]) => ({ text, x, y, width: text.length * 4 }))

describe('consolidação patrimonial', () => {
  it('oculta FIIs terminados em 12 da lista sem ocultar outros ativos', () => {
    const assets = [
      { ticker: 'HGLG11', name: 'FII', type: 'FIIs' as const, quantity: 1, average: 100, price: 100, previous: 100 },
      { ticker: 'HGLG12', name: 'Direito', type: 'FIIs' as const, quantity: 1, average: 10, price: 10, previous: 10 },
      { ticker: 'PETR12', name: 'Ação', type: 'Ações' as const, quantity: 1, average: 10, price: 10, previous: 10 },
    ]
    expect(visibleHoldings(assets).map(asset => asset.ticker)).toEqual(['HGLG11', 'PETR12'])
    expect(assets).toHaveLength(3)
  })
  it('ordena ativos por ticker e valor em ambas as direções sem mutar a lista', () => {
    const assets = [
      { ticker: 'VALE3', name: 'Vale', type: 'Ações' as const, quantity: 2, average: 5, price: 5, previous: 5 },
      { ticker: 'PETR4', name: 'Petrobras', type: 'Ações' as const, quantity: 1, average: 20, price: 20, previous: 20 },
      { ticker: 'ITSA4', name: 'Itaúsa', type: 'Ações' as const, quantity: 1, average: 5, price: 5, previous: 5 },
    ]
    expect(sortAssets(assets, 'ticker-asc').map(asset => asset.ticker)).toEqual(['ITSA4', 'PETR4', 'VALE3'])
    expect(sortAssets(assets, 'ticker-desc').map(asset => asset.ticker)).toEqual(['VALE3', 'PETR4', 'ITSA4'])
    expect(sortAssets(assets, 'value-asc').map(asset => asset.ticker)).toEqual(['ITSA4', 'VALE3', 'PETR4'])
    expect(sortAssets(assets, 'value-desc').map(asset => asset.ticker)).toEqual(['PETR4', 'VALE3', 'ITSA4'])
    expect(assets.map(asset => asset.ticker)).toEqual(['VALE3', 'PETR4', 'ITSA4'])
  })
  it('calcula preço médio ponderado sem alterar a carteira original', () => {
    const first = applyPurchases([], parseNote('COMPRA PETR4 100 30,00'))
    const next = applyPurchases(first, parseNote('C PETR4 50 36,00'))
    expect(next[0].quantity).toBe(150)
    expect(next[0].average).toBe(32)
    expect(first[0].quantity).toBe(100)
    expect(cost(next)).toBe(4800)
  })
  it('lê CSV brasileiro com valores totais e campos entre aspas', () => {
    const assets = parseCSV('Ativo;Tipo;Quantidade;Preço Médio;Valor Atual\nPETR4;Ações;100;30,00;3.500,00')
    expect(assets[0].price).toBe(35)
    expect(total(assets) - cost(assets)).toBe(500)
  })
  it('aceita CSV com separador vírgula e cotação unitária', () => {
    expect(parseCSV('ticker,quantidade,preco medio,cotacao\nVALE3,10,60,65')[0].price).toBe(65)
  })
  it('mantém o custo desconhecido quando o extrato não informa preço médio', () => {
    const assets = parseCSV('ativo;quantidade;cotacao\nPETR4;100;35')
    expect(assets[0].average).toBeNull()
    expect(() => applyPurchases(assets, parseNote('C PETR4 10 32,00'))).toThrow('concilie')
  })
  it('recusa valores inválidos e duplicatas', () => {
    expect(() => numberBR('')).toThrow()
    expect(() => parseCSV('ativo;quantidade;pm;cotacao\nPETR4;10;30;35\nPETR4;10;30;35')).toThrow('duplicados')
  })
  it('recusa notas sem compras e notas com vendas', () => {
    expect(() => parseNote('documento sem operações')).toThrow()
    expect(() => parseNote('V PETR4 100 35,00')).toThrow('vendas')
  })
  it('extrai compras por ativo de uma nota B3 e ignora vendas', () => {
    const pages = [[
      ...pdfRow(700, [[20, 'C/V'], [90, 'Tipo de Mercado'], [190, 'Especificação do Título'], [400, 'Quantidade'], [500, 'Preço / Ajuste'], [620, 'Valor Operação / Ajuste']]),
      ...pdfRow(680, [[20, 'C'], [90, 'VISTA'], [190, 'PETROBRAS PN N2 PETR4'], [400, '100'], [500, '30,00'], [620, '3.000,00 D']]),
      ...pdfRow(660, [[20, 'C'], [90, 'VISTA'], [190, 'VALE ON NM VALE3'], [400, '50'], [500, '60,00'], [620, '3.000,00 D']]),
      ...pdfRow(640, [[20, 'V'], [90, 'VISTA'], [190, 'PETROBRAS PN N2 PETR4'], [400, '20'], [500, '35,00'], [620, '700,00 C']]),
    ]]
    expect(parseB3NotePages(pages)).toEqual([
      { ticker: 'PETR4', quantity: 100, price: 30, type: 'Ações' },
      { ticker: 'VALE3', quantity: 50, price: 60, type: 'Ações' },
    ])
    expect(summarizePurchases([
      { ticker: 'PETR4', quantity: 100, price: 30, type: 'Ações' },
      { ticker: 'PETR4', quantity: 50, price: 36, type: 'Ações' },
    ])).toEqual([{ ticker: 'PETR4', type: 'Ações', quantity: 150, totalCost: 4800, average: 32 }])
  })
  it('lê notas XP B3 quando o PDF fornece cada negócio como uma linha de texto', () => {
    const pages = [[
      ...pdfRow(700, [[10, 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C']]),
      ...pdfRow(680, [[10, '1-BOVESPA C VISTA FII KINEA KNRI11 CI ER 4 199,35 797,40 D']]),
      ...pdfRow(660, [[10, '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI ER 5 139,76 698,80 D']]),
      ...pdfRow(640, [[10, '1-BOVESPA V VISTA FII KINEA KNRI11 CI ER 2 201,00 402,00 C']]),
    ]]
    expect(parseB3NotePages(pages)).toEqual([
      { ticker: 'KNRI11', quantity: 4, price: 199.35, type: 'FIIs' },
      { ticker: 'SAAG11', quantity: 5, price: 139.76, type: 'FIIs' },
    ])
  })
  it('lê compra XP quando o PDF combina C/V e tipo de mercado na mesma célula', () => {
    const page = [
      ...pdfRow(700, [[20, 'C/V'], [90, 'Tipo mercado'], [190, 'Especificação do título'], [400, 'Quantidade'], [500, 'Preço / Ajuste'], [620, 'Valor Operação / Ajuste']]),
      ...pdfRow(680, [[20, '1-BOVESPA'], [90, 'C VISTA'], [190, 'FII KINEA KNRI11 CI ER'], [400, '4'], [500, '199,35'], [620, '797,40 D']]),
    ]
    expect(parseB3NotePages([page])).toMatchObject([{ ticker: 'KNRI11', quantity: 4, price: 199.35 }])
  })
  it('junta uma operação B3 dividida em duas linhas do PDF', () => {
    const page = [
      ...pdfRow(700, [[10, 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C']]),
      ...pdfRow(680, [[10, '1-BOVESPA C VISTA FII KINEA KNRI11 CI ER']]),
      ...pdfRow(660, [[400, '4'], [500, '199,35'], [620, '797,40 D']]),
    ]
    expect(parseB3NotePages([page])).toMatchObject([{ ticker: 'KNRI11', quantity: 4, price: 199.35 }])
  })
  it('lê as operações XP de 17 e 18 de dezembro de 2019, incluindo Itaúsa sem ticker explícito', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      page(
        '1-BOVESPA C VISTA FII BC FFII BCFF11 CI ER # 4 99,66 398,64 D',
        '1-BOVESPA C VISTA FII CSHG LOG HGLG11 CI 3 194,95 584,85 D',
        '1-BOVESPA C VISTA FII HOTEL MX HTMX11 CI 2 188,01 376,02 D',
        '1-BOVESPA C VISTA FII KINEA KNRI11 CI 1 187,51 187,51 D',
        '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI 1 134,51 134,51 D',
      ),
      page('1-BOVESPA C FRACIONARIO ITAUSA PN EJ N1 12 13,81 165,72 D'),
    ])
    expect(purchases).toMatchObject([
      { ticker: 'BCFF11', quantity: 4, price: 99.66 },
      { ticker: 'HGLG11', quantity: 3, price: 194.95 },
      { ticker: 'HTMX11', quantity: 2, price: 188.01 },
      { ticker: 'KNRI11', quantity: 1, price: 187.51 },
      { ticker: 'SAAG11', quantity: 1, price: 134.51 },
      { ticker: 'ITSA4', quantity: 12, price: 13.81 },
    ])
  })
  it('identifica o ETF IT NOW IBOV como BOVV11 nas notas de setembro de 2019', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      page(
        '1-BOVESPA C VISTA FII EUROPAR EURO11 CI 1 173,43 173,43 D',
        '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI 2 129,76 259,52 D',
        '1-BOVESPA C VISTA FII TRX LOG TRXL11 CI ER 1 106,09 106,09 D',
        '1-BOVESPA C VISTA IT NOW IBOV CI 10 104,85 1.048,50 D',
      ),
      page('1-BOVESPA C VISTA FII BC FFII BCFF11 CI ES 3 91,19 273,57 D'),
    ])
    expect(purchases).toMatchObject([
      { ticker: 'EURO11', quantity: 1, price: 173.43 },
      { ticker: 'SAAG11', quantity: 2, price: 129.76 },
      { ticker: 'TRXL11', quantity: 1, price: 106.09 },
      { ticker: 'BOVV11', quantity: 10, price: 104.85, type: 'Ações' },
      { ticker: 'BCFF11', quantity: 3, price: 91.19 },
    ])
  })
  it('lê as 20 operações das sete páginas XP de fevereiro de 2020', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      page(
        '1-BOVESPA C VISTA FII HOTEL MX HTMX11 CI ER 1 163,30 163,30 D',
        '1-BOVESPA C VISTA FII KINEA KNRI11 CI ER 1 179,65 179,65 D',
        '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI ER # 1 132,35 132,35 D',
        '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI ER # 1 132,35 132,35 D',
      ),
      page(
        '1-BOVESPA C FRACIONARIO ECORODOVIAS ON NM 20 17,07 341,40 D',
        '1-BOVESPA C FRACIONARIO ODONTOPREV ON NM 15 16,40 246,00 D',
        '1-BOVESPA C FRACIONARIO SCHULZ PN 20 12,95 259,00 D',
        '1-BOVESPA C FRACIONARIO VIAVAREJO ON NM 15 14,68 220,20 D',
      ),
      page('1-BOVESPA C FRACIONARIO ITAUSA PN N1 8 13,19 105,52 D'),
      page(
        '1-BOVESPA C VISTA FII KINEA KNRI11 CI 4 179,65 718,60 D',
        '1-BOVESPA C VISTA FII VINCI SC VISC11 CI # 2 131,74 263,48 D',
        '1-BOVESPA C VISTA FII VINCI SC VISC11 CI # 1 131,74 131,74 D',
        '1-BOVESPA C VISTA FII VINCI SC VISC11 CI # 1 131,74 131,74 D',
      ),
      page('1-BOVESPA C VISTA FII KINEA KNRI11 CI 5 173,15 865,75 D'),
      page('1-BOVESPA C VISTA FII HOTEL MX HTMX11 CI 1 164,74 164,74 D'),
      page(
        '1-BOVESPA C VISTA FII ALIANZA ALZR11 CI ER 3 120,39 361,17 D',
        '1-BOVESPA C VISTA FII CSHG LOG HGLG11 CI 1 177,47 177,47 D',
        '1-BOVESPA C VISTA FII HOTEL MX HTMX11 CI # 5 154,58 772,90 D',
        '1-BOVESPA C VISTA FII VINCI SC VISC11 CI 4 127,46 509,84 D',
        '1-BOVESPA C VISTA FII XP MALLS XPML11 CI ER 5 131,85 659,25 D',
      ),
    ])
    expect(purchases).toHaveLength(20)
    expect(purchases).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: 'ECOR3', quantity: 20, price: 17.07, type: 'Ações' }),
      expect.objectContaining({ ticker: 'ODPV3', quantity: 15, price: 16.4, type: 'Ações' }),
      expect.objectContaining({ ticker: 'SHUL4', quantity: 20, price: 12.95, type: 'Ações' }),
      expect.objectContaining({ ticker: 'VVAR3', quantity: 15, price: 14.68, type: 'Ações' }),
      expect.objectContaining({ ticker: 'ITSA4', quantity: 8, price: 13.19, type: 'Ações' }),
    ]))
  })
  it('identifica FI ITAUINFRA como IFRA11 nas notas XP de dezembro de 2024', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      page(
        '1-BOVESPA C VISTA FII GGRCOVEP GGRC11 CI ER 3 9,81 29,43 D',
        '1-BOVESPA C VISTA FII MAXI REN MXRF11 CI ER # 2 9,23 18,46 D',
        '1-BOVESPA C VISTA FII RIOB VA RBVA11 CI ER 2 86,92 173,84 D',
        '1-BOVESPA C VISTA FII XP MALLS XPML11 CI ES # 2 94,60 189,20 D',
      ),
      page('7-BOVESPA C VISTA FI ITAUINFRA CI ER 1 91,14 91,14 D'),
    ])
    expect(purchases).toHaveLength(5)
    expect(purchases.at(-1)).toMatchObject({ ticker: 'IFRA11', quantity: 1, price: 91.14, type: 'Fundos' })
  })
  it('lê as 18 operações XP de setembro de 2025 e consolida FIAGRO KINEA', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      page(
        '1-BOVESPA C VISTA FIAGRO KINEA CI ER @ 1 92,37 92,37 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI @ 3 9,25 27,75 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI @ 4 9,25 37,00 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI @ 3 9,25 27,75 D',
        '1-BOVESPA C VISTA FII TRX REAL TRXF11 CI ER @ 1 97,08 97,08 D',
        '1-BOVESPA C VISTA FII TRX REAL TRXF11 CI ER @ 1 97,08 97,08 D',
      ),
      page(
        '1-BOVESPA C VISTA FIAGRO KINEA CI @ 1 93,18 93,18 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI ER @ 1 9,19 9,19 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI ER @# 3 9,19 27,57 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI ER @ 1 9,19 9,19 D',
        '1-BOVESPA C VISTA FII XP LOG XPLG11 CI @# 1 98,15 98,15 D',
      ),
      page(
        '1-BOVESPA C VISTA FIAGRO KINEA CI ER @ 1 93,10 93,10 D',
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI ER @ 10 9,29 92,90 D',
        '1-BOVESPA C VISTA FII BTLG BTLG11 CI @ 1 102,66 102,66 D',
        '1-BOVESPA C VISTA FII XP LOG XPLG11 CI @# 1 98,27 98,27 D',
      ),
      page(
        '1-BOVESPA C VISTA FII BTG CRI BTCI11 CI @ 6 9,31 55,86 D',
        '1-BOVESPA C VISTA FII GGRCOVEP GGRC11 CI @# 5 9,93 49,65 D',
        '1-BOVESPA C VISTA FII MAXI REN MXRF11 CI @# 3 9,81 29,43 D',
      ),
    ])
    expect(purchases).toHaveLength(18)
    const knca = summarizePurchases(purchases).find(item => item.ticker === 'KNCA11')
    expect(knca).toMatchObject({ type: 'Fundos', quantity: 3 })
    expect(knca?.average).toBeCloseTo((92.37 + 93.18 + 93.1) / 3)
  })
  it('aceita nota B3 apenas com vendas sem somá-las às compras', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const page = [
      ...pdfRow(700, [[10, header]]),
      ...pdfRow(680, [[10, '1-BOVESPA V VISTA FII HECTARE HCTR11 CI 2 29,33 58,66 C']]),
      ...pdfRow(660, [[10, '1-BOVESPA V VISTA FII HECTARE HCTR11 CI 5 29,33 146,65 C']]),
      ...pdfRow(640, [[10, '1-BOVESPA V VISTA FII HECTARE HCTR11 CI 2 29,33 58,66 C']]),
      ...pdfRow(620, [[10, '1-BOVESPA V VISTA FII HECTARE HCTR11 CI 1 29,33 29,33 C']]),
    ]
    expect(parseB3NotePages([page])).toEqual([])
    expect(summarizePurchases(parseB3NotePages([page]))).toEqual([])
  })
  it('consolida as compras das quatro notas XP compartilhadas', () => {
    const header = 'Q Negociação C/V Tipo mercado Prazo Especificação do título Obs. (*) Quantidade Preço / Ajuste Valor Operação / Ajuste D/C'
    const notePage = (...trades: string[]) => [
      ...pdfRow(700, [[10, header]]),
      ...trades.flatMap((trade, index) => pdfRow(680 - index * 20, [[10, trade]])),
    ]
    const purchases = parseB3NotePages([
      notePage('1-BOVESPA C VISTA FII KINEA KNRI11 CI ER 4 199,35 797,40 D', '1-BOVESPA C VISTA FII SANT AGE SAAG11 CI ER 5 139,76 698,80 D'),
      notePage('1-BOVESPA C VISTA FII BC FFII BCFF11 CI 1 114,05 114,05 D', '1-BOVESPA C VISTA FII CSHG LOG HGLG11 CI ER 1 217,67 217,67 D'),
      notePage('1-BOVESPA C VISTA FII BC FFII BCFF11 CI 1 113,85 113,85 D'),
      notePage('1-BOVESPA C VISTA FII ALIANZA ALZR11 CI ER 2 130,80 261,60 D'),
    ])
    const summary = summarizePurchases(purchases)
    expect(summary).toHaveLength(5)
    const bcff = summary.find(item => item.ticker === 'BCFF11')
    expect(bcff?.quantity).toBe(2)
    expect(bcff?.totalCost).toBeCloseTo(227.9)
    expect(bcff?.average).toBeCloseTo(113.95)
    expect(summary.reduce((sum, item) => sum + item.totalCost, 0)).toBeCloseTo(2203.37)
  })
  it('combina compras antigas e notas B3 no preço médio por ticker', () => {
    const store = {
      ...initialStore(),
      purchases: [{ ticker: 'BTCI11', quantity: 2, price: 9, type: 'FIIs' as const }],
      pricingPurchases: [{ ticker: 'BTCI11', quantity: 3, price: 10, type: 'FIIs' as const }],
      pricingNotes: [{ importId: 'note-b3', hash: 'a'.repeat(64), purchases: [{ ticker: 'BTCI11', quantity: 5, price: 11, type: 'FIIs' as const }] }],
    }
    const summary = summarizeStorePurchases(store)
    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({ ticker: 'BTCI11', quantity: 10, totalCost: 103 })
    expect(summary[0].average).toBeCloseTo(10.3)
  })
  it('usa preço de compra das notas quando a posição não tem preço médio', () => {
    const noteAverages = new Map([['HGLG11', 169.68], ['KNRI11', 159.1]])
    expect(averageWithNoteFallback({ ticker: 'HGLG11', average: null }, noteAverages)).toBe(169.68)
    expect(averageWithNoteFallback({ ticker: 'KNRI11', average: 160.32 }, noteAverages)).toBe(160.32)
    expect(averageWithNoteFallback({ ticker: 'TRXF11', average: null }, noteAverages)).toBeNull()
  })
  it('remove uma nota B3 nova, suas compras e seu hash sem mexer na carteira', () => {
    const first = { id: 'note-1', name: 'nota-1.pdf', date: '2026-01-01T00:00:00.000Z', count: 1, kind: 'Compras B3 · preço médio' }
    const second = { id: 'note-2', name: 'nota-2.pdf', date: '2026-01-03T00:00:00.000Z', count: 1, kind: 'Compras B3 · preço médio' }
    const positionImport = { id: 'positions', name: 'posicoes.xlsx', date: '2026-01-02T00:00:00.000Z', count: 1, kind: 'Posições · Excel' }
    const store = { ...initialStore(), assets: [], demo: false, imports: [second, positionImport, first], hashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)], pricingNotes: [
      { importId: first.id, hash: 'a'.repeat(64), purchases: [{ ticker: 'PETR4', quantity: 10, price: 30, type: 'Ações' as const }] },
      { importId: second.id, hash: 'c'.repeat(64), purchases: [{ ticker: 'VALE3', quantity: 5, price: 60, type: 'Ações' as const }] },
    ] }
    const next = removePricingNoteFromStore(store, second.id)
    expect(next.imports.map(item => item.id)).toEqual(['positions', 'note-1'])
    expect(next.hashes).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(next.pricingNotes?.map(note => note.importId)).toEqual(['note-1'])
    expect(next.assets).toEqual(store.assets)
    expect(store.imports).toHaveLength(3)
  })
  it('remove a faixa correta de compras de notas B3 antigas sem vínculo individual', () => {
    const first = { id: 'old-1', name: 'antiga-1.pdf', date: '2026-01-01T00:00:00.000Z', count: 2, kind: 'Compras B3 · preço médio' }
    const second = { id: 'old-2', name: 'antiga-2.pdf', date: '2026-01-03T00:00:00.000Z', count: 1, kind: 'Compras B3 · preço médio' }
    const positionImport = { id: 'positions', name: 'posicoes.xlsx', date: '2026-01-02T00:00:00.000Z', count: 1, kind: 'Posições · Excel' }
    const legacyPurchases = [
      { ticker: 'PETR4', quantity: 10, price: 30, type: 'Ações' as const },
      { ticker: 'VALE3', quantity: 5, price: 60, type: 'Ações' as const },
      { ticker: 'ITUB4', quantity: 2, price: 20, type: 'Ações' as const },
    ]
    const store = { ...initialStore(), imports: [second, positionImport, first], hashes: ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)], pricingPurchases: legacyPurchases }
    const next = removePricingNoteFromStore(store, second.id)
    expect(next.pricingPurchases).toEqual(legacyPurchases.slice(0, 2))
    expect(next.hashes).toEqual(['d'.repeat(64), 'e'.repeat(64)])
    expect(next.imports.map(item => item.id)).toEqual(['positions', 'old-1'])
  })
  it('importa arquivos válidos de um lote mesmo que outros sejam inválidos ou duplicados', async () => {
    const files = [
      { name: 'boa.pdf', size: 100 },
      { name: 'duplicada.pdf', size: 100 },
      { name: 'ruim.pdf', size: 100 },
    ]
    const hashes = new Map([['boa.pdf', 'a'.repeat(64)], ['duplicada.pdf', 'b'.repeat(64)], ['ruim.pdf', 'c'.repeat(64)]])
    const result = await processB3NoteBatch(
      files,
      ['b'.repeat(64)],
      async file => hashes.get(file.name)!,
      async file => {
        if (file.name === 'ruim.pdf') throw new Error('nota não reconhecida.')
        return [{ ticker: 'PETR4', quantity: 10, price: 30, type: 'Ações' }]
      },
    )
    expect(result.notes.map(note => note.name)).toEqual(['boa.pdf'])
    expect(result.errors).toEqual([
      'duplicada.pdf: esta nota já foi importada.',
      'ruim.pdf: nota não reconhecida.',
    ])
  })
  it('respeita a classe explícita e reconhece ETF internacional', () => {
    expect(classify('Ações', 'TAEE11')).toBe('Ações')
    expect(classify('', 'IVVB11')).toBe('Exterior')
  })
  it('não importa parcialmente notas com linhas de compra incompletas', () => {
    expect(() => parseNote('COMPRA PETR4 100 30,00\nCOMPRA VALE3 50')).toThrow('incompleta')
  })
  it('lê posição detalhada com título, colunas da B3 e números nativos do Excel', () => {
    const assets = parsePositionSheet([
      ['Posição detalhada'], [],
      ['Produto', 'Código de Negociação', 'Tipo', 'Quantidade', 'Preço de Fechamento', 'Valor Atualizado'],
      ['PETR4 - PETROBRAS', 'PETR4', 'PN', 100, 37.85, 3785],
      ['Total', null, null, null, null, 3785],
    ], 'Ações')
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ ticker: 'PETR4', quantity: 100, price: 37.85, average: null, type: 'Ações' })
  })
  it('extrai o ticker do produto e calcula preço pelo valor total da posição', () => {
    const assets = parsePositionSheet([
      ['Produto', 'Quantidade', 'Valor Atualizado'],
      ['HGLG11 - PATRIA LOG', 10, '1.603,50'],
    ], 'FIIs')
    expect(assets[0]).toMatchObject({ ticker: 'HGLG11', price: 160.35, type: 'FIIs' })
  })
  it('consolida posições em várias instituições sem inventar custo desconhecido', () => {
    const positions = parsePositionSheet([
      ['Ativo', 'Quantidade', 'Cotação', 'Preço Médio'],
      ['PETR4', 100, 35, 30],
      ['PETR4', 50, 38, null],
    ], 'Ações')
    expect(consolidatePositions(positions)[0]).toMatchObject({ ticker: 'PETR4', quantity: 150, price: 36, average: null })
    expect(positions[0].quantity).toBe(100)
  })
  it('ignora abas de capa e recusa linhas de posição inválidas', () => {
    expect(parsePositionSheet([['Resumo'], ['Patrimônio', 1000]], 'Resumo')).toEqual([])
    expect(() => parsePositionSheet([['Ativo', 'Quantidade', 'Cotação'], ['PETR4', 'abc', 35]], 'Ações')).toThrow('linha 2')
    expect(() => parsePositionSheet([['Ativo', 'Quantidade'], ['PETR4', 10]], 'Ações')).toThrow('cotação')
  })
  it('lê o layout Sua carteira com blocos, cabeçalhos repetidos e custos indefinidos', () => {
    const assets = parsePositionSheet([
      ['Resumo do patrimônio', 'Total investido'], ['Conta de demonstração', 'R$ 5.000,00'], [],
      ['Renda Fixa', null, null, null, 'R$ 900,00'], [],
      ['20% | Pós-Fixado', 'Saldo a mercado', 'Valor aplicado', 'Valor aplicado original', 'Quantidade', 'Preço Unitário'],
      ['CRI EXEMPLO - OUT/2029', 'R$ 900,00', 'R$ 950,00', 'R$ 1.000,00', '1', 'R$ 970,00'], [],
      ['Fundos Imobiliários', null, null, null, 'R$ 3.000,00'], [],
      ['60% | Fundos Listados', 'Saldo', 'Preço médio (abertura)', 'Última cotação', 'Qtd. total', 'Quantidade de Cotas'],
      ['HGLG11', 'R$ 1.500,00', 'Indefinido', 'R$ 150,00', '10', '10'],
      ['KNRI11', 'R$ 1.500,00', 'R$ 140,00', 'R$ 150,00', '10', '10'], [],
      ['Tesouro Direto', null, null, null, 'R$ 1.100,00'], [],
      ['20% | Pós-Fixado', 'Saldo', 'Valor aplicado', 'Quantidade', 'Disponível', 'Vencimento'],
      ['LFT mar/2031', 'R$ 800,00', 'R$ 700,00', '0,10', '0,10', '01/03/2031'], [],
      ['5% | Prefixado', 'Saldo', 'Valor aplicado', 'Quantidade', 'Disponível', 'Vencimento'],
      ['LTN jan/2032', 'R$ 300,00', 'R$ 310,00', '1,20', '1,20', '01/01/2032'],
    ], 'Sua carteira')
    expect(assets).toHaveLength(5)
    expect(total(assets)).toBeCloseTo(5000, 6)
    expect(assets[0]).toMatchObject({ type: 'Renda fixa', quantity: 1, price: 900, average: 1000 })
    expect(assets[1]).toMatchObject({ ticker: 'HGLG11', type: 'FIIs', quantity: 10, average: null })
    expect(assets[2].average).toBe(140)
    expect(assets[3]).toMatchObject({ type: 'Renda fixa', quantity: 0.1, price: 8000, average: 7000 })
    expect(assets[4].quantity).toBe(1.2)
  })
  it('informa a linha real ao encontrar posição inválida em uma seção', () => {
    expect(() => parsePositionSheet([
      ['Fundos Imobiliários'], ['90% | Fundos Listados', 'Saldo', 'Qtd. total'],
      ['HGLG11', 'R$ 100,00', 'inválido'],
    ], 'Sua carteira')).toThrow('linha 3')
  })
  it('lê tabela PDF por coordenadas, preservando custo ausente e consolidando ativos', () => {
    const assets = parsePDFPositions([[...pdfRow(700, [[40, 'Ativo'], [180, 'Quantidade'], [280, 'Preço Médio'], [430, 'Valor Atual']]),
      ...pdfRow(680, [[40, 'PETR4'], [180, '100'], [280, '30,00'], [430, '3.500,00']]),
      ...pdfRow(660, [[40, 'PETR4'], [180, '50'], [280, '36,00'], [430, '1.750,00']]),
      ...pdfRow(640, [[40, 'HGLG11'], [180, '10'], [280, 'Indefinido'], [430, '1.600,00']]),
      ...pdfRow(620, [[40, 'Total'], [430, '6.850,00']]),
    ]])
    expect(assets).toHaveLength(2)
    expect(assets[0]).toMatchObject({ ticker: 'PETR4', quantity: 150, average: 32, price: 35 })
    expect(assets[1].average).toBeNull()
    expect(total(assets)).toBe(6850)
  })
  it('lê PDF em seções e várias páginas sem trocar saldo de mercado pelo preço unitário', () => {
    const assets = parsePDFPositions([
      [...pdfRow(750, [[40, 'Renda Fixa']]),
        ...pdfRow(720, [[40, '20% | Pós-Fixado'], [200, 'Saldo a mercado'], [340, 'Valor aplicado original'], [500, 'Quantidade'], [600, 'Preço Unitário']]),
        ...pdfRow(700, [[40, 'CRI EXEMPLO'], [200, 'R$ 900,00'], [340, 'R$ 1.000,00'], [500, '1'], [600, 'R$ 970,00']])],
      [...pdfRow(750, [[40, 'Tesouro Direto']]),
        ...pdfRow(720, [[40, '10% | Pós-Fixado'], [200, 'Saldo'], [340, 'Valor aplicado'], [500, 'Quantidade']]),
        ...pdfRow(700, [[40, 'LFT mar/2031'], [200, 'R$ 800,00'], [340, 'R$ 700,00'], [500, '0,10']])],
    ])
    expect(assets).toHaveLength(2)
    expect(assets.every(asset => asset.type === 'Renda fixa')).toBe(true)
    expect(assets[0]).toMatchObject({ price: 900, average: 1000 })
    expect(assets[1]).toMatchObject({ quantity: 0.1, price: 8000, average: 7000 })
  })
  it('recusa PDF sem texto, sem tabela reconhecida ou com posição inválida', () => {
    expect(() => parsePDFPositions([[]])).toThrow('OCR')
    expect(() => parsePDFPositions([pdfRow(700, [[40, 'Documento sem posições']])])).toThrow('Nenhuma posição')
    expect(() => parsePDFPositions([[...pdfRow(700, [[40, 'Ativo'], [180, 'Quantidade'], [280, 'Cotação']]), ...pdfRow(680, [[40, 'PETR4'], [180, 'inválido'], [280, '35,00']])]])).toThrow('Página 1')
  })
  it('reconhece fundo, qtd. cotas e vr. financeiro sem confundir contribuição com ativo', () => {
    const assets = parsePDFPositions([[
      ...pdfRow(700, [[35, 'Conta'], [245, 'Fundo'], [480, 'Data'], [600, 'Valor'], [680, 'Qtd. Cotas'], [800, 'Vr. Financeiro']]),
      ...pdfRow(680, [[35, 'CONTRIB. PARTICIPANTE'], [245, 'Fundo Baixo Risco'], [480, '27/10/2026'], [600, '100,00'], [680, '10,000000'], [800, '1.000,00']]),
      ...pdfRow(660, [[35, 'CONTRIB. PATROCINADORA'], [245, 'Fundo Baixo Risco'], [480, '27/10/2026'], [600, '100,00'], [680, '5,000000'], [800, '500,00']]),
      ...pdfRow(640, [[35, 'TOTAL FINANCEIRO'], [800, '1.500,00']]),
    ]])
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ ticker: 'FUNDO BAIXO RISCO', type: 'Previdência', quantity: 15, price: 100, average: null })
    expect(total(assets)).toBe(1500)
  })
  it('mapeia exportações de fundos e confere o total antes de importar', () => {
    const drafts = createImportDrafts([{ name: 'Previdência', rows: [
      ['Conta', 'Fundo', 'Data', 'Valor', 'Qtd. Cotas', 'Vr. Financeiro'],
      ['CONTRIB. PARTICIPANTE', 'Fundo A', '27/10/2026', '100,00', '10', '1.000,00'],
      ['CONTRIB. PATROCINADORA', 'Fundo A', '27/10/2026', '100,00', '5', '500,00'],
      ['TOTAL FINANCEIRO', null, null, null, null, '1.500,00'],
    ] }])
    const result = parseMappedImports(drafts)
    expect(result.sourceRows).toBe(2)
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({ type: 'Previdência', quantity: 15, average: null })
    expect(result.validatedTotals).toBe(1)
    drafts[0].source.rows[3][5] = '2.000,00'
    expect(() => parseMappedImports(drafts)).toThrow('total financeiro')
  })
  it('permite associar colunas desconhecidas sem adivinhar o significado de Valor', () => {
    const drafts = createImportDrafts([{ name: 'Corretora nova', rows: [
      ['Investimento', 'Saldo em cotas', 'Valor'], ['Fundo B', '5', '50,00'],
    ] }])
    expect(inferColumnMapping(['Valor']).unitPrice).toBe(-1)
    drafts[0].mapping.asset = 0
    drafts[0].mapping.quantity = 1
    drafts[0].mapping.marketTotal = 2
    drafts[0].defaultClass = 'Fundos'
    expect(total(parseMappedImports(drafts).assets)).toBe(50)
    drafts[0].mapping.average = 2
    expect(() => parseMappedImports(drafts)).toThrow('mesma coluna')
  })
  it('mapeia várias seções da mesma planilha e exige classe para fundos desconhecidos', () => {
    const drafts = createImportDrafts([{ name: 'Sua carteira', rows: [
      ['Renda Fixa'], ['20% | Pós-Fixado', 'Saldo a mercado', 'Quantidade', 'Valor aplicado'],
      ['CRI Exemplo', 900, 1, 1000], ['Fundos Imobiliários'],
      ['80% | Fundos Listados', 'Saldo', 'Qtd. total', 'Preço médio (abertura)'],
      ['HGLG11', 1600, 10, 'Indefinido'],
    ] }])
    expect(drafts).toHaveLength(2)
    expect(total(parseMappedImports(drafts).assets)).toBe(2500)
    const unknown = createImportDrafts([{ name: 'Posições', rows: [['Ativo', 'Quantidade', 'Valor Atual'], ['Fundo desconhecido', 10, 100]] }])
    expect(() => parseMappedImports(unknown)).toThrow('classe padrão')
  })
  it('mapeia PDF com números alinhados à direita e total financeiro fora da coluna do fundo', () => {
    const pages = [[
      ...pdfRow(700, [[35, 'Conta'], [245, 'Fundo'], [480, 'Data'], [600, 'Valor'], [680, 'Qtd. Cotas'], [800, 'Vr. Financeiro']]),
      ...pdfRow(680, [[35, 'CONTRIB. PARTICIPANTE'], [245, 'Fundo A'], [480, '27/10/2026'], [600, '100,00'], [680, '10'], [800, '1.000,00']]),
      ...pdfRow(660, [[35, 'CONTRIB. PATROCINADORA'], [245, 'Fundo A'], [480, '27/10/2026'], [600, '100,00'], [680, '5'], [800, '500,00']]),
      ...pdfRow(640, [[35, 'TOTAL FINANCEIRO'], [800, '1.500,00']]),
    ]]
    const result = parseMappedImports(createImportDrafts(pdfImportSources(pages)))
    expect(result.assets[0]).toMatchObject({ ticker: 'FUNDO A', type: 'Previdência', quantity: 15 })
    expect(result.validatedTotals).toBe(1)
  })
  it('reconhece Nome como ativo e não importa moeda estrangeira como reais', () => {
    const drafts = createImportDrafts([{ name: 'Fundos', rows: [
      ['Nome', 'Quantidade', 'Valor Atual', 'Moeda'], ['Fundo A', 10, 1000, 'USD'],
    ] }])
    expect(drafts[0].mapping.asset).toBe(0)
    expect(() => parseMappedImports(drafts)).toThrow('BRL')
    drafts[0].source.rows[1][3] = 'BRL'
    expect(parseMappedImports(drafts).assets[0].type).toBe('Fundos')
  })
  it('exige confirmação de números ambíguos e aceita notação brasileira e internacional', () => {
    expect(() => parseImportNumber('1.000', 'auto')).toThrow('ambíguo')
    expect(parseImportNumber('1.000', 'pt-BR')).toBe(1000)
    expect(parseImportNumber('1.000', 'en-US')).toBe(1)
    expect(parseImportNumber('1,234.56', 'auto')).toBe(1234.56)
    expect(parseImportNumber('1.234,56', 'auto')).toBe(1234.56)
    expect(parseImportNumber('1.000,000', 'auto')).toBe(1000)
    expect(() => parseImportNumber('12,15%', 'auto')).toThrow('quantia válida')
    expect(parseImportNumber(0.125, 'pt-BR')).toBe(0.125)
    expect(() => parseImportNumber('12,34.56', 'en-US')).toThrow('incompatível')
  })
  it('mantém todas as posições de uma planilha em seções, incluindo cotas com valor zero', () => {
    const result = parseMappedImports(createImportDrafts([{ name: 'Sua carteira', rows: [
      ['Renda Fixa'], ['20% | Pós-Fixado', 'Saldo a mercado', 'Quantidade', 'Valor aplicado original'], ['CRI Exemplo', 900, 1, 1000], [],
      ['Fundos Imobiliários'], ['60% | Fundos Listados', 'Saldo', 'Qtd. total', 'Preço médio (abertura)'], ['HGLG11', 1600, 10, 'Indefinido'], ['ALZR12', 0, 129, 'Indefinido'], [],
      ['Tesouro Direto'], ['15% | Pós-Fixado', 'Saldo', 'Quantidade', 'Valor aplicado'], ['LFT mar/2031', 800, 0.1, 700], [],
      ['5% | Prefixado', 'Saldo', 'Quantidade', 'Valor aplicado'], ['LTN jan/2032', 300, 1.2, 310],
    ] }]))
    expect(result.assets).toHaveLength(5)
    expect(total(result.assets)).toBeCloseTo(3600)
    expect(result.assets.filter(asset => asset.type === 'Renda fixa')).toHaveLength(3)
  })
  it('prefere CNPJ ao nome comercial e não consolida fundos homônimos distintos', () => {
    const drafts = createImportDrafts([{ name: 'Fundos', rows: [
      ['Fundo', 'CNPJ do Fundo', 'Quantidade', 'Valor Atual'],
      ['Fundo Exemplo', '00.000.000/0001-01', 10, 1000],
      ['Fundo Exemplo', '00.000.000/0001-02', 20, 2000],
    ] }])
    expect(drafts[0].mapping.asset).toBe(1)
    expect(drafts[0].mapping.name).toBe(0)
    const result = parseMappedImports(drafts)
    expect(result.assets).toHaveLength(2)
    expect(result.assets.every(asset => asset.name === 'Fundo Exemplo')).toBe(true)
  })
})