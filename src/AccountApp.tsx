import { useEffect, useRef, useState } from "react";
import {
  ChartNoAxesCombined,
  Eye,
  EyeOff,
  FileSpreadsheet,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import Dashboard from "./Dashboard";
import { ApiError, api, initialStore, legacyPortfolio } from "./account";
import type { SavedPortfolio, SaveStatus, Store, User } from "./account";
import "./authLanding.css";

export default function AccountApp() {
  const [session, setSession] = useState<{
    user: User;
    portfolio: SavedPortfolio;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { user } = await api<{ user: User }>("/auth/me");
        const portfolio = await api<SavedPortfolio>("/portfolio");
        if (active) setSession({ user, portfolio });
      } catch (issue) {
        if (active && (!(issue instanceof ApiError) || issue.status !== 401))
          setError(
            issue instanceof Error
              ? issue.message
              : "Erro ao carregar a conta.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [attempt]);
  async function signedIn(user: User) {
    const portfolio = await api<SavedPortfolio>("/portfolio");
    setSession({ user, portfolio });
  }
  if (loading)
    return (
      <div className="account-loading" role="status">
        <LoaderCircle className="spinning" size={27} />
        <span>Carregando sua conta…</span>
      </div>
    );
  if (error)
    return (
      <div className="account-loading">
        <ShieldCheck size={30} />
        <h1>Não foi possível abrir sua conta</h1>
        <p role="alert">{error}</p>
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  return session ? (
    <AccountWorkspace
      key={session.user.id}
      user={session.user}
      portfolio={session.portfolio}
      onSignedOut={() => setSession(null)}
    />
  ) : (
    <SignIn onSignedIn={signedIn} />
  );
}

function AccountWorkspace({
  user,
  portfolio,
  onSignedOut,
}: {
  user: User;
  portfolio: SavedPortfolio;
  onSignedOut: () => void;
}) {
  const [store, setStore] = useState<Store>(
    () => portfolio.store ?? initialStore(),
  );
  const [legacy, setLegacy] = useState<Store | null>(() =>
    portfolio.store && !portfolio.store.demo ? null : legacyPortfolio(),
  );
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const latest = useRef(store);
  const saved = useRef(store);
  const revision = useRef(portfolio.revision);
  const active = useRef(true);
  const blocked = useRef(false);
  const migration = useRef<Store | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function saveNow() {
    if (inFlight.current) return inFlight.current;
    if (blocked.current)
      throw new Error(
        "A carteira mudou em outra aba. Exporte suas alterações antes de recarregar.",
      );
    const operation = async () => {
      while (active.current && saved.current !== latest.current) {
        const snapshot = latest.current;
        setStatus("saving");
        setError("");
        try {
          const result = await api<SavedPortfolio>(
            "/portfolio",
            { revision: revision.current, store: snapshot },
            "PUT",
          );
          revision.current = result.revision;
          saved.current = snapshot;
          if (migration.current === snapshot) {
            try {
              localStorage.removeItem("lastro-v1");
            } catch {}
            migration.current = null;
          }
          if (active.current) setStatus("saved");
        } catch (issue) {
          if (active.current) {
            blocked.current = issue instanceof ApiError && issue.status === 409;
            setStatus(blocked.current ? "conflict" : "error");
            setError(
              issue instanceof Error
                ? issue.message
                : "Erro ao salvar a carteira.",
            );
          }
          throw issue;
        }
      }
    };
    inFlight.current = operation();
    try {
      await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }
  useEffect(() => {
    latest.current = store;
    if (store === saved.current || blocked.current) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [store]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saved.current !== latest.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function updateStore(next: Store | ((current: Store) => Store)) {
    const updated = typeof next === "function" ? next(latest.current) : next;
    latest.current = updated;
    setStatus(updated === saved.current ? "saved" : "pending");
    setStore(updated);
  }
  async function signOut() {
    setSigningOut(true);
    try {
      await saveNow();
      await api("/auth/logout", {});
      onSignedOut();
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : "Não foi possível sair.",
      );
      setSigningOut(false);
    }
  }
  function migrate() {
    if (!legacy) return;
    migration.current = legacy;
    updateStore(legacy);
    setLegacy(null);
  }
  return (
    <Dashboard
      store={store}
      setStore={updateStore}
      user={user}
      saveStatus={status}
      saveError={error}
      onRetrySave={() => {
        void saveNow().catch(() => {});
      }}
      onLogout={() => {
        void signOut();
      }}
      signingOut={signingOut}
      legacyAvailable={Boolean(legacy)}
      onMigrate={migrate}
      onDismissMigration={() => setLegacy(null)}
    />
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (user: User) => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>(
        register ? "/auth/register" : "/auth/login",
        { email, password, ...(register ? { name } : {}) },
      );
      setPassword("");
      await onSignedIn(user);
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : "Não foi possível entrar.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="auth-page auth-landing">
      <section className="auth-story">
        <div className="auth-brand">
          <span className="brand-mark"><ChartNoAxesCombined size={28} /></span>
          lastro<span>.</span>
        </div>
        <div className="auth-story-copy">
          <span className="auth-story-kicker">INVISTA COM MAIS CLAREZA</span>
          <h1>Consolide sua carteira.<br />Entenda o mercado.<br /><span>Evolua como investidor.</span></h1>
          <p>Aqui simplificamos sua carteira consolidando todos seus investimentos.</p>
        </div>
        <div className="auth-steps" aria-label="Como funciona">
          <article><span className="auth-step-number">01</span><UserPlus size={19} /><strong>Crie sua conta</strong><small>Seu espaço privado para investir com clareza.</small></article>
          <article><span className="auth-step-number">02</span><FileSpreadsheet size={19} /><strong>Importe suas notas</strong><small>Reúna seus investimentos em um só lugar.</small></article>
          <article><span className="auth-step-number">03</span><ChartNoAxesCombined size={19} /><strong>Analise sua carteira</strong><small>Acompanhe custos, posições e evolução.</small></article>
        </div>
        <span className="auth-footer"><ShieldCheck size={14} />Uma conta. Uma visão completa.</span>
      </section>
      <div className="auth-entry">
      <section className="auth-panel">
        <span className="modal-symbol">
          <LockKeyhole size={23} />
        </span>
        <h1>
          {register ? "Seu patrimônio, sua conta." : "Bom ter você de volta."}
        </h1>
        <p className="auth-subtitle">
          {register
            ? "Crie sua conta no Lastro."
            : "Entre para acessar sua carteira."}
        </p>
        <div className="auth-tabs">
          <button
            type="button"
            className={!register ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setRegister(false);
              setError("");
              setPassword("");
            }}
          >
            Entrar
          </button>
          <button
            type="button"
            className={register ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setRegister(true);
              setError("");
              setPassword("");
            }}
          >
            Criar conta
          </button>
        </div>
        <form onSubmit={submit}>
          {register && (
            <label>
              Nome
              <input
                autoComplete="name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
                disabled={busy}
              />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
              disabled={busy}
            />
          </label>
          <label>
            Senha
            <span className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={register ? "new-password" : "current-password"}
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                maxLength={128}
                required
                disabled={busy}
              />
              <button
                type="button"
                className="icon-button"
                title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
            {register && <small>Mínimo de 6 caracteres.</small>}
          </label>
          {error && (
            <div className="import-error" role="alert">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="button primary full-width"
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle size={17} className="spinning" />
            ) : register ? (
              <UserPlus size={17} />
            ) : (
              <LogIn size={17} />
            )}
            {busy
              ? "Aguarde…"
              : register
                ? "Criar minha conta"
                : "Entrar na minha conta"}
          </button>
        </form>
      </section>
      </div>
    </main>
  );
}
