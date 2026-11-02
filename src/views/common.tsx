import { useState, type ReactNode } from "react";
import type { Claim } from "../types";
import { createClaim } from "../lib/data";
import { buildExcel, buildPDF, download } from "../lib/export";
import { periodLabel, periodOf } from "../lib/format";
import { packageName, type RuleCtx } from "../lib/rules";
import { Field, Modal, StatusChip, useApp, type AppCtx } from "../ui";

export function ruleCtx(app: AppCtx, claim: Claim): RuleCtx {
  const cc = app.refs.costCenters.find((x) => x.code === claim.cost_center);
  const owner = app.refs.people.find((p) => p.id === claim.staff_member_id);
  const company = app.refs.companies.find((x) => x.id === (cc ? cc.company_id : owner?.company_id)) ?? null;
  return { settings: app.refs.settings, company, today: app.today };
}

export function canEdit(app: AppCtx, claim: Claim | null): boolean {
  if (!claim) return false;
  return (claim.staff_member_id === app.me.id && (claim.status === "draft" || claim.status === "returned")) || app.me.role === "admin";
}

export function myClaim(app: AppCtx): Claim | null {
  const sel = app.claims.find((c) => c.id === app.selId);
  if (sel && sel.staff_member_id === app.me.id) return sel;
  const period = periodOf(app.today);
  return app.claims.find((c) => c.staff_member_id === app.me.id && c.period === period) ?? null;
}

export function vehicleFor(app: AppCtx, claim: Claim) {
  if (claim.vehicle_model || claim.vehicle_plate) return { model: claim.vehicle_model ?? "", plate: claim.vehicle_plate ?? "" };
  if (claim.staff_member_id === app.me.id && app.vehicle) return { model: app.vehicle.model, plate: app.vehicle.plate };
  return null;
}

export function ClaimHeader({ claim, eyebrow, actions }: { claim: Claim; eyebrow: string; actions?: ReactNode }) {
  const app = useApp();
  const cc = app.refs.costCenters.find((x) => x.code === claim.cost_center);
  const co = app.refs.companies.find((x) => x.id === cc?.company_id);
  const siblings = app.claims.filter((c) => c.staff_member_id === claim.staff_member_id && c.period === claim.period);
  return (
    <div className="month-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{periodLabel(claim.period)}</h1>
        <div className="pills">
          <span className="pill">{co?.name ?? "—"}</span>
          {siblings.length > 1 ? (
            <select className="pill sel" value={claim.id} onChange={(e) => app.go(claim.staff_member_id === app.me.id ? "mes" : "review", e.target.value)}>
              {siblings.map((c) => <option key={c.id} value={c.id}>Cost center {c.cost_center} · {app.refs.costCenters.find((x) => x.code === c.cost_center)?.label ?? ""}</option>)}
            </select>
          ) : (
            <span className="pill">Cost center {claim.cost_center} · {cc?.label ?? ""}</span>
          )}
          <StatusChip status={claim.status} />
        </div>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function NewClaimModal({ period, onClose }: { period: string; onClose: () => void }) {
  const app = useApp();
  const taken = app.claims.filter((c) => c.staff_member_id === app.me.id && c.period === period).map((c) => c.cost_center);
  const opts = app.refs.costCenters.filter((c) => c.active && !taken.includes(c.code));
  const [cc, setCc] = useState(opts[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const id = await createClaim(app.me.id, cc, period);
      app.log(`Criou pedido ${periodLabel(period)} · ${cc}`);
      await app.reload();
      app.go("mes", id);
      onClose();
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Novo pedido · ${periodLabel(period)}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!cc || busy} onClick={() => void create()}>Criar pedido</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Um único pedido por mês e por cost center. Se não souber o código, pergunte ao seu manager.</p>
      {opts.length ? (
        <Field label="Cost center"><select className="in" value={cc} onChange={(e) => setCc(e.target.value)}>{opts.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></Field>
      ) : (
        <p>{app.refs.costCenters.length ? "Já tem pedido para todos os cost centers ativos este mês." : "Ainda não há cost centers. Peça ao administrador para os criar."}</p>
      )}
    </Modal>
  );
}

export function DownloadBtns({ claim }: { claim: Claim }) {
  const app = useApp();
  const [busy, setBusy] = useState<"" | "x" | "p">("");
  const owner = app.refs.people.find((p) => p.id === claim.staff_member_id);
  async function run(kind: "x" | "p") {
    setBusy(kind);
    try {
      const name = packageName(claim, owner);
      if (kind === "x") download(await buildExcel(claim, { ...app.refs, vehicle: vehicleFor(app, claim) }), `${name}.xlsx`);
      else download(await buildPDF(claim), `${name}.pdf`);
      app.log(`Descarregou ${kind === "x" ? "Excel" : "PDF"} · ${owner?.full_name ?? ""} ${claim.period}`);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <button className="btn" disabled={!!busy} onClick={() => void run("x")}>{busy === "x" ? "A gerar…" : "Excel"}</button>
      <button className="btn" disabled={!!busy} onClick={() => void run("p")}>{busy === "p" ? "A gerar…" : "PDF recibos"}</button>
    </>
  );
}
