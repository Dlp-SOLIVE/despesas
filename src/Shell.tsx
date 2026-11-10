import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Claim, FavTrip, Person, Refs, Vehicle } from "./types";
import { audit, loadClaims, loadFavs, loadRefs, loadVehicle, syncLang } from "./lib/data";
import { isoToday, initials } from "./lib/format";
import { ROLES } from "./lib/rules";
import { AppContext, DialogHost, LangToggle, type AppCtx, type View } from "./ui";
import { getLang, hasLangChoice, setLang, tr, trServer, useLang } from "./lib/i18n";
import { MonthView } from "./views/Month";
import { KmView } from "./views/Km";
import { HistoryView, ProfileView } from "./views/History";
import { ApprovalsView, ReviewView, queueFor } from "./views/Approvals";
import { AdminView } from "./views/Admin";
import logo from "./assets/legendre-logo.png";

const UI_KEY = "despesas_ui";

export function Shell({ me: initialMe, onSignOut }: { me: Person; onSignOut: () => void }) {
  const lang = useLang();
  const [refs, setRefs] = useState<Refs | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [favs, setFavs] = useState<FavTrip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: "ok" | "err" }[]>([]);
  const [ui, setUi] = useState<{ view: View; selId: string | null }>(() => {
    // Ligação do email: ?pedido=<id> abre a revisão desse pedido
    const linked = new URLSearchParams(window.location.search).get("pedido");
    if (linked) {
      window.history.replaceState(null, "", window.location.pathname);
      return { view: "review", selId: linked };
    }
    try {
      const v = JSON.parse(window.sessionStorage.getItem(UI_KEY) ?? "null") as { view: View; selId: string | null } | null;
      if (v && v.view) return v;
    } catch {
      // ignora
    }
    return { view: ["rh", "contabilidade"].includes(initialMe.role) ? "aprov" : initialMe.role === "admin" ? "admin" : "mes", selId: null };
  });
  // Botão "voltar" do browser: cada mudança de ecrã fica no histórico
  useEffect(() => {
    window.history.replaceState({ despesas: ui }, "");
    const onPop = (e: PopStateEvent) => {
      const st = (e.state as { despesas?: { view: View; selId: string | null } } | null)?.despesas;
      if (st) setUi(st);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch {
      // ignora
    }
  }, [ui]);

  const reload = useCallback(async () => {
    try {
      const [r, c, v, f] = await Promise.all([loadRefs(), loadClaims(), loadVehicle(initialMe.id), loadFavs(initialMe.id)]);
      setRefs(r);
      setClaims(c);
      setVehicle(v);
      setFavs(f);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [initialMe.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Língua dos emails: a escolha PT/EN fica também no perfil (a função exp-notify usa-a).
  // Num browser sem escolha feita, adota a língua do perfil. Falhas (ex.: SQL por correr) são ignoradas.
  const langSynced = useRef(false);
  useEffect(() => {
    const chosen = hasLangChoice();
    syncLang(chosen ? getLang() : null)
      .then((saved) => {
        if (!chosen && saved) setLang(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        langSynced.current = true;
      });
  }, []);
  useEffect(() => {
    if (langSynced.current) void syncLang(lang).catch(() => undefined);
  }, [lang]);


  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 6000 : 3500);
  }, []);

  const me = refs?.people.find((p) => p.id === initialMe.id) ?? initialMe;
  const ctx: AppCtx | null = useMemo(() => {
    if (!refs) return null;
    return {
      me,
      refs,
      claims,
      vehicle,
      favs,
      today: isoToday(),
      selId: ui.selId,
      reload,
      toast,
      fail: (e: unknown) => toast(trServer(e instanceof Error ? e.message : String(e)), "err"),
      go: (view: View, claimId?: string | null) => {
        const next = { view, selId: claimId === undefined ? ui.selId : claimId };
        if (next.view !== ui.view || next.selId !== ui.selId) window.history.pushState({ despesas: next }, "");
        setUi(next);
        window.scrollTo(0, 0);
      },
      log: (action: string) => {
        void audit(me.id, action).catch(() => undefined);
      },
    };
    // a língua entra nas dependências para os ecrãs se redesenharem ao mudar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, refs, claims, vehicle, favs, ui.selId, reload, toast, lang]);

  const approver = ["manager", "rh", "contabilidade", "admin"].includes(me.role);
  const pend = ctx && approver ? queueFor(ctx).length : 0;
  const nav: [View, string][] = [
    ...(approver ? [["aprov", me.role === "contabilidade" ? tr("Pagamentos", "Payments") : tr("Aprovações", "Approvals")] as [View, string]] : []),
    ["mes", tr("O meu mês", "My month")],
    ...(me.uses_km ? [["km", tr("Quilómetros", "Mileage")] as [View, string]] : []),
    ["hist", tr("Histórico", "History")],
    ["perfil", tr("Perfil", "Profile")],
    ...(me.role === "admin" ? [["admin", tr("Administração", "Administration")] as [View, string]] : []),
  ];
  const active = ui.view === "review" ? (approver ? "aprov" : "hist") : ui.view;

  return (
    <div className="app">
      <header className="appbar">
        <button type="button" className="home" onClick={() => ctx?.go(approver && me.role !== "manager" ? "aprov" : "mes", null)} aria-label={tr("Início", "Home")}>
          <img src={logo} alt="LEGENDRE" />
          <span className="prod">{tr("Despesas", "Expenses")}</span>
        </button>
        <nav>
          {nav.map(([k, l]) => (
            <button key={k} className={active === k ? "on" : ""} onClick={() => ctx?.go(k, k === "mes" || k === "km" ? null : undefined)}>
              {l}{k === "aprov" && pend > 0 && <span className="badge">{pend}</span>}
            </button>
          ))}
        </nav>
        <div className="me">
          <span className="me-n">{me.full_name}<small>{ROLES[me.role]}</small></span>
          <LangToggle />
          <span className="av">{initials(me.full_name)}</span>
          <button className="link-button" onClick={onSignOut}>{tr("Sair", "Sign out")}</button>
        </div>
      </header>
      {error && <div className="app-body" style={{ paddingBottom: 0 }}><div className="notice err-n">{error} <button className="link-button" onClick={() => void reload()}>{tr("Tentar de novo", "Try again")}</button></div></div>}
      {!ctx ? (
        <div className="app-body"><p className="muted">{tr("A carregar…", "Loading…")}</p></div>
      ) : (
        <AppContext.Provider value={ctx}>
          {ui.view === "mes" && <MonthView />}
          {ui.view === "km" && <KmView />}
          {ui.view === "hist" && <HistoryView />}
          {ui.view === "perfil" && <ProfileView />}
          {ui.view === "aprov" && <ApprovalsView />}
          {ui.view === "review" && <ReviewView key={ui.selId ?? "none"} />}
          {ui.view === "admin" && me.role === "admin" && <AdminView />}
          <DialogHost />
        </AppContext.Provider>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} role="status">{t.text}</div>)}
        </div>
      )}
    </div>
  );
}
