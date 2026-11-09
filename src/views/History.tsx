import { useState } from "react";
import { updateProfile } from "../lib/data";
import { eur, num1, periodLabel } from "../lib/format";
import { ROLES, claimTotals } from "../lib/rules";
import { Empty, Field, PageHead, StatusChip, useApp } from "../ui";
import { tr } from "../lib/i18n";

export function HistoryView() {
  const app = useApp();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const others = app.claims.some((c) => c.staff_member_id !== app.me.id);
  const list = app.claims.filter((c) => scope === "all" || c.staff_member_id === app.me.id);
  const name = (id: string) => app.refs.people.find((p) => p.id === id)?.full_name ?? "—";
  return (
    <div className="app-body">
      <PageHead eyebrow={scope === "all" ? tr("Pedidos visíveis para si", "Claims visible to you") : tr("Os meus pedidos", "My claims")} title={tr("Histórico", "History")} actions={others ? (
        <div className="seg" style={{ gridTemplateColumns: "1fr 1fr", minWidth: 220 }}>
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>{tr("Os meus", "Mine")}</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>{tr("Todos", "All")}</button>
        </div>
      ) : undefined} />
      {list.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr("Mês", "Month")}</th>{scope === "all" && <th>{tr("Colaborador", "Employee")}</th>}<th>Cost center</th><th className="num">{tr("Recibos", "Receipts")}</th><th className="num">Km</th><th className="num">Total</th><th>{tr("Estado", "Status")}</th></tr></thead>
            <tbody>
              {list.map((c) => {
                const t = claimTotals(c, app.refs.settings);
                return (
                  <tr key={c.id} className="click" onClick={() => app.go(c.staff_member_id === app.me.id ? "mes" : "review", c.id)}>
                    <td>{periodLabel(c.period)}</td>{scope === "all" && <td>{name(c.staff_member_id)}</td>}<td>{c.cost_center}</td>
                    <td className="num">{c.lines.length}</td><td className="num">{num1(t.km)}</td><td className="num">{eur(t.total)}</td><td><StatusChip status={c.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={tr("Ainda sem pedidos", "No claims yet")} />
      )}
    </div>
  );
}

export function ProfileView() {
  const app = useApp();
  const me = app.me;
  const co = app.refs.companies.find((c) => c.id === me.company_id);
  const mgr = app.refs.people.find((p) => p.id === me.manager_id);
  const [mat, setMat] = useState(me.matricula ?? "");
  const [busy, setBusy] = useState(false);
  async function patch(p: Parameters<typeof updateProfile>[1], msg: string) {
    setBusy(true);
    try {
      await updateProfile(me.id, p);
      app.log(`Atualizou o perfil: ${Object.keys(p).join(", ")}`);
      await app.reload();
      app.toast(msg);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-body">
      <PageHead eyebrow={tr("Perfil", "Profile")} title={me.full_name} pills={<><span className="pill">{me.matricula ?? tr("Sem matrícula", "No employee number")}</span><span className="pill">{ROLES[me.role]}</span></>} />
      <div className="grid3">
        <div>
          <div className="k">{tr("Dados", "Details")}</div>
          <p>{me.email}<br />{co?.name ?? tr("Empresa por definir", "Company not set")}<br />Manager: {mgr?.full_name ?? tr("por atribuir", "not assigned")}</p>
          <Field label={tr("Matrícula", "Employee number (MAT)")} hint={tr("Aparece no nome do ficheiro Excel", "Shown in the Excel file name")}><input className="in" value={mat} onChange={(e) => setMat(e.target.value.toUpperCase())} onBlur={() => mat !== (me.matricula ?? "") && void patch({ matricula: mat.trim() }, tr("Matrícula guardada.", "Employee number saved."))} /></Field>
          <p className="muted small">{tr("Empresa, perfil e manager são alterados pelo administrador.", "Company, role and manager are changed by the administrator.")}</p>
        </div>
        <div>
          <div className="k">{tr("Assinatura", "Signature")}</div>
          <p>{tr("As aprovações registadas na plataforma valem como assinatura.", "Approvals recorded on the platform count as a signature.")}</p>
        </div>
        <div>
          <div className="k">{tr("Viatura pessoal", "Personal car")}</div>
          <label className="cb"><input type="checkbox" disabled={busy} checked={me.uses_km} onChange={(e) => void patch({ uses_km: e.target.checked }, e.target.checked ? tr("Mapa de quilómetros ativado.", "Mileage log enabled.") : tr("Mapa de quilómetros desativado.", "Mileage log disabled."))} /> {tr("Uso a minha viatura pessoal em serviço", "I use my personal car for work")}</label>
          {me.uses_km && <><p>{app.vehicle?.model || "—"}<br />{app.vehicle?.plate ?? ""}</p><button className="btn" onClick={() => app.go("km")}>{tr("Editar em Quilómetros", "Edit in Mileage")}</button></>}
        </div>
      </div>
    </div>
  );
}
