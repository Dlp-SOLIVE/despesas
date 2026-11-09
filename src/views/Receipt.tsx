import { useEffect, useRef, useState } from "react";
import type { Claim, Currency, Details, ExpType, Line, Participant } from "../types";
import { downloadReceipt, receiptURL, saveLine, uploadReceipt, type LineInput } from "../lib/data";
import { pdfPreview, readReceiptLocally, type LocalRead } from "../lib/localOcr";
import { eur } from "../lib/format";
import { NIF_NA, TYPES, TYPE_KEYS, detailSchema, detailText, isNifNA, lineIssues, optionLabel, suggestSub } from "../lib/rules";
import { tr } from "../lib/i18n";
import { Field, Modal, Seg, useApp } from "../ui";
import { ruleCtx } from "./common";


// Entidade já usada para este NIF emitente (recibos anteriores)
function knownLine(claims: Claim[], r: LocalRead) {
  if (!r.nif_issuer) return null;
  return claims.flatMap((c) => c.lines).find((l) => (l.ocr as { nif_issuer?: string } | null)?.nif_issuer === r.nif_issuer && l.client?.trim()) ?? null;
}
export function knownClient(claims: Claim[], r: LocalRead): string | null {
  return knownLine(claims, r)?.client ?? null;
}

// Junta o resultado da leitura a um recibo (não apaga o que o colaborador já escreveu)
export function applyRead(p: LineInput, r: LocalRead, claims: Claim[], companyNifs: string[] = []): LineInput {
  const n: LineInput = { ...p, details: { ...p.details }, ocr: r as Record<string, unknown> };
  if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) n.receipt_date = r.date;
  const kl = knownLine(claims, r);
  const name = kl?.client ?? r.client ?? r.legal_name;
  if (name && (!p.client || !p.client.trim())) n.client = name;
  const legal = kl?.details?.legal ?? r.legal_name;
  if (legal && !n.details.legal) n.details.legal = legal;
  // NIF da empresa: se aparecer em qualquer parte do texto lido, é esse (mais fiável do que adivinhar entre os NIFs do recibo)
  const digitsText = (r.raw_text ?? "").replace(/\D/g, "");
  const own = companyNifs.find((x) => x.replace(/\D/g, "").length === 9 && digitsText.includes(x.replace(/\D/g, "")));
  if (own) n.nif = own;
  else if (r.nif_buyer) n.nif = r.nif_buyer;
  if (typeof r.total_incl === "number") n.incl = r.total_incl;
  if (typeof r.total_excl === "number") n.excl = r.total_excl;
  else if (r.vat_breakdown === false && typeof r.total_incl === "number") n.excl = r.total_incl;
  if (r.currency === "GBP" || r.currency === "EUR") n.currency = r.currency as Currency;

  const t = r.suggested_type as ExpType | null | undefined;
  if (!p.type && t && TYPE_KEYS.includes(t)) n.type = t;
  const ty = n.type;
  if (!p.sub && ty && r.suggested_sub && TYPES[ty].subs.includes(r.suggested_sub)) n.sub = r.suggested_sub;
  if (n.sub === "Others travel expenses" && r.others_kind && !n.details.kind) n.details.kind = r.others_kind;
  if (n.sub === "Hotels" && r.city && !n.details.cidade) n.details.cidade = r.city;
  if ((n.sub === "Flight ticket" || n.sub === "Train Ticket") && !n.details.origem && r.route_from) n.details.origem = r.route_from;
  if ((n.sub === "Flight ticket" || n.sub === "Train Ticket") && !n.details.destino && r.route_to) n.details.destino = r.route_to;
  return n;
}

export const blankLine = (no: number): LineInput => ({ no, receipt_date: null, type: null, sub: null, details: {}, client: "", nif: "", currency: "EUR", rate: 1, excl: null, incl: null, file_path: null, file_type: null, ocr: null });

type OcrFlags = Partial<Record<"date" | "client" | "legal" | "nif" | "excl" | "incl", boolean>>;

export function ReceiptModal({ claim, line, onClose }: { claim: Claim; line: Line | null; onClose: () => void }) {
  const app = useApp();
  const rc = ruleCtx(app, claim);
  const [f, setF] = useState<LineInput>(() =>
    line
      ? { ...line, details: { ...line.details } }
      : { no: claim.lines.length + 1, receipt_date: null, type: null, sub: null, details: {}, client: "", nif: "", currency: "EUR", rate: 1, excl: null, incl: null, file_path: null, file_type: null, ocr: null },
  );
  const [noVat, setNoVat] = useState(line ? line.excl !== null && Number(line.excl) === Number(line.incl) : false);
  const [ocr, setOcr] = useState<OcrFlags>({});
  const [busy, setBusy] = useState<"" | "up" | "ocr" | "save">("");
  const [url, setUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [progress, setProgress] = useState("");
  const rot = Number((f.ocr as { rotation?: number } | null)?.rotation ?? 0);

  useEffect(() => {
    let on = true;
    if (!f.file_path) setUrl(null);
    else if (f.file_type !== "application/pdf") receiptURL(f.file_path).then((u) => on && setUrl(u)).catch(() => on && setUrl(null));
    else {
      const path = f.file_path;
      (async () => blobRef.current ?? (await downloadReceipt(path)))()
        .then((b) => pdfPreview(b))
        .then((u) => on && setUrl(u))
        .catch(() => on && setUrl(null));
    }
    return () => {
      on = false;
    };
  }, [f.file_path, f.file_type]);

  const set = <K extends keyof LineInput>(k: K, v: LineInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const setD = <K extends keyof Details>(k: K, v: Details[K]) => setF((p) => ({ ...p, details: { ...p.details, [k]: v } }));
  const numOrNull = (s: string) => (s === "" ? null : Number(s));

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return app.toast(tr("Ficheiro acima de 10 MB. Reduza a resolução da fotografia.", "File over 10 MB. Reduce the photo resolution."), "err");
    setBusy("up");
    try {
      const up = await uploadReceipt(file, app.me.id, claim.id);
      blobRef.current = file;
      setF((p) => ({ ...p, file_path: up.path, file_type: up.type }));
      setOcr({});
      await read(file, up.type);
    } catch (e) {
      app.fail(e);
      setBusy("");
    }
  }

  async function read(fileArg?: Blob, typeArg?: string) {
    const path = f.file_path;
    if (!fileArg && !path) return;
    setBusy("ocr");
    setProgress(tr("A preparar…", "Preparing…"));
    try {
      const blob = fileArg ?? blobRef.current ?? (path ? await downloadReceipt(path) : null);
      if (!blob) return;
      blobRef.current = blob;
      const r = await readReceiptLocally(blob, typeArg ?? f.file_type ?? blob.type, setProgress);
      if (r.source === "nenhum") {
        app.toast(tr("Não foi possível ler este recibo. Preencha os campos à mão.", "This receipt could not be read. Fill in the fields manually."), "err");
        return;
      }
      const flags: OcrFlags = {
        date: !!(r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)),
        client: !!r.client,
        legal: !!r.legal_name,
        nif: !!r.nif_buyer || app.refs.companies.some((c) => (r.raw_text ?? "").replace(/\D/g, "").includes(c.nif.replace(/\D/g, ""))),
        incl: typeof r.total_incl === "number",
        excl: typeof r.total_excl === "number",
      };
      flags.client = !!knownClient(app.claims, r) || flags.client;
      setF((p) => {
        const n = applyRead(p, r, app.claims, app.refs.companies.map((c) => c.nif));
        return n;
      });
      if (r.vat_breakdown === false) setNoVat(true);
      else if (r.vat_breakdown === true) setNoVat(false);
      setOcr(flags);
      app.toast(r.source === "qr" ? tr("Dados lidos do código QR da fatura. Confirme a entidade e complete os Details.", "Data read from the invoice QR code. Check the supplier and complete the Details.") : tr("Texto lido (sem código QR). Confirme data, valores e IVA.", "Text read (no QR code). Check the date, amounts and VAT."));
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  const effective: Line = { ...(f as Line), id: line?.id ?? "new", claim_id: claim.id, approver_note: null, excl: noVat ? f.incl : f.excl };
  const issues = lineIssues(effective, rc);
  const errs = issues.filter((i) => i.lv === "err").length;
  const vat = (Number(f.incl) || 0) - (Number(f.excl) || 0);
  const rate = Number(f.excl) ? (vat / Number(f.excl)) * 100 : 0;
  const sug = f.sub === "Others travel expenses" ? suggestSub(f.client) : null;
  const schema = detailSchema(f.sub);

  async function save() {
    if (errs) return app.toast(tr("Preencha todos os campos obrigatórios antes de guardar.", "Fill in all required fields before saving."), "err");
    setBusy("save");
    try {
      await saveLine(claim.id, { ...f, id: line?.id, excl: noVat ? f.incl : f.excl });
      app.log(`${line ? "Editou" : "Adicionou"} recibo ${f.no} · ${claim.cost_center} ${claim.period}`);
      await app.reload();
      app.toast(errs ? tr(`Recibo nº ${f.no} guardado com ${errs} erro(s) a corrigir antes de submeter.`, `Receipt no. ${f.no} saved with ${errs} error(s) to fix before submitting.`) : tr(`Recibo nº ${f.no} guardado.`, `Receipt no. ${f.no} saved.`));
      onClose();
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal wide title={line ? tr(`Editar recibo · nº ${f.no}`, `Edit receipt · no. ${f.no}`) : tr(`Novo recibo · nº ${f.no}`, `New receipt · no. ${f.no}`)} onClose={onClose} footer={
      <>
        <span className={errs ? "push-left" : "muted push-left"} style={errs ? { color: "var(--danger)" } : undefined}>{errs ? tr(`Faltam ${errs} campo(s) obrigatório(s) — ver a lista à esquerda`, `${errs} required field(s) missing — see the list on the left`) : tr("Recibo conforme", "Receipt compliant")}</span>
        <button className="btn" onClick={onClose}>{tr("Cancelar", "Cancel")}</button>
        <button className="btn primary" disabled={!!busy || errs > 0} title={errs ? tr("Preencha todos os campos obrigatórios (procedimento RH)", "Fill in all required fields (HR procedure)") : undefined} onClick={() => void save()}>{busy === "save" ? tr("A guardar…", "Saving…") : tr("Guardar recibo", "Save receipt")}</button>
      </>
    }>
      <div className="rc-grid">
        <div>
          <div className={f.file_path ? "drop has" : "drop"} role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
            <span className="no">{f.no}</span>
            {busy === "up" ? <span className="muted">{tr("A carregar…", "Uploading…")}</span> : f.file_path ? (url ? <img src={url} alt={tr("Recibo", "Receipt")} style={rot ? { transform: `rotate(${rot}deg)` } : undefined} /> : <span><b>{tr("PDF anexado", "PDF attached")}</b><br /><span className="muted">{tr("Clique para substituir", "Click to replace")}</span></span>) : <span><b>{tr("Fotografar ou carregar recibo", "Take a photo or upload receipt")}</b><br /><span className="muted">{tr("Imagem ou PDF · arraste para aqui", "Image or PDF · drag it here")}</span></span>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          <div className="ocr-bar">
            <button className="btn dark" disabled={!f.file_path || !!busy} onClick={() => void read()}>{busy === "ocr" ? progress || tr("A ler recibo…", "Reading receipt…") : tr("Ler recibo novamente", "Read receipt again")}</button>
            <span className="muted">{tr("Lido automaticamente ao carregar: código QR das faturas portuguesas (dados exatos) ou texto do recibo. Tudo no seu computador; nada é enviado para serviços externos. Todos os campos podem ser corrigidos à mão.", "Read automatically on upload: QR code on Portuguese invoices (exact data) or the receipt text. Everything runs on your computer; nothing is sent to external services. All fields can be corrected manually.")}</span>
          </div>
          {f.ocr && (
            <details className="muted small" style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer" }}>{tr("Texto lido do recibo", "Text read from the receipt")}</summary>
              <div>{tr("Origem", "Source")}: {String((f.ocr as { source?: string }).source ?? "—")} · {tr("rotação", "rotation")} {rot}° · {tr("versão", "version")} 03-11-c</div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 180, overflow: "auto", background: "var(--black-04)", padding: 8, margin: "6px 0 0" }}>{String((f.ocr as { raw_text?: string }).raw_text ?? tr("(sem texto)", "(no text)"))}</pre>
            </details>
          )}
          <div className="issues">{issues.length ? issues.map((i, k) => <div key={k} className={i.lv}>{i.msg}</div>) : <div className="ok">{tr("Sem alertas", "No alerts")}</div>}</div>
        </div>
        <div className="form">
          <div className="row2">
            <Field label={tr("Data do recibo", "Receipt date")} ocr={ocr.date} hint={tr("A data que aparece no recibo", "The date shown on the receipt")}><input className="in" type="date" max={app.today} value={f.receipt_date ?? ""} onChange={(e) => set("receipt_date", e.target.value || null)} /></Field>
            <Field label={tr("NIF no recibo", "VAT number (NIF) on receipt")} ocr={ocr.nif} hint={isNifNA(f.nif) ? tr("Recibo sem NIF (N/A)", "Receipt without VAT number (N/A)") : rc.company ? tr(`Deve ser ${rc.company.nif}`, `Must be ${rc.company.nif}`) : undefined}><input className="in" value={f.nif ?? ""} disabled={isNifNA(f.nif)} placeholder={tr("NIF do adquirente", "Buyer VAT number")} onChange={(e) => set("nif", e.target.value)} /></Field>
          </div>
          <label className="cb"><input type="checkbox" checked={isNifNA(f.nif)} onChange={(e) => set("nif", e.target.checked ? NIF_NA : "")} /> {tr("O recibo não tem NIF (N/A) — ex.: compra num site estrangeiro que não pede NIF", "The receipt has no VAT number (N/A) — e.g. purchase on a foreign website that does not ask for one")}</label>
          <Field label={tr("Designação comercial (client)", "Trading name (client)")} ocr={ocr.client} hint={tr("Nome do restaurante, hotel, loja…", "Name of the restaurant, hotel, shop…")}><input className="in" value={f.client ?? ""} onChange={(e) => set("client", e.target.value)} /></Field>
          <Field label={tr("Denominação legal", "Legal name")} ocr={ocr.legal} hint={tr("Empresa que emite a fatura (Lda, S.A.…)", "Company issuing the invoice (Lda, S.A.…)")}><input className="in" value={f.details.legal ?? ""} onChange={(e) => setD("legal", e.target.value)} /></Field>
          <div className="row3">
            <Field label={tr("Com IVA", "Incl. VAT")} ocr={ocr.incl}><input className="in num" type="number" step="0.01" min="0" value={f.incl ?? ""} onChange={(e) => set("incl", numOrNull(e.target.value))} /></Field>
            <Field label={tr("Sem IVA", "Excl. VAT")} ocr={ocr.excl} hint={noVat ? tr("IVA = 0", "VAT = 0") : Number(f.excl) ? `${tr("IVA", "VAT")} ${eur(vat)} · ${rate.toFixed(0)} %` : undefined}><input className="in num" type="number" step="0.01" min="0" disabled={noVat} value={(noVat ? f.incl : f.excl) ?? ""} onChange={(e) => set("excl", numOrNull(e.target.value))} /></Field>
            <Field label={tr("Moeda", "Currency")}><select className="in" value={f.currency} onChange={(e) => set("currency", e.target.value as Currency)}><option>EUR</option><option>GBP</option></select></Field>
          </div>
          <label className="cb"><input type="checkbox" checked={noVat} onChange={(e) => setNoVat(e.target.checked)} /> {tr("O recibo não discrimina IVA", "The receipt does not show VAT separately")}</label>
          {f.currency !== "EUR" && <Field label={tr("Câmbio para EUR", "Exchange rate to EUR")} hint={tr("Taxa da data do recibo", "Rate on the receipt date")}><input className="in num" type="number" step="0.0001" value={f.rate} onChange={(e) => set("rate", Number(e.target.value))} /></Field>}
          <Field label={tr("Tipo de despesa", "Expense type")} hint={f.type ? TYPES[f.type].hint : tr("Escolha o tipo e depois a subcategoria", "Choose the type and then the subcategory")}>
            <Seg options={TYPE_KEYS.map((k) => ({ v: k, l: TYPES[k].short }))} value={f.type} onChange={(v) => setF((p) => { const t = v as ExpType; return { ...p, type: t, sub: p.sub && TYPES[t].subs.includes(p.sub) ? p.sub : null }; })} />
          </Field>
          {f.type && (
            <Field label={tr("Subcategoria (for accountancy)", "Subcategory (for accountancy)")} hint={f.sub === "Others travel expenses" ? tr("Só para estacionamento, metro, táxi, autocarro, portagens", "Only for parking, metro, taxi, bus, tolls") : undefined}>
              <div className="opts">{TYPES[f.type].subs.map((s) => <button type="button" key={s} className={f.sub === s ? "on" : ""} onClick={() => set("sub", s)}>{s}</button>)}</div>
              {sug && f.type && <div className="hint warn">“{f.client}” {tr("parece ser", "looks like")} {sug}. <button className="link-button" onClick={() => { const t = f.type; if (t) set("sub", TYPES[t].subs.find((x) => x.startsWith(sug)) ?? f.sub); }}>{tr("Mudar", "Change")}</button></div>}
            </Field>
          )}
          {schema.map((fl) => {
            if (fl.kind === "seg") return <Field key={fl.k} label={fl.label}><div className="opts">{(fl.options ?? []).map((o) => <button type="button" key={o} className={f.details[fl.k] === o ? "on" : ""} onClick={() => setD(fl.k as "kind", o)}>{optionLabel(o)}</button>)}</div></Field>;
            if (fl.kind === "int") return <Field key={fl.k} label={fl.label}><input className="in num" style={{ maxWidth: 120 }} type="number" min="1" value={f.details.people ?? ""} onChange={(e) => setD("people", e.target.value)} /></Field>;
            if (fl.kind === "people") return <People key={fl.k} list={f.details.participants ?? []} external={f.details.invite === "External"} onChange={(v) => setD("participants", v)} />;
            const val = f.details[fl.k];
            return <Field key={fl.k} label={fl.label}><input className="in" placeholder={fl.ph} value={typeof val === "string" ? val : ""} onChange={(e) => setD(fl.k as "motivo", e.target.value)} /></Field>;
          })}
          {f.sub === "Restaurants" && f.details.invite === "External" && <div className="hint warn">{tr("Escreva também no verso do recibo físico o nome e a empresa de cada participante externo.", "Also write the name and company of each external participant on the back of the paper receipt.")}</div>}
          {f.sub && <div className="preview"><span className="lab">{tr("Details que irá para o Excel", "Details that will go to the Excel")}</span>{detailText(f.sub, f.details)}</div>}
        </div>
      </div>
    </Modal>
  );
}

function People({ list, external, onChange }: { list: Participant[]; external: boolean; onChange: (v: Participant[]) => void }) {
  const upd = (i: number, k: keyof Participant, v: string) => onChange(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <Field label={`${tr("Participantes", "Participants")} · ${list.length}`} hint={external ? tr("Para externos indique a empresa", "For external participants enter the company") : tr("Nomes ou iniciais de todas as pessoas presentes", "Names or initials of everyone present")}>
      <div className="people">
        {list.map((p, i) => (
          <div key={i} className="prow">
            <input className="in" placeholder={tr("Nome", "Name")} value={p.name} onChange={(e) => upd(i, "name", e.target.value)} />
            <input className="in" placeholder={external ? tr("Empresa (externo)", "Company (external)") : tr("Empresa (se externo)", "Company (if external)")} value={p.company ?? ""} onChange={(e) => upd(i, "company", e.target.value)} />
            <button type="button" className="link-button" aria-label={tr("Remover", "Remove")} onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="link-button" onClick={() => onChange([...list, { name: "" }])}>{tr("+ Adicionar participante", "+ Add participant")}</button>
      </div>
    </Field>
  );
}
