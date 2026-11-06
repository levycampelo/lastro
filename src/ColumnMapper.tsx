import { colors } from './portfolio'
import type { AssetClass } from './portfolio'
import { changeHeaderRow, importFields } from './importMapping'
import type { ImportDraft, ImportField, NumberFormat } from './importMapping'
import './importMapping.css'

export function ColumnMapper({ drafts, onChange }: { drafts: ImportDraft[]; onChange: (drafts: ImportDraft[]) => void }) {
  function update(id: string, patch: Partial<ImportDraft>) { onChange(drafts.map(draft => draft.id === id ? { ...draft, ...patch } : draft)) }
  function mapColumn(draft: ImportDraft, field: ImportField, column: number) { update(draft.id, { mapping: { ...draft.mapping, [field]: column } }) }
  return <section className="column-mapper" aria-label="Mapeamento de colunas"><div className="mapping-heading"><h3>Conferir colunas</h3><span>{drafts.length} {drafts.length === 1 ? 'tabela' : 'tabelas'}</span></div>{drafts.map((draft, index) => {
    const headers = draft.source.rows[draft.headerIndex] || []
    const rows = draft.source.rowsForHeader?.(draft.headerIndex) || draft.source.rows
    const samples = rows.slice(draft.headerIndex + 1, Math.min(draft.headerIndex + 4, draft.endIndex))
    return <div key={draft.id} className="mapping-source"><label className="mapping-source-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => update(draft.id, { enabled: event.target.checked })} /><strong>{draft.source.name}</strong><span>linha {draft.headerIndex + 1}</span></label><details open={index === 0}><summary>Colunas e amostra</summary><fieldset disabled={!draft.enabled}><div className="mapping-options"><label>Linha do cabeçalho<input type="number" min={1} max={draft.source.rows.length} value={draft.headerIndex + 1} onChange={event => {
      const row = Number(event.target.value) - 1
      if (Number.isInteger(row) && row >= 0 && row < draft.source.rows.length) onChange(drafts.map(item => item.id === draft.id ? changeHeaderRow(item, row) : item))
    }} /></label><label>Classe padrão<select value={draft.defaultClass} onChange={event => update(draft.id, { defaultClass: event.target.value as AssetClass | '' })}><option value="">Identificar pelo ativo</option>{Object.keys(colors).map(type => <option key={type} value={type}>{type}</option>)}</select></label><label>Formato dos números<select value={draft.numberFormat} onChange={event => update(draft.id, { numberFormat: event.target.value as NumberFormat })}><option value="auto">Automático</option><option value="pt-BR">Brasileiro: 1.234,56</option><option value="en-US">Internacional: 1,234.56</option></select></label></div><div className="mapping-fields">{importFields.map(field => <label key={field.key}>{field.label}{['asset', 'quantity'].includes(field.key) && <span className="required-marker"> *</span>}<select value={draft.mapping[field.key]} onChange={event => mapColumn(draft, field.key, Number(event.target.value))}><option value={-1}>Não informado</option>{headers.map((header, column) => <option key={column} value={column}>{column + 1}. {String(header ?? '').trim() || 'Coluna sem nome'}</option>)}</select></label>)}</div><div className="mapping-sample table-scroll"><table className="assets-table"><thead><tr>{headers.map((header, column) => <th key={column}>{String(header ?? '') || `Coluna ${column + 1}`}</th>)}</tr></thead><tbody>{samples.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, column) => <td key={column}>{String(row[column] ?? '') || '—'}</td>)}</tr>)}</tbody></table></div></fieldset></details></div>
  })}</section>
}