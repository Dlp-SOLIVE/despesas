import { useEffect, useState } from "react";
import type { AuditItem, CostCenter, ExpRole, Person, Settings } from "../types";
import { adminDelete, adminDeleteUser, adminReopen, loadAudit, updateCompany, updateProfile, updateSettings, upsertCostCenter } from "../lib/data";
import { eur, fmtDateTime, periodLabel } from "../lib/format";
import { ROLES, TYPES, TYPE_KEYS, VAT_DED, claimTotals } from "../lib/rules";
import { Chip, Field, PageHead, StatusChip, askReason, useApp } from "../ui";
import { tr } from "../lib/i18n";

type Tab = "users" | "cc" | "params" | "claims" | "audit";

export function AdminView() {
  const [tab, setTab] = useState<Tab>("users");
  const app = useApp();
  const pendingUsers = app.refs.people.filter((p) => !p.active).length;
  const tabs: [Tab, string][] = [["users", `${tr("Utilizadores", "Users")}${pendingUsers ? ` (${pendingUsers})` : ""}`], ["cc", "Cost centers"], ["params", tr("Parâmetros", "Settings")], ["claims", tr("Pedidos", "Claims")], ["audit", "Audit log"]];
  return (
    <div className="app-body">
      <PageHead eyebrow={tr("Administrador", "Administrator")} title={tr("Administração", "Administration")} />
      <div className="subtabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "users" && <Users />}
      {tab === "cc" && <CostCenters />}
      {tab === "params" && <Params />}
      {tab === "claims" && <Claims />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useRun() {
  const app = useApp();
  return async (fn: () => Promise<void>, log: string, msg?: string) => {
    try {
      await fn();
      app.log(log);
      await app.reload();
      if (msg) app.toast(msg);
    } catch (e) {
      app.fail(e);
    }
  };
}

function Users() {
  const app = useApp();
  const run = useRun();
  const approvers = app.refs.people.filter((p) => p.active && p.role !== "colaborador");
  const upd = (p: Person, patch: Parameters<typeof updateProfile>[1]) => void run(() => updateProfile(p.id, patch), `Alterou utilizador ${p.full_name}: ${Object.keys(patch).join(", ")}`);
  async function del(p: Person) {
    const reason = await askReason(tr(`Apagar ${p.full_name} (${p.email})? A conta de acesso é eliminada. Quem tem pedidos submetidos não pode ser apagado (só desativado). Indique o motivo:`, `Delete ${p.full_name} (${p.email})? The login account is deleted. Users with submitted claims cannot be deleted (only deactivated). Enter the reason:`));
    if (!reason) return;
    await run(() => adminDeleteUser(p.id, reason), `Apagou utilizador ${p.full_name}`, tr(`${p.full_name} apagado.`, `${p.full_name} deleted.`));
  }
  const people = [...app.refs.people].sort((a, b) => Number(a.active) - Number(b.active) || a.full_name.localeCompare(b.full_name));
  return (
    <>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>{tr("Nome", "Name")}</th><th>{tr("Matrícula", "Employee no.")}</th><th>{tr("Empresa", "Company")}</th><th>{tr("Perfil", "Role")}</th><th>Manager</th><th>Km</th><th>{tr("Estado", "Status")}</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.active ? "" : "flag"}>
                <td>{p.full_name}<div className="cat">{p.email}</div></td>
                <td className="mono">{p.matricula ?? "—"}</td>
                <td><select className="in bare" value={p.company_id ?? ""} onChange={(e) => upd(p, { company_id: e.target.value || null })}><option value="">—</option>{app.refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td><select className="in bare" value={p.role} disabled={p.id === app.me.id} onChange={(e) => upd(p, { role: e.target.value as ExpRole })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td><select className="in bare" value={p.manager_id ?? ""} onChange={(e) => upd(p, { manager_id: e.target.value || null })}><option value="">—</option>{approvers.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></td>
                <td><input type="checkbox" aria-label={tr("Usa viatura pessoal", "Uses personal car")} checked={p.uses_km} onChange={(e) => upd(p, { uses_km: e.target.checked })} /></td>
                <td>{p.active ? <button className="link-button" disabled={p.id === app.me.id} onClick={() => upd(p, { active: false })}><Chip tone="ok">{tr("Ativo", "Active")}</Chip></button> : <button className="btn primary sm" onClick={() => upd(p, { active: true })}>{tr("Aprovar acesso", "Approve access")}</button>}</td>
                <td>{p.id !== app.me.id && <button className="link-button" style={{ color: "var(--danger)" }} onClick={() => void del(p)}>{tr("Apagar", "Delete")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{tr("Os pedidos de acesso aparecem no topo. Antes de aprovar, confirme empresa e manager: sem manager, o colaborador não consegue submeter.", "Access requests appear at the top. Before approving, check the company and manager: without a manager, the employee cannot submit.")}</p>
    </>
  );
}

function CostCenters() {
  const app = useApp();
  const run = useRun();
  const owners = app.refs.people.filter((p) => p.active && p.role !== "colaborador");
  const blank: CostCenter = { code: "", label: "", company_id: "LEGDR", owner_id: owners[0]?.id ?? null, active: true };
  const [n, setN] = useState<CostCenter>(blank);
  const code = n.code.trim();
  const dup = app.refs.costCenters.some((c) => c.code === code);
  const fmtOk = /^\d{2}-\d{5}$/.test(code);
  const upd = (c: CostCenter, patch: Partial<CostCenter>) => void run(() => upsertCostCenter({ ...c, ...patch }, false), `Alterou cost center ${c.code}`);
  return (
    <>
      <div className="trip-form cc-form">
        <Field label={tr("Código", "Code")} error={code && !fmtOk ? tr("Formato 00-00000", "Format 00-00000") : dup ? tr("Já existe", "Already exists") : undefined}><input className="in" value={n.code} placeholder="19-16813" onChange={(e) => setN({ ...n, code: e.target.value })} /></Field>
        <Field label={tr("Designação", "Name")}><input className="in" value={n.label} placeholder={tr("Projeto ou estrutura", "Project or overhead")} onChange={(e) => setN({ ...n, label: e.target.value })} /></Field>
        <Field label={tr("Empresa", "Company")}><select className="in" value={n.company_id} onChange={(e) => setN({ ...n, company_id: e.target.value })}>{app.refs.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={tr("Responsável", "Owner")}><select className="in" value={n.owner_id ?? ""} onChange={(e) => setN({ ...n, owner_id: e.target.value || null })}><option value="">—</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <div className="tf-end"><button className="btn primary" disabled={!fmtOk || dup || !n.label.trim()} onClick={() => void run(async () => { await upsertCostCenter({ ...n, code, label: n.label.trim() }, true); setN(blank); }, `Criou cost center ${code}`, tr("Cost center criado.", "Cost center created."))}>{tr("Adicionar cost center", "Add cost center")}</button></div>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>{tr("Código", "Code")}</th><th>{tr("Designação", "Name")}</th><th>{tr("Empresa", "Company")}</th><th>{tr("Responsável", "Owner")}</th><th className="num">{tr("Pedidos", "Claims")}</th><th>{tr("Estado", "Status")}</th></tr></thead>
          <tbody>
            {app.refs.costCenters.map((c) => (
              <tr key={c.code}>
                <td className="mono">{c.code}</td>
                <td><input className="in bare" defaultValue={c.label} onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && upd(c, { label: e.target.value.trim() })} /></td>
                <td><select className="in bare" value={c.company_id} onChange={(e) => upd(c, { company_id: e.target.value })}>{app.refs.companies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                <td><select className="in bare" value={c.owner_id ?? ""} onChange={(e) => upd(c, { owner_id: e.target.value || null })}><option value="">—</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></td>
                <td className="num">{app.claims.filter((x) => x.cost_center === c.code).length}</td>
                <td><button className="link-button" onClick={() => upd(c, { active: !c.active })}>{c.active ? <Chip tone="ok">{tr("Ativo", "Active")}</Chip> : <Chip tone="info">{tr("Inativo", "Inactive")}</Chip>}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{tr("Cost centers não se apagam, apenas se desativam, para manter o histórico fiscal.", "Cost centers are not deleted, only deactivated, to keep the tax history.")}</p>
    </>
  );
}

function Params() {
  const app = useApp();
  const run = useRun();
  const s = app.refs.settings;
  const save = (k: keyof Settings, v: number) => {
    if (!Number.isFinite(v) || v === s[k]) return;
    void run(() => updateSettings({ [k]: v } as Partial<Settings>), `Alterou parâmetro ${k} para ${v}`, tr("Parâmetro guardado.", "Setting saved."));
  };
  return (
    <div className="params">
      <Field label={tr("Taxa por km (€)", "Rate per km (€)")}><input className="in num" type="number" step="0.01" defaultValue={s.km_rate} onBlur={(e) => save("km_rate", Number(e.target.value))} /></Field>
      <Field label={tr("Antiguidade máxima dos recibos (meses)", "Maximum receipt age (months)")}><input className="in num" type="number" defaultValue={s.max_age_months} onBlur={(e) => save("max_age_months", Number(e.target.value))} /></Field>
      <Field label={tr("Máximo de recibos por formulário", "Maximum receipts per form")} hint={tr("Limite do modelo Excel (linhas 11 a 34)", "Excel template limit (rows 11 to 34)")}><div className="in ro">{s.max_lines}</div></Field>
      {app.refs.companies.map((c) => (
        <Field key={c.id} label={`${tr("NIF", "VAT no.")} · ${c.name}`}><input className="in" defaultValue={c.nif} onBlur={(e) => e.target.value.trim() !== c.nif && void run(() => updateCompany(c.id, e.target.value.trim()), `Alterou NIF ${c.id}`, tr("NIF guardado.", "VAT number saved."))} /></Field>
      ))}
      <Field label={tr("Conservação de documentos", "Document retention")} hint={tr("Legislação fiscal portuguesa. Só o administrador reabre ou apaga pedidos, sempre com motivo no audit log.", "Portuguese tax law. Only the administrator reopens or deletes claims, always with a reason in the audit log.")}><div className="in ro">{s.retention_years} {tr("anos", "years")}</div></Field>
      <div className="params-wide">
        <div className="eyebrow" style={{ marginBottom: 8 }}>{tr("Quadro de referência (Listes)", "Reference table (Listes)")}</div>
        <div className="tbl-wrap"><table><thead><tr><th>{tr("Tipo", "Type")}</th><th>{tr("Subcategoria", "Subcategory")}</th><th className="num">{tr("IVA dedutível", "Deductible VAT")}</th></tr></thead><tbody>
          {TYPE_KEYS.flatMap((k) => TYPES[k].subs.map((sub) => <tr key={k + sub}><td>{TYPES[k].label}</td><td>{sub}</td><td className="num">{((VAT_DED[sub] ?? 0) * 100).toFixed(0)} %</td></tr>))}
        </tbody></table></div>
      </div>
    </div>
  );
}

function Claims() {
  const app = useApp();
  const run = useRun();
  const name = (id: string) => app.refs.people.find((p) => p.id === id)?.full_name ?? "—";
  async function reopen(id: string) {
    const r = await askReason(tr("Reabrir este pedido como rascunho?", "Reopen this claim as a draft?"));
    if (r) void run(() => adminReopen(id, r), "Reabriu pedido", tr("Pedido reaberto.", "Claim reopened."));
  }
  async function del(id: string) {
    const r = await askReason(tr("Apagar definitivamente este pedido? Respeite o prazo legal de conservação.", "Permanently delete this claim? Respect the legal retention period."));
    if (r) void run(() => adminDelete(id, r), "Apagou pedido", tr("Pedido apagado.", "Claim deleted."));
  }
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>{tr("Mês", "Month")}</th><th>{tr("Colaborador", "Employee")}</th><th>Cost center</th><th className="num">Total</th><th>{tr("Estado", "Status")}</th><th></th></tr></thead>
        <tbody>
          {app.claims.map((c) => (
            <tr key={c.id}>
              <td>{periodLabel(c.period)}</td><td>{name(c.staff_member_id)}</td><td>{c.cost_center}</td><td className="num">{eur(claimTotals(c, app.refs.settings).total)}</td><td><StatusChip status={c.status} /></td>
              <td className="actions-cell">
                <button className="link-button" onClick={() => app.go(c.staff_member_id === app.me.id ? "mes" : "review", c.id)}>{tr("Ver", "View")}</button>
                {c.status !== "draft" && <button className="link-button" onClick={() => void reopen(c.id)}>{tr("Reabrir", "Reopen")}</button>}
                <button className="link-button danger" onClick={() => void del(c.id)}>{tr("Apagar", "Delete")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Audit() {
  const app = useApp();
  const [rows, setRows] = useState<AuditItem[] | null>(null);
  useEffect(() => {
    loadAudit().then(setRows).catch((e: unknown) => app.fail(e));
  }, []);
  const name = (id: string | null) => app.refs.people.find((p) => p.id === id)?.full_name ?? "—";
  if (!rows) return <p className="muted">{tr("A carregar…", "Loading…")}</p>;
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>{tr("Quando", "When")}</th><th>{tr("Quem", "Who")}</th><th>{tr("Ação", "Action")}</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td className="nw mono">{fmtDateTime(a.at)}</td><td>{name(a.actor_id)}</td><td>{a.action}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
