import { Fragment, useState } from "react";
import type { Claim, Line } from "../types";
import { decideClaim } from "../lib/data";
import { eur, fmtDate, num1, periodLabel } from "../lib/format";
import { ROLES, TYPES, claimChecklist, claimTotals, detailText, lineEUR, lineIssues, tripKm } from "../lib/rules";
import { Chip, Empty, Field, FilePreview, Kpis, PageHead, StatusChip, Thumb, Timeline, askConfirm, useApp, type AppCtx } from "../ui";
import { ClaimHeader, DownloadBtns, ruleCtx, vehicleFor } from "./common";
import { tr } from "../lib/i18n";

function canDecide(app: AppCtx, c: Claim): boolean {
  const role = app.me.role;
  if (c.staff_member_id === app.me.id && role !== "admin") return false;
  const owner = app.refs.people.find((p) => p.id === c.staff_member_id);
  if (c.status === "submitted") return owner?.manager_id === app.me.id;
  if (c.status === "approved_mgr") return role === "rh" || role === "admin";
  if (c.status === "validated_rh") return role === "contabilidade" || role === "admin";
  return false;
}
export function queueFor(app: AppCtx): Claim[] {
  return app.claims.filter((c) => canDecide(app, c));
}

export function ApprovalsView() {
  const app = useApp();
  const q = queueFor(app);
  // RH e Administrativo acompanham os pedidos desde a submissão
  const aware = ["rh", "contabilidade", "admin"].includes(app.me.role) ? app.claims.filter((c) => c.status === "submitted" && !q.includes(c)) : [];
  const done = app.claims.filter((c) => !q.includes(c) && c.history.some((h) => h.actor_id === app.me.id && ["Aprovado", "Validado", "Registado RH", "Lançado", "Pago", "Devolvido"].includes(h.action)));
  const row = (c: Claim) => {
    const u = app.refs.people.find((p) => p.id === c.staff_member_id);
    const t = claimTotals(c, app.refs.settings);
    const ck = claimChecklist(c, { ...app.refs, today: app.today, vehicle: vehicleFor(app, c) });
    const w = ck.lineIssues.filter((x) => x.is.length).length;
    return (
      <tr key={c.id} className="click" onClick={() => app.go("review", c.id)}>
        <td><b className="w5">{u?.full_name ?? "—"}</b><div className="cat">{u?.matricula ?? ""}</div></td>
        <td>{periodLabel(c.period)}</td><td>{c.cost_center}</td><td className="num">{c.lines.length}</td><td className="num">{eur(t.total)}</td>
        <td>{w ? <Chip tone="warn">{w} {tr("linha", "line")}{w > 1 ? "s" : ""} {tr("com alertas", "with alerts")}</Chip> : <Chip tone="ok">{tr("Sem alertas", "No alerts")}</Chip>}</td>
        <td><StatusChip status={c.status} /></td>
      </tr>
    );
  };
  const head = <thead><tr><th>{tr("Colaborador", "Employee")}</th><th>{tr("Mês", "Month")}</th><th>Cost center</th><th className="num">{tr("Recibos", "Receipts")}</th><th className="num">Total</th><th>{tr("Conformidade", "Compliance")}</th><th>{tr("Estado", "Status")}</th></tr></thead>;
  return (
    <div className="app-body">
      <PageHead eyebrow={ROLES[app.me.role]} title={app.me.role === "contabilidade" ? tr("Pagamentos", "Payments") : tr("Aprovações", "Approvals")} />
      {q.length ? <div className="tbl-wrap"><table>{head}<tbody>{q.map(row)}</tbody></table></div> : <Empty title={tr("Nada pendente", "Nothing pending")}>{tr("Os pedidos que precisam da sua ação aparecem aqui.", "Claims that need your action appear here.")}</Empty>}
      {aware.length > 0 && <><div className="eyebrow" style={{ margin: "32px 0 8px" }}>{tr("Para conhecimento · em aprovação pelo manager", "For information · awaiting manager approval")}</div><div className="tbl-wrap"><table>{head}<tbody>{aware.map(row)}</tbody></table></div></>}
      {done.length > 0 && <><div className="eyebrow" style={{ margin: "32px 0 8px" }}>{tr("Tratados por si", "Handled by you")}</div><div className="tbl-wrap"><table>{head}<tbody>{done.map(row)}</tbody></table></div></>}
    </div>
  );
}

export function ReviewView() {
  const app = useApp();
  const claim = app.claims.find((c) => c.id === app.selId) ?? null;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<Line | null>(null);
  if (!claim) return <div className="app-body"><Empty title={tr("Pedido não encontrado", "Claim not found")} action={<button className="btn" onClick={() => app.go("aprov")}>{tr("Voltar", "Back")}</button>} /></div>;
  const u = app.refs.people.find((p) => p.id === claim.staff_member_id);
  const t = claimTotals(claim, app.refs.settings);
  const rc = ruleCtx(app, claim);
  const act = canDecide(app, claim);
  const posting = claim.status === "validated_rh";
  const flagged = Object.keys(notes);
  const verb = claim.status === "submitted" ? tr("Aprovar", "Approve") : claim.status === "approved_mgr" ? tr("Registar (RH)", "Record (HR)") : tr("Registar pagamento", "Record payment");
  const [paidOn, setPaidOn] = useState(app.today);
  const [payRef, setPayRef] = useState("");
  const veh = vehicleFor(app, claim);

  async function decide(action: "approve" | "return") {
    if (!claim) return;
    if (action === "approve" && posting && !paidOn) return app.toast(tr("Indique a data do pagamento.", "Enter the payment date."), "err");
    if (action === "approve" && !(await askConfirm(tr(`${verb} · pedido de ${u?.full_name ?? ""} (${periodLabel(claim.period)}, ${eur(t.total)})?`, `${verb} · claim from ${u?.full_name ?? ""} (${periodLabel(claim.period)}, ${eur(t.total)})?`)))) return;
    setBusy(true);
    try {
      await decideClaim(claim.id, action, comment.trim(), Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim())), posting ? { paidOn, ref: payRef.trim() } : undefined);
      await app.reload();
      app.toast(action === "return" ? tr(`Pedido devolvido a ${u?.full_name ?? ""}.`, `Claim returned to ${u?.full_name ?? ""}.`) : tr(`Pedido de ${u?.full_name ?? ""}: ${verb.toLowerCase()} ✓`, `Claim from ${u?.full_name ?? ""}: ${verb.toLowerCase()} ✓`));
      app.go("aprov", null);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-body">
      <div className="back"><button className="link-button" onClick={() => app.go(act ? "aprov" : "hist")}>← {tr("Voltar", "Back")}</button></div>
      <ClaimHeader claim={claim} eyebrow={`${u?.full_name ?? ""} · ${u?.matricula ?? ""}`} actions={<DownloadBtns claim={claim} />} />
      <Kpis t={t} />
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>No</th><th></th><th>{tr("Data", "Date")}</th><th>{tr("Despesa", "Expense")}</th><th>Details</th><th>Client</th><th className="num">Incl. VAT</th><th>{tr("Conformidade", "Compliance")}</th>{act && !posting && <th></th>}</tr></thead>
          <tbody>
            {claim.lines.map((l) => {
              const is = lineIssues(l, rc);
              const fl = notes[l.id] !== undefined;
              return (
                <Fragment key={l.id}>
                  <tr className={fl ? "flag" : ""}>
                    <td>{l.no}</td><td><Thumb path={l.file_path} type={l.file_type} onClick={() => setPrev(l)} /></td><td className="nw">{fmtDate(l.receipt_date)}</td>
                    <td>{l.sub}<div className="cat">{l.type ? TYPES[l.type].label : ""}</div></td>
                    <td className="wide">{detailText(l.sub, l.details)}</td>
                    <td>{l.client}{l.details?.legal && <div className="cat">{l.details.legal}</div>}<div className="cat">{tr("NIF", "VAT no.")} {l.nif || "—"}</div></td>
                    <td className="num">{eur(lineEUR(l))}</td>
                    <td>{is.length ? is.map((i, k) => <div key={k}><Chip tone={i.lv}>{i.msg}</Chip></div>) : <Chip tone="ok">{tr("Conforme", "Compliant")}</Chip>}</td>
                    {act && !posting && <td><button className="link-button" onClick={() => setNotes((n) => { const x = { ...n }; if (fl) delete x[l.id]; else x[l.id] = ""; return x; })}>{fl ? tr("Retirar", "Unflag") : tr("Assinalar", "Flag")}</button></td>}
                  </tr>
                  {fl && <tr className="flag"><td></td><td colSpan={8}><input className="in" autoFocus placeholder={tr("O que deve ser corrigido nesta linha?", "What must be corrected on this line?")} value={notes[l.id]} onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {claim.trips.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "28px 0 8px" }}>{tr("Quilómetros", "Mileage")} · {num1(t.km)} km · {veh?.model ?? tr("viatura por indicar", "vehicle not specified")} {veh?.plate ?? ""} · {claim.insurance_declared ? tr("seguro declarado", "insurance declared") : tr("seguro não declarado", "insurance not declared")}</div>
          <div className="tbl-wrap"><table><tbody>
            {[...claim.trips].sort((a, b) => a.trip_date.localeCompare(b.trip_date)).map((tp) => (
              <tr key={tp.id}><td className="nw">{fmtDate(tp.trip_date)}</td><td>{tp.origin} → {tp.dest}{tp.round_trip ? " ⇄" : ""}</td><td>{tp.purpose}</td><td className="num">{num1(tripKm(tp))} km</td><td className="num">{eur(tripKm(tp) * t.kmRate)}</td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
      <div style={{ marginTop: 28 }}><div className="eyebrow" style={{ marginBottom: 8 }}>{tr("Histórico", "History")}</div><Timeline claim={claim} people={app.refs.people} /></div>
      {act && (
        <div className="decide">
          {posting && (
            <div className="row2">
              <Field label={tr("Data do pagamento", "Payment date")}><input className="in" type="date" max={app.today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label={tr("Referência (opcional)", "Reference (optional)")} hint={tr("ex.: transferência, lote de pagamentos", "e.g. transfer, payment batch")}><input className="in" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={tr("Transferência 12/11", "Transfer 12/11")} /></Field>
            </div>
          )}
          <Field label={posting ? tr("Nota (opcional)", "Note (optional)") : tr("Comentário", "Comment")} hint={posting ? tr("Depois de registado o pagamento, só o administrador pode reabrir.", "Once the payment is recorded, only the administrator can reopen it.") : flagged.length ? tr(`${flagged.length} linha(s) assinalada(s)`, `${flagged.length} line(s) flagged`) : tr("Obrigatório para devolver", "Required to return")}>
            <textarea className="in" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={posting ? tr("ex.: pago no lote de novembro", "e.g. paid in the November batch") : tr("ex.: falta a lista de participantes no jantar de dia 5", "e.g. participant list missing for the dinner on the 5th")} />
          </Field>
          <div className="decide-row">
            <span className="push"></span>
            <button className="btn" disabled={busy || !comment.trim()} onClick={() => void decide("return")}>{tr("Devolver ao colaborador", "Return to employee")}</button>
            <button className="btn primary" disabled={busy || flagged.length > 0} onClick={() => void decide("approve")}>{verb}</button>
          </div>
          {flagged.length > 0 && <div className="hint warn">{tr("Com linhas assinaladas só é possível devolver.", "With flagged lines you can only return the claim.")}</div>}
        </div>
      )}
      {prev && prev.file_path && <FilePreview path={prev.file_path} type={prev.file_type} onClose={() => setPrev(null)} />}
    </div>
  );
}
