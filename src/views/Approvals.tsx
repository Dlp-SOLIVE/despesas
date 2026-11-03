import { Fragment, useState } from "react";
import type { Claim, Line } from "../types";
import { decideClaim, docusignStart, receiptURL } from "../lib/data";
import { buildSigningPDF } from "../lib/export";
import { eur, fmtDate, num1, periodLabel } from "../lib/format";
import { ROLES, TYPES, claimChecklist, claimTotals, detailText, lineEUR, lineIssues, tripKm } from "../lib/rules";
import { Chip, Empty, Field, FilePreview, Kpis, PageHead, StatusChip, Thumb, Timeline, askConfirm, useApp, type AppCtx } from "../ui";
import { ClaimHeader, DownloadBtns, ruleCtx, vehicleFor } from "./common";

function canDecide(app: AppCtx, c: Claim): boolean {
  const role = app.me.role;
  if (c.staff_member_id === app.me.id && role !== "admin") return false;
  const owner = app.refs.people.find((p) => p.id === c.staff_member_id);
  if (c.status === "submitted") return owner?.manager_id === app.me.id;
  if (c.status === "approved_mgr") return role === "rh" || role === "admin";
  if (c.status === "validated_rh") return role === "contabilidade" || role === "admin";
  return false;
}
export function SignedDocs({ claim }: { claim: Claim }) {
  const app = useApp();
  const done = claim.signatures.filter((s) => s.status === "completed" && s.signed_path);
  if (!done.length) return null;
  const open = async (path: string) => {
    try {
      window.open(await receiptURL(path), "_blank", "noopener");
    } catch (e) {
      app.fail(e);
    }
  };
  return (
    <div style={{ marginTop: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Documentos assinados (DocuSign)</div>
      <div className="actions">
        {done.map((s) => (
          <button key={s.id} className="btn" onClick={() => s.signed_path && void open(s.signed_path)}>
            {s.step === "submitted" ? "Manager" : "RH"} · {app.refs.people.find((p) => p.id === s.signer_id)?.full_name ?? ""} · {fmtDate(s.completed_at)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function queueFor(app: AppCtx): Claim[] {
  return app.claims.filter((c) => canDecide(app, c));
}

export function ApprovalsView() {
  const app = useApp();
  const q = queueFor(app);
  const done = app.claims.filter((c) => !q.includes(c) && c.history.some((h) => h.actor_id === app.me.id && ["Aprovado", "Validado", "Lançado", "Devolvido"].includes(h.action)));
  const row = (c: Claim) => {
    const u = app.refs.people.find((p) => p.id === c.staff_member_id);
    const t = claimTotals(c, app.refs.settings);
    const ck = claimChecklist(c, { ...app.refs, today: app.today, vehicle: vehicleFor(app, c) });
    const w = ck.lineIssues.filter((x) => x.is.length).length;
    return (
      <tr key={c.id} className="click" onClick={() => app.go("review", c.id)}>
        <td><b className="w5">{u?.full_name ?? "—"}</b><div className="cat">{u?.matricula ?? ""}</div></td>
        <td>{periodLabel(c.period)}</td><td>{c.cost_center}</td><td className="num">{c.lines.length}</td><td className="num">{eur(t.total)}</td>
        <td>{w ? <Chip tone="warn">{w} linha{w > 1 ? "s" : ""} com alertas</Chip> : <Chip tone="ok">Sem alertas</Chip>}</td>
        <td><StatusChip status={c.status} /></td>
      </tr>
    );
  };
  const head = <thead><tr><th>Colaborador</th><th>Mês</th><th>Cost center</th><th className="num">Recibos</th><th className="num">Total</th><th>Conformidade</th><th>Estado</th></tr></thead>;
  return (
    <div className="app-body">
      <PageHead eyebrow={ROLES[app.me.role]} title={app.me.role === "contabilidade" ? "A lançar" : "Aprovações"} />
      {q.length ? <div className="tbl-wrap"><table>{head}<tbody>{q.map(row)}</tbody></table></div> : <Empty title="Nada pendente">Os pedidos que precisam da sua ação aparecem aqui.</Empty>}
      {done.length > 0 && <><div className="eyebrow" style={{ margin: "32px 0 8px" }}>Tratados por si</div><div className="tbl-wrap"><table>{head}<tbody>{done.map(row)}</tbody></table></div></>}
    </div>
  );
}

export function ReviewView() {
  const app = useApp();
  const claim = app.claims.find((c) => c.id === app.selId) ?? null;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const dsAvailable = app.refs.settings.docusign_enabled && app.me.docusign;
  const [ds, setDs] = useState(dsAvailable);
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<Line | null>(null);
  if (!claim) return <div className="app-body"><Empty title="Pedido não encontrado" action={<button className="btn" onClick={() => app.go("aprov")}>Voltar</button>} /></div>;
  const u = app.refs.people.find((p) => p.id === claim.staff_member_id);
  const t = claimTotals(claim, app.refs.settings);
  const rc = ruleCtx(app, claim);
  const act = canDecide(app, claim);
  const posting = claim.status === "validated_rh";
  const flagged = Object.keys(notes);
  const verb = claim.status === "submitted" ? "Aprovar" : claim.status === "approved_mgr" ? "Validar" : "Marcar como lançado";
  const veh = vehicleFor(app, claim);

  async function decide(action: "approve" | "return") {
    if (!claim) return;
    if (action === "approve" && !(await askConfirm(`${verb} o pedido de ${u?.full_name ?? ""} (${periodLabel(claim.period)}, ${eur(t.total)})?`))) return;
    setBusy(true);
    try {
      if (action === "approve" && ds && dsAvailable && !posting) {
        // Assinatura real: envelope DocuSign com a folha de aprovação + recibos; volta à plataforma no fim
        const stepLabel = claim.status === "submitted" ? "Aprovação do manager" : "Validação RH";
        const b64 = await buildSigningPDF(claim, app.refs, app.me, stepLabel);
        const { url, envelopeId } = await docusignStart(claim.id, b64, `${window.location.origin}/?ds=1`);
        window.sessionStorage.setItem("despesas_ds", JSON.stringify({ claim: claim.id, envelope: envelopeId, comment: comment.trim() }));
        window.location.href = url;
        return;
      }
      await decideClaim(claim.id, action, comment.trim(), Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim())), false);
      await app.reload();
      app.toast(action === "return" ? `Pedido devolvido a ${u?.full_name ?? ""}.` : `Pedido de ${u?.full_name ?? ""}: ${verb.toLowerCase()} ✓`);
      app.go("aprov", null);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-body">
      <div className="back"><button className="link-button" onClick={() => app.go(act ? "aprov" : "hist")}>← Voltar</button></div>
      <ClaimHeader claim={claim} eyebrow={`${u?.full_name ?? ""} · ${u?.matricula ?? ""}`} actions={<DownloadBtns claim={claim} />} />
      <Kpis t={t} />
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>No</th><th></th><th>Data</th><th>Despesa</th><th>Details</th><th>Client</th><th className="num">Incl. VAT</th><th>Conformidade</th>{act && !posting && <th></th>}</tr></thead>
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
                    <td>{l.client}{l.details?.legal && <div className="cat">{l.details.legal}</div>}<div className="cat">NIF {l.nif || "—"}</div></td>
                    <td className="num">{eur(lineEUR(l))}</td>
                    <td>{is.length ? is.map((i, k) => <div key={k}><Chip tone={i.lv}>{i.msg}</Chip></div>) : <Chip tone="ok">Conforme</Chip>}</td>
                    {act && !posting && <td><button className="link-button" onClick={() => setNotes((n) => { const x = { ...n }; if (fl) delete x[l.id]; else x[l.id] = ""; return x; })}>{fl ? "Retirar" : "Assinalar"}</button></td>}
                  </tr>
                  {fl && <tr className="flag"><td></td><td colSpan={8}><input className="in" autoFocus placeholder="O que deve ser corrigido nesta linha?" value={notes[l.id]} onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {claim.trips.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "28px 0 8px" }}>Quilómetros · {num1(t.km)} km · {veh?.model ?? "viatura por indicar"} {veh?.plate ?? ""} · seguro {claim.insurance_declared ? "declarado" : "não declarado"}</div>
          <div className="tbl-wrap"><table><tbody>
            {[...claim.trips].sort((a, b) => a.trip_date.localeCompare(b.trip_date)).map((tr) => (
              <tr key={tr.id}><td className="nw">{fmtDate(tr.trip_date)}</td><td>{tr.origin} → {tr.dest}{tr.round_trip ? " ⇄" : ""}</td><td>{tr.purpose}</td><td className="num">{num1(tripKm(tr))} km</td><td className="num">{eur(tripKm(tr) * t.kmRate)}</td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
      <div style={{ marginTop: 28 }}><div className="eyebrow" style={{ marginBottom: 8 }}>Histórico</div><Timeline claim={claim} people={app.refs.people} /></div>
      <SignedDocs claim={claim} />
      {act && (
        <div className="decide">
          <Field label={posting ? "Nota (opcional)" : "Comentário"} hint={posting ? "Depois de lançado, só o administrador pode reabrir." : flagged.length ? `${flagged.length} linha(s) assinalada(s)` : "Obrigatório para devolver"}>
            <textarea className="in" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={posting ? "ex.: lançado no lote de novembro" : "ex.: falta a lista de participantes no jantar de dia 5"} />
          </Field>
          <div className="decide-row">
            {!posting && dsAvailable && <label className="cb"><input type="checkbox" checked={ds} onChange={(e) => setDs(e.target.checked)} /> Assinar com DocuSign <span className="muted">(abre a DocuSign e volta aqui)</span></label>}
            <span className="push"></span>
            <button className="btn" disabled={busy || !comment.trim()} onClick={() => void decide("return")}>Devolver ao colaborador</button>
            <button className="btn primary" disabled={busy || flagged.length > 0} onClick={() => void decide("approve")}>{verb}</button>
          </div>
          {flagged.length > 0 && <div className="hint warn">Com linhas assinaladas só é possível devolver.</div>}
        </div>
      )}
      {prev && prev.file_path && <FilePreview path={prev.file_path} type={prev.file_type} onClose={() => setPrev(null)} />}
    </div>
  );
}
