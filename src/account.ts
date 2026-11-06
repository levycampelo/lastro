import { demoAssets } from "./portfolio";
import type { Asset, ImportRecord, Purchase } from "./portfolio";

export type User = { id: string; name: string; email: string };
export type Store = {
  assets: Asset[];
  demo: boolean;
  imports: ImportRecord[];
  hashes: string[];
  purchases: Purchase[];
  pricingPurchases?: Purchase[];
  pricingNotes?: { importId: string; hash: string; purchases: Purchase[] }[];
  history: { date: string; value: number }[];
  updated: string | null;
  quoteDay: string;
  quoteSource?: "brapi" | "";
  auto: boolean;
};
export type SavedPortfolio = {
  revision: number;
  store: Store | null;
  savedAt?: string;
};
export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

export const initialStore = (): Store => ({
  assets: demoAssets.map((asset) => ({ ...asset })),
  demo: true,
  imports: [],
  hashes: [],
  purchases: [],
  pricingPurchases: [],
  history: [],
  updated: null,
  quoteDay: "",
  quoteSource: "",
  auto: true,
});

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<Result>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.",
      0,
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      result?.error || "Não foi possível concluir a operação.",
      response.status,
    );
  if (result === null)
    throw new ApiError("O servidor retornou uma resposta inválida.", 0);
  return result as Result;
}

export function legacyPortfolio(): Store | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem("lastro-v1") || "null",
    ) as Store | null;
    if (
      saved &&
      !saved.demo &&
      Array.isArray(saved.assets) &&
      Array.isArray(saved.imports) &&
      Array.isArray(saved.history) &&
      Array.isArray(saved.purchases) &&
      Array.isArray(saved.hashes)
    )
      return saved;
  } catch {}
  return null;
}
