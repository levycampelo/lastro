import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStorage, ConflictError } from "./storage.mjs";

const directories = [];
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "lastro-storage-"));
  directories.push(directory);
  return { directory, storage: createStorage(directory) };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persistência JSON por cliente", () => {
  it("mantém carteiras isoladas e recupera os dados em uma nova instância", async () => {
    const { directory, storage } = await fixture();
    await storage.savePortfolio(
      "cliente-a",
      { assets: [{ ticker: "PETR4" }] },
      0,
    );
    expect(
      (await createStorage(directory).portfolio("cliente-a")).store.assets[0]
        .ticker,
    ).toBe("PETR4");
    expect(await storage.portfolio("cliente-b")).toEqual({
      revision: 0,
      store: null,
    });
    expect(
      (await readdir(path.join(directory, "portfolios"))).every((name) =>
        name.endsWith(".json"),
      ),
    ).toBe(true);
  });
  it("impede sobrescrita concorrente e mantém a versão anterior em backup", async () => {
    const { directory, storage } = await fixture();
    await storage.savePortfolio("cliente-a", { assets: [] }, 0);
    const results = await Promise.allSettled([
      storage.savePortfolio("cliente-a", { assets: ["primeira"] }, 1),
      storage.savePortfolio("cliente-a", { assets: ["segunda"] }, 1),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected").reason,
    ).toBeInstanceOf(ConflictError);
    expect(
      JSON.parse(
        await readFile(path.join(directory, "backups/cliente-a.json"), "utf8"),
      ).revision,
    ).toBe(1);
  });
  it("não permite caminhos fornecidos como identificadores", async () => {
    const { storage } = await fixture();
    await expect(storage.portfolio("../outro-cliente")).rejects.toThrow(
      "Identificador inválido",
    );
  });
});
