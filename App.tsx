import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { loadMe, requestAccess } from "./lib/data";
import type { Person } from "./types";
import { Shell } from "./Shell";
import logo from "./assets/legendre-logo.png";

const PENDING_KEY = "despesas_pedido_acesso";
const COMPANIES = [
  { id: "LEGDR", name: "LEGDR Engenharia e Construção" },
  { id: "IBER", name: "Legendre Ibérica" },
];

function KmCheck({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="km-check"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /><span>Uso a minha viatura pessoal em serviço e preencho o mapa de quilómetros<small>Pode alterar depois no Perfil.</small></span></label>
  );
}

function Brand() {
  return <div className="brand-lockup"><img src={logo} alt="LEGENDRE" /><span>Despesas</span></div>;
}
function Message({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="login-screen"><section className="login-panel"><Brand /><h2>{title}</h2>{detail && <p className="muted">{detail}</p>}{children}</section></div>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!hasSupabaseConfig) return <Message title="Ligar o Supabase" detail="Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Netlify (Site configuration → Environment variables)." />;
  if (!ready) return <Message title="A abrir…" />;
  if (recovery && session) return <ResetPassword onDone={() => setRecovery(false)} />;
  if (!session) return <Login />;
  return <Gate session={session} />;
}

function Gate({ session }: { session: Session }) {
  const email = session.user.email ?? "";
  const [me, setMe] = useState<Person | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const load = () => loadMe(email).then(setMe).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
  }, [email]);
  const out = () => void supabase?.auth.signOut();
  if (err) return <Message title="Erro ao carregar o perfil" detail={err}><button className="btn" onClick={out}>Terminar sessão</button></Message>;
  if (me === undefined) return <Message title="A carregar…" />;
  if (me === null) return <RequestAccess email={email} onDone={load} onSignOut={out} />;
  if (!me.active) return <Message title="Acesso pendente" detail={`O pedido de ${me.full_name} foi recebido. O administrador vai ativar a conta e indicar o seu manager. Depois, basta voltar a entrar.`}><button className="btn" onClick={out}>Terminar sessão</button></Message>;
  return <Shell me={me} onSignOut={out} />;
}

function RequestAccess({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  const saved = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "{}") as { name?: string; mat?: string; company?: string; km?: boolean };
    } catch {
      return {};
    }
  })();
  const [name, setName] = useState(saved.name ?? "");
  const [mat, setMat] = useState(saved.mat ?? "");
  const [company, setCompany] = useState(saved.company ?? "LEGDR");
  const [km, setKm] = useState(saved.km ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Se os dados já foram preenchidos ao criar a conta, envia o pedido sem pedir outra vez
  useEffect(() => {
    if (saved.name && saved.mat) void send();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await send();
  }
  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await requestAccess(name, mat, company, km);
      window.localStorage.removeItem(PENDING_KEY);
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen"><section className="login-panel"><Brand />
      <h2>Pedir acesso às Despesas</h2>
      <p className="muted">Sessão iniciada como {email}.</p>
      <form className="login-form" onSubmit={submit}>
        <label>Nome completo<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Nº de colaborador (MAT)<input required placeholder="MAT12345" value={mat} onChange={(e) => setMat(e.target.value.toUpperCase())} /></label>
        <label>Empresa<select value={company} onChange={(e) => setCompany(e.target.value)}>{COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <KmCheck value={km} onChange={setKm} />
        <button className="btn primary" disabled={busy || !name || !mat} type="submit">Pedir acesso</button>
      </form>
      <button className="link-button" onClick={onSignOut}>Terminar sessão</button>
      {msg && <div className="notice err-n">{msg}</div>}
    </section></div>
  );
}

function Login() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [name, setName] = useState("");
  const [mat, setMat] = useState("");
  const [company, setCompany] = useState("LEGDR");
  const [km, setKm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setMsg(error.message === "Invalid login credentials" ? "Email ou palavra-passe incorretos." : error.message);
  }
  async function register(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (pw.length < 6) return setMsg("A palavra-passe deve ter pelo menos 6 caracteres.");
    if (pw !== pw2) return setMsg("As palavras-passe não coincidem.");
    setBusy(true);
    setMsg(null);
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ name, mat, company, km }));
    const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name }, emailRedirectTo: window.location.origin } });
    if (error) {
      setBusy(false);
      return setMsg(error.message);
    }
    if (data.session) {
      try {
        await requestAccess(name, mat, company, km);
        window.localStorage.removeItem(PENDING_KEY);
      } catch {
        // volta a pedir no ecrã seguinte
      }
    } else {
      setMsg("Conta criada. Confirme o email (se lhe for pedido) e entre: o pedido de acesso fica a aguardar o administrador.");
      setMode("login");
    }
    setBusy(false);
  }
  async function reset(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setBusy(false);
    setMsg(error ? error.message : "Email de recuperação enviado.");
  }
  return (
    <div className="login-screen"><section className="login-panel"><Brand />
      {mode === "login" && (
        <form className="login-form" onSubmit={signIn}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Palavra-passe<input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <button className="btn primary" disabled={busy} type="submit">Entrar</button>
          <button type="button" className="link-button" onClick={() => { setMsg(null); setMode("register"); }}>Criar nova conta</button>
          <button type="button" className="link-button" onClick={() => { setMsg(null); setMode("reset"); }}>Esqueci a palavra-passe</button>
        </form>
      )}
      {mode === "register" && (
        <form className="login-form" onSubmit={register}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Nome completo<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Nº de colaborador (MAT)<input required placeholder="MAT12345" value={mat} onChange={(e) => setMat(e.target.value.toUpperCase())} /></label>
          <label>Empresa<select value={company} onChange={(e) => setCompany(e.target.value)}>{COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <KmCheck value={km} onChange={setKm} />
          <label>Palavra-passe<input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label>Confirmar palavra-passe<input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          <button className="btn primary" disabled={busy} type="submit">Pedir acesso</button>
          <button type="button" className="link-button" onClick={() => setMode("login")}>Voltar</button>
        </form>
      )}
      {mode === "reset" && (
        <form className="login-form" onSubmit={reset}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn primary" disabled={busy} type="submit">Enviar email de recuperação</button>
          <button type="button" className="link-button" onClick={() => setMode("login")}>Voltar</button>
        </form>
      )}
      {msg && <div className="notice">{msg}</div>}
    </section></div>
  );
}

function ResetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (pw.length < 6 || pw !== pw2) return setMsg("As palavras-passe têm de coincidir e ter pelo menos 6 caracteres.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setMsg(error.message);
    onDone();
  }
  return (
    <div className="login-screen"><section className="login-panel"><Brand />
      <form className="login-form" onSubmit={save}>
        <label>Nova palavra-passe<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Confirmar<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="btn primary" type="submit">Guardar</button>
      </form>
      {msg && <div className="notice">{msg}</div>}
    </section></div>
  );
}
