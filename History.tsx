import { useState } from "react";
import { updateProfile } from "../lib/data";
import { eur, num1, periodLabel } from "../lib/format";
import { ROLES, claimTotals } from "../lib/rules";
import { Empty, Field, PageHead, StatusChip, useApp } from "../ui";

export function HistoryView() {
  const app = useApp();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const others = app.claims.some((c) => c.staff_member_id !== app.me.id);
  const list = app.claims.filter((c) => scope === "all" || c.staff_member_id === app.me.id);
  const name = (id: string) => app.refs.people.find((p) => p.id === id)?.full_name ?? "—";
  return (
    <div className="app-body">
      <PageHead eyebrow={scope === "all" ? "Pedidos visíveis para si" : "Os meus pedidos"} title="Histórico" actions={others ? (
        <div className="seg" style={{ gridTemplateColumns: "1fr 1fr", minWidth: 220 }}>
          <button className={scope === "mine" ? "on" : ""} onClick={() => setScope("mine")}>Os meus</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Todos</button>
        </div>
      ) : undefined} />
      {list.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Mês</th>{scope === "all" && <th>Colaborador</th>}<th>Cost center</th><th className="num">Recibos</th><th className="num">Km</th><th className="num">Total</th><th>Estado</th></tr></thead>
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
        <Empty title="Ainda sem pedidos" />
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
      <PageHead eyebrow="Perfil" title={me.full_name} pills={<><span className="pill">{me.matricula ?? "Sem matrícula"}</span><span className="pill">{ROLES[me.role]}</span></>} />
      <div className="grid3">
        <div>
          <div className="k">Dados</div>
          <p>{me.email}<br />{co?.name ?? "Empresa por definir"}<br />Manager: {mgr?.full_name ?? "por atribuir"}</p>
          <Field label="Matrícula" hint="Aparece no nome do ficheiro Excel"><input className="in" value={mat} onChange={(e) => setMat(e.target.value.toUpperCase())} onBlur={() => mat !== (me.matricula ?? "") && void patch({ matricula: mat.trim() }, "Matrícula guardada.")} /></Field>
          <p className="muted small">Empresa, perfil e manager são alterados pelo administrador.</p>
        </div>
        <div>
          <div className="k">Assinatura</div>
          <p>As aprovações registadas na plataforma valem como assinatura.</p>
          <p>DocuSign: <b>{me.docusign ? "ativo" : "não ativo"}</b>{!app.refs.settings.docusign_enabled && <span className="muted"> (desligado pelo administrador)</span>}</p>
          <button className="btn" disabled={busy} onClick={() => void patch({ docusign: !me.docusign }, me.docusign ? "DocuSign desativado." : "DocuSign ativado.")}>{me.docusign ? "Desativar DocuSign" : "Ativar DocuSign"}</button>
          <p className="muted small">Com DocuSign ativo, ao aprovar abre-se a DocuSign com a folha de aprovação e os recibos; depois de assinar, volta à plataforma e o pedido avança. O documento assinado fica guardado no pedido.</p>
        </div>
        <div>
          <div className="k">Viatura pessoal</div>
          <label className="cb"><input type="checkbox" disabled={busy} checked={me.uses_km} onChange={(e) => void patch({ uses_km: e.target.checked }, e.target.checked ? "Mapa de quilómetros ativado." : "Mapa de quilómetros desativado.")} /> Uso a minha viatura pessoal em serviço</label>
          {me.uses_km && <><p>{app.vehicle?.model || "—"}<br />{app.vehicle?.plate ?? ""}</p><button className="btn" onClick={() => app.go("km")}>Editar em Quilómetros</button></>}
        </div>
      </div>
    </div>
  );
}
