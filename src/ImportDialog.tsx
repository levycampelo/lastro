import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  ArrowDownToLine,
  Check,
  CheckCheck,
  CircleHelp,
  FileSpreadsheet,
  FileText,
  FolderUp,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  applyPurchases,
  download,
  money,
  parseNote,
  today,
  total,
} from "./portfolio";
import type { Asset, Purchase } from "./portfolio";
import type { Store } from "./account";
import { pdfImportSources } from "./pdfPositions";
import type { PdfCell } from "./pdfPositions";
import { ColumnMapper } from "./ColumnMapper";
import { createImportDrafts, parseMappedImports } from "./importMapping";
import type { ImportDraft, ImportSource, MappedImport } from "./importMapping";

type Preview = {
  assets: Asset[];
  purchases: Purchase[];
  count: number;
  hash: string;
  name: string;
  kind: string;
  diagnostics?: Omit<MappedImport, 'assets'>;
};
type Props = {
  store: Store;
  hidden: boolean;
  onClose: () => void;
  onConfirm: (next: Store) => void;
};

export function ImportDialog({ store, hidden, onClose, onConfirm }: Props) {
  const [type, setType] = useState<"csv" | "note">("csv");
  const [mode, setMode] = useState(store.demo ? "add" : "reconcile");
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<{ drafts: ImportDraft[]; name: string; hash: string; kind: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cash = (value: number | null) =>
    hidden ? "••••••" : value === null ? "—" : money(value);

  function reviewSources(sources: ImportSource[], file: File, hash: string, format: string) {
    const available = sources.filter(source => source.rows.some(row => row.some(value => value !== null && value !== undefined && String(value).trim() !== '')));
    if (!available.length) throw new Error('O arquivo não contém tabelas com dados.');
    setMapping({ drafts: createImportDrafts(available), name: file.name, hash, kind: `Posições · ${format}` });
  }

  function generatePreview() {
    if (!mapping) return;
    setError('');
    try {
      const { assets, ...diagnostics } = parseMappedImports(mapping.drafts);
      setPreview({ assets, diagnostics, count: diagnostics.sourceRows, name: mapping.name, hash: mapping.hash, kind: mapping.kind, purchases: [] });
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível validar o mapeamento.'); }
  }

  async function processFile(file: File) {
    setError("");
    setPreview(null);
    setMapping(null);
    setProcessing(true);
    try {
      if (file.size > 15 * 1024 * 1024)
        throw new Error("O arquivo deve ter no máximo 15 MB.");
      if (type === "csv" && !/\.(csv|xlsx|pdf)$/i.test(file.name))
        throw new Error(
          "Selecione um extrato CSV, Excel (.xlsx) ou PDF com texto. Para arquivos .xls antigos, salve uma cópia em .xlsx.",
        );
      if (type === "note" && !/\.(pdf|txt)$/i.test(file.name))
        throw new Error("Selecione uma nota em PDF ou TXT.");
      const bytes = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (store.hashes.includes(hash))
        throw new Error(
          "Este arquivo já foi importado. A carteira não foi alterada.",
        );
      if (type === "csv" && /\.xlsx$/i.test(file.name)) {
        const { default: readXlsxFile } =
          await import("read-excel-file/browser");
        const sheets = await readXlsxFile(bytes).catch(() => {
          throw new Error(
            "Não foi possível ler a planilha. Confira se o arquivo é um Excel .xlsx válido e não está protegido por senha.",
          );
        });
        reviewSources(sheets.map(sheet => ({ name: sheet.sheet, rows: sheet.data })), file, hash, 'Excel');
        return;
      }
      let text = "";
      if (/\.pdf$/i.test(file.name)) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const loadingTask = pdfjs.getDocument({ data: bytes });
        const pages: PdfCell[][] = [];
        try {
          const pdf = await loadingTask.promise;
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const content = await (
              await pdf.getPage(pageNumber)
            ).getTextContent();
            const cells: PdfCell[] = [];
            let lastY: number | null = null;
            for (const item of content.items) {
              if (!("str" in item)) continue;
              cells.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
              const nextY = item.transform[5];
              if (lastY !== null && Math.abs(nextY - lastY) > 3) text += "\n";
              text += `${item.str}${item.hasEOL ? "\n" : " "}`;
              lastY = item.hasEOL ? null : nextY;
            }
            pages.push(cells);
            text += "\n";
          }
        } catch (issue) {
          if (issue instanceof Error && issue.name === "PasswordException") throw new Error("O PDF está protegido por senha. Importe uma cópia sem proteção.");
          throw new Error("Não foi possível ler o PDF. Confira se o arquivo é válido e contém texto selecionável.");
        } finally {
          await loadingTask.destroy();
        }
        if (type === "csv") {
          reviewSources(pdfImportSources(pages), file, hash, 'PDF');
          return;
        }
      } else text = await file.text();
      if (type === "csv") {
        const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
        if (parsed.errors.length) throw new Error(`CSV inválido: ${parsed.errors[0].message}`);
        reviewSources([{ name: 'CSV', rows: parsed.data }], file, hash, 'CSV');
      } else {
        const purchases = parseNote(text);
        const base = store.demo ? [] : store.assets;
        let next: Asset[];
        if (mode === "reconcile" && base.length) {
          const combined = applyPurchases(
            [],
            [...store.purchases, ...purchases],
          );
          for (const purchased of combined) {
            const position = base.find(
              (asset) => asset.ticker === purchased.ticker,
            );
            if (!position)
              throw new Error(
                `${purchased.ticker} não existe no extrato. Use Adicionar compras para uma nova posição.`,
              );
            if (Math.abs(position.quantity - purchased.quantity) > 0.000001)
              throw new Error(
                `${purchased.ticker}: a nota soma ${purchased.quantity} unidades e o extrato tem ${position.quantity}. A conciliação exige o histórico completo do ativo em um arquivo.`,
              );
          }
          next = base.map((asset) => ({
            ...asset,
            average:
              combined.find((item) => item.ticker === asset.ticker)?.average ??
              asset.average,
          }));
        } else next = applyPurchases(base, purchases);
        setPreview({
          assets: next,
          count: purchases.length,
          hash,
          name: file.name,
          kind:
            mode === "reconcile" && base.length
              ? "Conciliação · Nota"
              : "Compras · Nota",
          purchases,
        });
      }
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Não foi possível ler o arquivo.",
      );
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function confirm() {
    if (!preview) return;
    onConfirm({
      ...store,
      assets: preview.assets,
      demo: false,
      imports: [
        {
          id: crypto.randomUUID(),
          name: preview.name,
          date: new Date().toISOString(),
          count: preview.count,
          kind: preview.kind,
        },
        ...store.imports,
      ],
      hashes: [...store.hashes, preview.hash],
      purchases:
        type === "csv" ? [] : [...store.purchases, ...preview.purchases],
      history: [{ date: today(), value: total(preview.assets) }],
      updated: new Date().toISOString(),
      quoteDay: "",
      quoteSource: "",
    });
  }

  return (
    <>
      <span className="modal-symbol">
        <FolderUp size={25} />
      </span>
      <h2 id="modal-title">Importar investimentos</h2>
      <p className="modal-subtitle">
        Um novo arquivo. Uma visão mais completa.
      </p>
      <div className="import-type-tabs">
        <button
          disabled={processing}
          className={type === "csv" ? "active" : ""}
          onClick={() => {
            setType("csv");
            setPreview(null);
            setMapping(null);
            setError("");
          }}
        >
          <FileSpreadsheet size={17} />
          Extrato de posições
        </button>
        <button
          disabled={processing}
          className={type === "note" ? "active" : ""}
          onClick={() => {
            setType("note");
            setPreview(null);
            setMapping(null);
            setError("");
          }}
        >
          <FileText size={17} />
          Nota de corretagem
        </button>
      </div>
      {type === "note" && !preview && (
        <label className="note-mode">
          Operação
          <select
            disabled={processing}
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="add">Adicionar compras à carteira</option>
            <option value="reconcile">Conciliar preço médio do extrato</option>
          </select>
        </label>
      )}
      {mapping && !preview ? (
        <ColumnMapper drafts={mapping.drafts} onChange={drafts => { setMapping({ ...mapping, drafts }); setError(''); }} />
      ) : !preview ? (
        <>
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!processing) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!processing && event.dataTransfer.files[0])
                void processFile(event.dataTransfer.files[0]);
            }}
          >
            <span className="upload-symbol">
              {processing ? (
                <LoaderCircle size={27} className="spinning" />
              ) : (
                <Upload size={27} />
              )}
            </span>
            <strong>
              {processing
                ? "Lendo e validando seu arquivo…"
                : "Arraste seu arquivo até aqui"}
            </strong>
            <span>
              {processing
                ? "Aguarde a prévia dos seus investimentos."
                : "ou selecione um arquivo do seu computador"}
            </span>
            <button
              className="button secondary"
              disabled={processing}
              onClick={() => inputRef.current?.click()}
            >
              <Plus size={16} />
              Selecionar arquivo
            </button>
            <small>
              {type === "csv" ? "CSV, Excel (.xlsx) ou PDF com texto" : "PDF com texto ou TXT"}{" "}
              · até 15 MB
            </small>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept={type === "csv" ? ".csv,.xlsx,.pdf" : ".pdf,.txt"}
            onChange={(event) => {
              if (event.target.files?.[0])
                void processFile(event.target.files[0]);
            }}
          />
          <div className="format-row">
            <span>
              <FileText size={14} />
              {type === "csv"
                ? "Extrato de posições consolidadas"
                : "Notas estruturadas de compra"}
            </span>
            <button
              className="text-button"
              onClick={() =>
                download(
                  type === "csv" ? "modelo-posicoes.csv" : "modelo-nota.txt",
                  type === "csv"
                    ? "Ativo;Nome;Tipo;Quantidade;Preço Médio;Cotação\nPETR4;Petrobras;Ações;100;30,00;37,85\nHGLG11;Pátria Log;FIIs;10;155,20;160,35"
                    : "COMPRA PETR4 100 30,00\nCOMPRA PETR4 50 36,00",
                )
              }
            >
              Baixar modelo
              <ArrowDownToLine size={13} />
            </button>
          </div>
        </>
      ) : (
        <div className="import-preview">
          <div className="preview-success">
            <CheckCheck size={20} />
            <div>
              <strong>Arquivo validado</strong>
              <small>
                {preview.name} · {preview.count} registros identificados
              </small>
            </div>
          </div>
          {preview.diagnostics && <><div className="import-diagnostics"><span>{preview.diagnostics.sourceRows} linhas de posições</span><span>{preview.assets.length} ativos consolidados</span><span>{preview.diagnostics.validatedTotals ? `${preview.diagnostics.validatedTotals} total(is) conferido(s)` : 'Total sem conferência automática'}</span><span>{preview.diagnostics.ignoredRows} linhas auxiliares ignoradas</span></div>{preview.diagnostics.warnings.length > 0 && <div className="import-review-warnings">{preview.diagnostics.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}</>}
          <div className="preview-table table-scroll">
            <table className="assets-table">
              <thead>
                <tr>
                  <th>Ativo</th>
                  <th className="number">Quantidade</th>
                  <th className="number">Preço médio</th>
                  <th className="number">Valor atual</th>
                </tr>
              </thead>
              <tbody>
                {preview.assets.map((asset) => (
                  <tr key={asset.ticker}>
                    <td>
                      <strong>{asset.ticker}</strong>
                    </td>
                    <td className="number">
                      {asset.quantity.toLocaleString("pt-BR")}
                    </td>
                    <td className="number">{cash(asset.average)}</td>
                    <td className="number">
                      {cash(asset.quantity * asset.price)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="preview-total">
            <span>Patrimônio após a importação</span>
            <strong>{cash(total(preview.assets))}</strong>
          </div>
          <p className="import-warning">
            {type === "csv"
              ? "Este extrato substituirá as posições atuais da carteira."
              : store.demo
                ? "Os dados demonstrativos serão substituídos pelas compras da nota."
                : mode === "reconcile"
                  ? "O custo será conciliado. As quantidades do extrato serão preservadas."
                  : "As compras serão adicionadas às quantidades atuais."}
          </p>
        </div>
      )}
      {error && (
        <div className="import-error" role="alert">
          <CircleHelp size={18} />
          <span>{error}</span>
        </div>
      )}
      <div className="modal-footer">
        <span>
          <ShieldCheck size={14} />
          Processamento local e privado
        </span>
        {preview ? (
          <>
            <button
              className="button secondary"
              onClick={() => {
                setPreview(null);
                setMapping(null);
                setError("");
              }}
            >
              Outro arquivo
            </button>
            {mapping && <button className="button secondary" onClick={() => { setPreview(null); setError(''); }}>Revisar colunas</button>}
            <button className="button primary" onClick={confirm}>
              <Check size={16} />
              Confirmar importação
            </button>
          </>
        ) : mapping ? (
          <><button className="button secondary" onClick={() => { setMapping(null); setError(''); }}>Outro arquivo</button><button className="button primary" onClick={generatePreview}>Gerar prévia</button></>
        ) : (
          <button className="button secondary" onClick={onClose}>
            Cancelar
          </button>
        )}
      </div>
    </>
  );
}
