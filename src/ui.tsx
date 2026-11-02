import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Claim, FavTrip, Person, Refs, Vehicle } from "./types";
import { receiptURL } from "./lib/data";
import { STATUS, type Totals } from "./lib/rules";
import { eur, fmtDateTime, num1 } from "./lib/format";

// ───────── Contexto da aplicação ─────────
export type View = "mes" | "km" | "hist" | "perfil" | "aprov" | "review" | "admin";
export type AppCtx = {
  me: Person;
  refs: Refs;
  claims: Claim[];
  vehicle: Vehicle | null;
  favs: FavTrip[];
  today: string;
  selId: string | null;
  reload: () => Promise<void>;
  toast: (text: string, kind?: "ok" | "err") => void;
  fail: (e: unknown) => void;
  go: (v: View, claimId?: string | null) => void;
  log: (action: string) => void;
};
export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error("AppContext em falta");
  return c;
}

// ───────── Janelas de confirmação / motivo ─────────
type DialogReq = { text: string; withReason: boolean; resolve: (v: string | null) => void };
const listeners = new Set<(r: DialogReq) => void>();
export function askConfirm(text: string): Promise<boolean> {
  return new Promise((resolve) => listeners.forEach((l) => l({ text, withReason: false, resolve: (v) => resolve(v !== null) })));
}
export function askReason(text: string): Promise<string | null> {
  return new Promise((resolve) => listeners.forEach((l) => l({ text, withReason: true, resolve })));
}
export function DialogHost() {
  const [req, setReq] = useState<DialogReq | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const l = (r: DialogReq) => {
      setReason("");
      setReq(r);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!req) return null;
  const close = (v: string | null) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <Modal title="Confirmar" onClose={() => close(null)} footer={<><button className="btn" onClick={() => close(null)}>Cancelar</button><button className="btn primary" disabled={req.withReason && !reason.trim()} onClick={() => close(req.withReason ? reason.trim() : "ok")}>Confirmar</button></>}>
      <p style={{ marginTop: 0 }}>{req.text}</p>
      {req.withReason && <Field label="Motivo (obrigatório, fica no audit log)"><textarea className="in" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
    </Modal>
  );
}

// ───────── Componentes ─────────
export function Chip({ tone = "info", children, title }: { tone?: "info" | "warn" | "err" | "ok"; children: ReactNode; title?: string }) {
  return <span className={`chip ${tone}`} title={title}>{children}</span>;
}
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "info" as const };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}
export function Field({ label, hint, error, ocr, children }: { label: string; hint?: ReactNode; error?: string; ocr?: boolean; children: ReactNode }) {
  return (
    <div className="fld">
      <label>{label}{ocr && <span className="ocr">Lido</span>}</label>
      {children}
      {error ? <div className="hint err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
export function Seg({ options, value, onChange, disabled }: { options: { v: string; l: string }[]; value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="seg" style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))` }}>
      {options.map((o) => (
        <button type="button" key={o.v} disabled={disabled} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button className="x" onClick={onClose} aria-label="Fechar">×</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
export function Thumb({ path, type, onClick, size = 40 }: { path: string | null; type: string | null; onClick?: () => void; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    if (path && type !== "application/pdf") receiptURL(path).then((u) => on && setUrl(u)).catch(() => undefined);
    return () => {
      on = false;
    };
  }, [path, type]);
  const st = { width: size, height: Math.round(size * 1.3) };
  if (!path) return <span className="thumb empty" style={st}>—</span>;
  if (type === "application/pdf") return <button type="button" className="thumb pdf" style={st} onClick={onClick} aria-label="Ver recibo">PDF</button>;
  return <button type="button" className="thumb" style={{ ...st, backgroundImage: url ? `url(${url})` : "none" }} onClick={onClick} aria-label="Ver recibo"></button>;
}
export function FilePreview({ path, type, onClose }: { path: string; type: string | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    receiptURL(path).then(setUrl).catch(() => setUrl(null));
  }, [path]);
  return (
    <Modal title="Recibo" onClose={onClose} wide>
      {url && (type === "application/pdf" ? <iframe src={url} title="Recibo" style={{ width: "100%", height: "70vh", border: 0 }} /> : <img src={url} alt="Recibo" style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto" }} />)}
    </Modal>
  );
}
export function Kpis({ t }: { t: Totals }) {
  const n = (x: number) => `${x} recibo${x === 1 ? "" : "s"}`;
  return (
    <div className="kpis">
      <div><div className="l">1 · Travel E (FDD)</div><div className="v">{eur(t.FDD)}</div><div className="s">{n(t.n.FDD)}</div></div>
      <div><div className="l">2 · Representation (FDM)</div><div className="v">{eur(t.FDM)}</div><div className="s">{n(t.n.FDM)}</div></div>
      <div><div className="l">3 · Quilómetros</div><div className="v">{eur(t.kmEUR)}</div><div className="s">{num1(t.km)} km × {eur(t.kmRate)}</div></div>
      <div><div className="l">4 · Office E</div><div className="v">{eur(t.OFF)}</div><div className="s">{n(t.n.OFF)}</div></div>
      <div className="total"><div className="l">Total geral</div><div className="v">{eur(t.total)}</div><div className="s">IVA dedutível {eur(t.vat)}</div></div>
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-st"><h4>{title}</h4>{children && <p>{children}</p>}{action}</div>;
}
export function Timeline({ claim, people }: { claim: Claim; people: Person[] }) {
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
  return (
    <div className="timeline">
      {claim.history.map((h) => (
        <div key={h.id}><span className="when">{fmtDateTime(h.at)}</span><span><b>{h.action}</b> · {name(h.actor_id)}{h.comment ? <span className="muted"> — {h.comment}</span> : null}</span></div>
      ))}
    </div>
  );
}
export function PageHead({ eyebrow, title, pills, actions }: { eyebrow: string; title: string; pills?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="month-head">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{pills && <div className="pills">{pills}</div>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
