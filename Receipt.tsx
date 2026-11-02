import { useEffect, useRef, useState } from "react";
import type { Claim, Currency, Details, ExpType, Line, Participant } from "../types";
import { downloadReceipt, receiptURL, saveLine, uploadReceipt, type LineInput } from "../lib/data";
import { readReceiptLocally } from "../lib/localOcr";
import { eur } from "../lib/format";
import { TYPES, TYPE_KEYS, detailSchema, detailText, lineIssues, suggestSub } from "../lib/rules";
import { Field, Modal, Seg, useApp } from "../ui";
import { ruleCtx } from "./common";

type OcrFlags = Partial<Record<"date" | "client" | "nif" | "excl" | "incl", boolean>>;

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

  useEffect(() => {
    if (f.file_path && f.file_type !== "application/pdf") receiptURL(f.file_path).then(setUrl).catch(() => setUrl(null));
    else setUrl(null);
  }, [f.file_path, f.file_type]);

  const set = <K extends keyof LineInput>(k: K, v: LineInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const setD = <K extends keyof Details>(k: K, v: Details[K]) => setF((p) => ({ ...p, details: { ...p.details, [k]: v } }));
  const numOrNull = (s: string) => (s === "" ? null : Number(s));

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return app.toast("Ficheiro acima de 10 MB. Reduza a resolução da fotografia.", "err");
    setBusy("up");
    try {
      const up = await uploadReceipt(file, app.me.id, claim.id);
      blobRef.current = file;
      setF((p) => ({ ...p, file_path: up.path, file_type: up.type }));
      setOcr({});
      void read(file, up.type);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy("");
    }
  }

  async function read(fileArg?: Blob, typeArg?: string) {
    const path = f.file_path;
    if (!fileArg && !path) return;
    setBusy("ocr");
    setProgress("A preparar…");
    try {
      const blob = fileArg ?? blobRef.current ?? (path ? await downloadReceipt(path) : null);
      if (!blob) return;
      blobRef.current = blob;
      const r = await readReceiptLocally(blob, typeArg ?? f.file_type ?? blob.type, setProgress);
      if (r.source === "nenhum") {
        app.toast("Não foi possível ler este recibo. Preencha os campos à mão.", "err");
        return;
      }
      const flags: OcrFlags = {
        date: !!(r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)),
        client: !!r.client,
        nif: !!r.nif_buyer,
        incl: typeof r.total_incl === "number",
        excl: typeof r.total_excl === "number",
      };
      setF((p) => {
        const n: LineInput = { ...p, details: { ...p.details }, ocr: r as Record<string, unknown> };
        if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) n.receipt_date = r.date;
        if (r.client && (!p.client || !p.client.trim())) n.client = r.client;
        if (r.nif_buyer) n.nif = r.nif_buyer;
        if (typeof r.total_incl === "number") n.incl = r.total_incl;
        if (typeof r.total_excl === "number") n.excl = r.total_excl;
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
      });
      if (r.vat_breakdown === false) setNoVat(true);
      else if (r.vat_breakdown === true) setNoVat(false);
      setOcr(flags);
      app.toast(r.source === "qr" ? "Dados lidos do código QR da fatura. Confirme a entidade e complete os Details." : "Texto lido (sem código QR). Confirme data, valores e IVA.");
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
    setBusy("save");
    try {
      await saveLine(claim.id, { ...f, id: line?.id, excl: noVat ? f.incl : f.excl });
      app.log(`${line ? "Editou" : "Adicionou"} recibo ${f.no} · ${claim.cost_center} ${claim.period}`);
      await app.reload();
      app.toast(errs ? `Recibo nº ${f.no} guardado com ${errs} erro(s) a corrigir antes de submeter.` : `Recibo nº ${f.no} guardado.`);
      onClose();
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal wide title={`${line ? "Editar" : "Novo"} recibo · nº ${f.no}`} onClose={onClose} footer={
      <>
        <span className="muted push-left">{errs ? `${errs} erro(s): pode guardar, mas não submeter` : "Recibo conforme"}</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "A guardar…" : "Guardar recibo"}</button>
      </>
    }>
      <div className="rc-grid">
        <div>
          <div className={f.file_path ? "drop has" : "drop"} role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
            <span className="no">{f.no}</span>
            {busy === "up" ? <span className="muted">A carregar…</span> : f.file_path ? (url ? <img src={url} alt="Recibo" /> : <span><b>PDF anexado</b><br /><span className="muted">Clique para substituir</span></span>) : <span><b>Fotografar ou carregar recibo</b><br /><span className="muted">Imagem ou PDF · arraste para aqui</span></span>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          <div className="ocr-bar">
            <button className="btn dark" disabled={!f.file_path || !!busy} onClick={() => void read()}>{busy === "ocr" ? progress || "A ler recibo…" : "Ler recibo novamente"}</button>
            <span className="muted">Lido automaticamente ao carregar: código QR das faturas portuguesas (dados exatos) ou texto do recibo. Tudo no seu computador; nada é enviado para serviços externos. Todos os campos podem ser corrigidos à mão.</span>
          </div>
          <div className="issues">{issues.length ? issues.map((i, k) => <div key={k} className={i.lv}>{i.msg}</div>) : <div className="ok">Sem alertas</div>}</div>
        </div>
        <div className="form">
          <div className="row2">
            <Field label="Data do recibo" ocr={ocr.date} hint="A data que aparece no recibo"><input className="in" type="date" max={app.today} value={f.receipt_date ?? ""} onChange={(e) => set("receipt_date", e.target.value || null)} /></Field>
            <Field label="NIF no recibo" ocr={ocr.nif} hint={rc.company ? `Deve ser ${rc.company.nif}` : undefined}><input className="in" value={f.nif ?? ""} placeholder="NIF do adquirente" onChange={(e) => set("nif", e.target.value)} /></Field>
          </div>
          <Field label="Entidade (client)" ocr={ocr.client} hint="Restaurante, hotel, companhia aérea…"><input className="in" value={f.client ?? ""} onChange={(e) => set("client", e.target.value)} /></Field>
          <div className="row3">
            <Field label="Com IVA" ocr={ocr.incl}><input className="in num" type="number" step="0.01" min="0" value={f.incl ?? ""} onChange={(e) => set("incl", numOrNull(e.target.value))} /></Field>
            <Field label="Sem IVA" ocr={ocr.excl} hint={noVat ? "IVA = 0" : Number(f.excl) ? `IVA ${eur(vat)} · ${rate.toFixed(0)} %` : undefined}><input className="in num" type="number" step="0.01" min="0" disabled={noVat} value={(noVat ? f.incl : f.excl) ?? ""} onChange={(e) => set("excl", numOrNull(e.target.value))} /></Field>
            <Field label="Moeda"><select className="in" value={f.currency} onChange={(e) => set("currency", e.target.value as Currency)}><option>EUR</option><option>GBP</option></select></Field>
          </div>
          <label className="cb"><input type="checkbox" checked={noVat} onChange={(e) => setNoVat(e.target.checked)} /> O recibo não discrimina IVA</label>
          {f.currency !== "EUR" && <Field label="Câmbio para EUR" hint="Taxa da data do recibo"><input className="in num" type="number" step="0.0001" value={f.rate} onChange={(e) => set("rate", Number(e.target.value))} /></Field>}
          <Field label="Tipo de despesa" hint={f.type ? TYPES[f.type].hint : "Escolha o tipo e depois a subcategoria"}>
            <Seg options={TYPE_KEYS.map((k) => ({ v: k, l: TYPES[k].short }))} value={f.type} onChange={(v) => setF((p) => { const t = v as ExpType; return { ...p, type: t, sub: p.sub && TYPES[t].subs.includes(p.sub) ? p.sub : null }; })} />
          </Field>
          {f.type && (
            <Field label="Subcategoria (for accountancy)" hint={f.sub === "Others travel expenses" ? "Só para estacionamento, metro, táxi, autocarro, portagens" : undefined}>
              <div className="opts">{TYPES[f.type].subs.map((s) => <button type="button" key={s} className={f.sub === s ? "on" : ""} onClick={() => set("sub", s)}>{s}</button>)}</div>
              {sug && f.type && <div className="hint warn">“{f.client}” parece ser {sug}. <button className="link-button" onClick={() => { const t = f.type; if (t) set("sub", TYPES[t].subs.find((x) => x.startsWith(sug)) ?? f.sub); }}>Mudar</button></div>}
            </Field>
          )}
          {schema.map((fl) => {
            if (fl.kind === "seg") return <Field key={fl.k} label={fl.label}><div className="opts">{(fl.options ?? []).map((o) => <button type="button" key={o} className={f.details[fl.k] === o ? "on" : ""} onClick={() => setD(fl.k as "kind", o)}>{o}</button>)}</div></Field>;
            if (fl.kind === "int") return <Field key={fl.k} label={fl.label}><input className="in num" style={{ maxWidth: 120 }} type="number" min="1" value={f.details.people ?? ""} onChange={(e) => setD("people", e.target.value)} /></Field>;
            if (fl.kind === "people") return <People key={fl.k} list={f.details.participants ?? []} external={f.details.invite === "External"} onChange={(v) => setD("participants", v)} />;
            const val = f.details[fl.k];
            return <Field key={fl.k} label={fl.label}><input className="in" placeholder={fl.ph} value={typeof val === "string" ? val : ""} onChange={(e) => setD(fl.k as "motivo", e.target.value)} /></Field>;
          })}
          {f.sub === "Restaurants" && f.details.invite === "External" && <div className="hint warn">Escreva também no verso do recibo físico o nome e a empresa de cada participante externo.</div>}
          {f.sub && <div className="preview"><span className="lab">Details que irá para o Excel</span>{detailText(f.sub, f.details)}</div>}
        </div>
      </div>
    </Modal>
  );
}

function People({ list, external, onChange }: { list: Participant[]; external: boolean; onChange: (v: Participant[]) => void }) {
  const upd = (i: number, k: keyof Participant, v: string) => onChange(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <Field label={`Participantes · ${list.length}`} hint={external ? "Para externos indique a empresa" : "Nomes ou iniciais de todas as pessoas presentes"}>
      <div className="people">
        {list.map((p, i) => (
          <div key={i} className="prow">
            <input className="in" placeholder="Nome" value={p.name} onChange={(e) => upd(i, "name", e.target.value)} />
            <input className="in" placeholder={external ? "Empresa (externo)" : "Empresa (se externo)"} value={p.company ?? ""} onChange={(e) => upd(i, "company", e.target.value)} />
            <button type="button" className="link-button" aria-label="Remover" onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="link-button" onClick={() => onChange([...list, { name: "" }])}>+ Adicionar participante</button>
      </div>
    </Field>
  );
}
