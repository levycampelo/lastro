import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export class ConflictError extends Error {}

export function createStorage(directory) {
  const root = path.resolve(directory);
  let pending = Promise.resolve();

  function exclusive(operation) {
    const next = pending.then(operation);
    pending = next.catch(() => {});
    return next;
  }

  function filename(group, id) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Identificador inválido.");
    return path.join(root, group, `${id}.json`);
  }

  async function read(group, id) {
    try {
      return JSON.parse(await readFile(filename(group, id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function write(group, id, value) {
    const target = filename(group, id);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function accounts() {
    let files;
    try {
      files = await readdir(path.join(root, "clients"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => read("clients", file.slice(0, -5))),
    );
  }

  return {
    async findAccount(email) {
      return (
        (await accounts()).find((account) => account.email === email) ?? null
      );
    },
    async account(id) {
      return read("clients", id);
    },
    async register(account) {
      return exclusive(async () => {
        if (
          (await accounts()).some(
            (existing) => existing.email === account.email,
          )
        )
          throw new ConflictError("Este e-mail já está cadastrado.");
        await write("clients", account.id, account);
        return account;
      });
    },
    async portfolio(id) {
      return (await read("portfolios", id)) ?? { revision: 0, store: null };
    },
    async dailyNews() {
      return read("cache", "infomoney-news-onde-investir-v4");
    },
    async saveDailyNews(value) {
      return exclusive(() => write("cache", "infomoney-news-onde-investir-v4", value));
    },
    async savePortfolio(id, store, revision) {
      return exclusive(async () => {
        const previous = (await read("portfolios", id)) ?? {
          revision: 0,
          store: null,
        };
        if (previous.revision !== revision)
          throw new ConflictError(
            "A carteira foi alterada em outra aba. Recarregue antes de salvar novamente.",
          );
        const next = {
          revision: revision + 1,
          savedAt: new Date().toISOString(),
          store,
        };
        if (previous.store) await write("backups", id, previous);
        await write("portfolios", id, next);
        return next;
      });
    },
    async session(hash) {
      return read("sessions", hash);
    },
    async saveSession(hash, session) {
      return exclusive(() => write("sessions", hash, session));
    },
    async deleteSession(hash) {
      return exclusive(() => rm(filename("sessions", hash), { force: true }));
    },
  };
}
