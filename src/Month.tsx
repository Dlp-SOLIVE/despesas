import { useRef, useState } from "react";
import type { Line } from "../types";
import { deleteLine, saveLine, uploadReceipt, type LineInput } from "../lib/data";
import { readReceiptLocally } from "../lib/localOcr";
import { fmtDate, periodLabel, periodOf } from "../lib/format";
import { TYPES, claimChecklist, claimTotals, detailText, lineEUR, lineIssues } from "../lib/rules";
import { Chip, Empty, FilePreview, Kpis, Thumb, Timeline, askConfirm, useApp } from "../ui";
import { ClaimHeader, DownloadBtns, NewClaimModal, canEdit, myClaim, ruleCtx, vehicleFor } from "./common";
import { ReceiptModal, applyRead, blankLine } from "./Receipt";
import { SubmitModal } from "./Submit";

export function MonthView() {
  const app = useApp();
  const claim = myClaim(app);
  const [edit, setEdit] = useState<Line | "new" | null>(null);
  const [prev, setPrev] = useState<Line | null>(null);
  const [submit, setSubmit] = useState(false);
  const [nc, setNc] = useState(false);
  const [bulk, setBulk] = useState<string | null>(null);
  const multiRef = useRef<HTMLInputElement>(null);
  const period = periodOf(app.today);
  const s = app.refs.settings;

  if (!claim)
    return (
      <div className="app-body">
        <Empty title={`Ainda não tem pedido para ${periodLabel(period).toLowerCase()}`} action={<button className="btn primary" onClick={() => setNc(true)}>Iniciar pedido</button>}>
          Registe os recibos ao longo do mês. A submissão abre a dia {s.open_day}.
        </Empty>
        {nc && <NewClaimModal period={period} onClose={() => setNc(false)} />}
      </div>
    );

  const ed = canEdit(app, claim);
  const rc = ruleCtx(app, claim);
  const t = claimTotals(claim, s);
  const ck = claimChecklist(claim, { ...app.refs, today: app.today, vehicle: vehicleFor(app, claim) });
  const pending = ck.items.filter((i) => !i.ok).length;
  const errLines = ck.lineIssues.filter((x) => x.is.some((i) => i.lv === "err")).length;
  const lastReturn = [...claim.history].reverse().find((h) => h.action === "Devolvido");

  // Vários recibos de uma vez: cada ficheiro vira um recibo, lido automaticamente; o colaborador completa depois
  async function addMany(list: FileList | null) {
    if (!claim || !list || !list.length) return;
    const free = s.max_lines - claim.lines.length;
    const files = [...list].slice(0, free);
    if (list.length > free) app.toast(`Só cabem mais ${free} recibos neste pedido (máximo ${s.max_lines}). Os restantes não foram carregados.`, "err");
    const big = files.filter((f) => f.size > 10 * 1024 * 1024);
    let no = claim.lines.length;
    let ok = 0;
    for (const [i, file] of files.entries()) {
      if (big.includes(file)) continue;
      setBulk(`A ler recibo ${i + 1} de ${files.length}…`);
      try {
        const up = await uploadReceipt(file, app.me.id, claim.id);
        let line: LineInput = { ...blankLine(++no), file_path: up.path, file_type: up.type };
        try {
          const r = await readReceiptLocally(file, up.type, () => undefined);
          if (r.source !== "nenhum") line = applyRead(line, r, app.claims);
        } catch {
          // fica para preencher à mão
        }
        await saveLine(claim.id, line);
        ok++;
      } catch (e) {
        app.fail(e);
      }
    }
    setBulk(null);
    if (multiRef.current) multiRef.current.value = "";
    await app.reload();
    app.log(`Carregou ${ok} recibos · ${claim.cost_center} ${claim.period}`);
    app.toast(`${ok} recibo(s) adicionados${big.length ? ` · ${big.length} acima de 10 MB ignorado(s)` : ""}. Abra cada um para confirmar e completar (tipo, Details).`);
  }

  async function del(l: Line) {
    if (!claim || !(await askConfirm(`Apagar o recibo nº ${l.no}? A imagem também é apagada.`))) return;
    try {
      await deleteLine(claim, l);
      app.log(`Apagou recibo ${l.no} · ${claim.cost_center} ${claim.period}`);
      await app.reload();
    } catch (e) {
      app.fail(e);
    }
  }

  return (
    <div className="app-body">
      <ClaimHeader claim={claim} eyebrow="Pedido de reembolso" actions={ed ? (
        <>
          {claim.period === period && <button className="btn" onClick={() => setNc(true)}>Outro cost center</button>}
          {(app.me.uses_km || claim.trips.length > 0) && <button className="btn" onClick={() => app.go("km", claim.id)}>Quilómetros</button>}
          <button className="btn" disabled={!!bulk || claim.lines.length >= s.max_lines} onClick={() => multiRef.current?.click()}>{bulk ?? "Carregar vários"}</button>
          <input ref={multiRef} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => void addMany(e.target.files)} />
          <button className="btn primary" disabled={!!bulk || claim.lines.length >= s.max_lines} onClick={() => setEdit("new")}>Adicionar recibo</button>
        </>
      ) : undefined} />
      {claim.status === "returned" && (
        <div className="notice err-n"><Chip tone="err">Devolvido</Chip><span><b>{lastReturn?.comment}</b> As linhas assinaladas têm um comentário do aprovador.</span></div>
      )}
      {ed && (
        <div className="notice">
          <Chip tone={ck.ready ? "ok" : "info"}>{claim.status === "returned" ? "A corrigir" : "Rascunho"}</Chip>
          <span>{ck.ready ? <>Tudo conforme. <b>Pode submeter.</b></> : <>Faltam resolver <b>{pending} ponto{pending === 1 ? "" : "s"}</b> da checklist{errLines ? <>, incluindo {errLines} recibo{errLines === 1 ? "" : "s"} com erros</> : null}.</>}</span>
          <span className="push"><button className="btn dark" onClick={() => setSubmit(true)}>Rever e submeter</button></span>
        </div>
      )}
      {!ed && (
        <div className="notice"><span>Pedido fechado para edição. {claim.status === "posted" ? "Lançado pela contabilidade." : "Em aprovação."}</span><span className="push actions"><DownloadBtns claim={claim} /></span></div>
      )}
      <Kpis t={t} />
      {claim.lines.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>No</th><th></th><th>Data</th><th>Despesa</th><th>Details</th><th>Client</th><th className="num">Incl. VAT</th><th>Estado</th>{ed && <th></th>}</tr></thead>
            <tbody>
              {claim.lines.map((l) => {
                const is = lineIssues(l, rc);
                const e = is.find((i) => i.lv === "err");
                const w = is.find((i) => i.lv === "warn");
                const all = is.map((i) => i.msg).join("\n");
                return (
                  <tr key={l.id} className={ed ? "click" : ""} onClick={() => ed && setEdit(l)}>
                    <td>{l.no}</td>
                    <td onClick={(ev) => ev.stopPropagation()}><Thumb path={l.file_path} type={l.file_type} onClick={() => setPrev(l)} /></td>
                    <td className="nw">{fmtDate(l.receipt_date)}</td>
                    <td>{l.sub ?? <span className="muted">—</span>}<div className="cat">{l.type ? TYPES[l.type].label : ""}</div></td>
                    <td className="wide">{detailText(l.sub, l.details)}{l.approver_note && <div className="note-line">Aprovador: {l.approver_note}</div>}</td>
                    <td>{l.client}{l.details?.legal && <div className="cat">{l.details.legal}</div>}</td>
                    <td className="num">{lineEUR(l).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €{l.currency !== "EUR" && <div className="cat">{l.incl} {l.currency}</div>}</td>
                    <td>{e ? <Chip tone="err" title={all}>{e.msg}</Chip> : w ? <Chip tone="warn" title={all}>{w.msg}</Chip> : <Chip tone="ok">Conforme</Chip>}{is.length > 1 && <div className="cat">+{is.length - 1} alerta{is.length > 2 ? "s" : ""}</div>}</td>
                    {ed && <td><button className="link-button" onClick={(ev) => { ev.stopPropagation(); void del(l); }}>Apagar</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sem recibos neste pedido" action={ed ? <button className="btn primary" onClick={() => setEdit("new")}>Adicionar o primeiro recibo</button> : undefined}>
          Fotografe cada recibo no momento da despesa. A numeração é automática.
        </Empty>
      )}
      {claim.history.length > 0 && (
        <div style={{ marginTop: 32 }}><div className="eyebrow" style={{ marginBottom: 8 }}>Histórico do pedido</div><Timeline claim={claim} people={app.refs.people} /></div>
      )}
      {edit && <ReceiptModal claim={claim} line={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {prev && prev.file_path && <FilePreview path={prev.file_path} type={prev.file_type} onClose={() => setPrev(null)} />}
      {submit && <SubmitModal claim={claim} onClose={() => setSubmit(false)} />}
      {nc && <NewClaimModal period={period} onClose={() => setNc(false)} />}
    </div>
  );
}
