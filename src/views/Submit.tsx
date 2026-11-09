import { useState } from "react";
import type { Claim } from "../types";
import { submitClaim } from "../lib/data";
import { periodLabel } from "../lib/format";
import { claimChecklist, packageName } from "../lib/rules";
import { Chip, Modal, useApp } from "../ui";
import { DownloadBtns, vehicleFor } from "./common";
import { tr } from "../lib/i18n";

export function SubmitModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const app = useApp();
  const ck = claimChecklist(claim, { ...app.refs, today: app.today, vehicle: vehicleFor(app, claim) });
  const owner = app.refs.people.find((p) => p.id === claim.staff_member_id);
  const mgr = app.refs.people.find((p) => p.id === owner?.manager_id);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await submitClaim(claim.id);
      await app.reload();
      app.toast(tr(`Pedido de ${periodLabel(claim.period)} enviado para aprovação de ${mgr?.full_name ?? "manager"}.`, `${periodLabel(claim.period)} claim sent to ${mgr?.full_name ?? "your manager"} for approval.`));
      onClose();
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={tr("Rever e submeter", "Review and submit")} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{tr("Voltar", "Back")}</button>
        <button className="btn primary" disabled={!ck.ready || busy || !mgr} onClick={() => void submit()}>
          {!mgr ? tr("Sem manager atribuído: contacte o administrador", "No manager assigned: contact the administrator") : ck.ready ? tr(`Submeter a ${mgr.full_name}`, `Submit to ${mgr.full_name}`) : tr("Resolva a checklist para submeter", "Resolve the checklist to submit")}
        </button>
      </>
    }>
      <div className="split">
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Checklist antes de enviar", "Checklist before sending")}</div>
          <div className="check">
            {ck.items.map((i, k) => {
              const w = i.ok && i.warn.length > 0;
              return (
                <div key={k}>
                  <span className={!i.ok ? "tick x" : w ? "tick w" : "tick"}>{i.ok && !w ? "✓" : "!"}</span>
                  <span>{i.label}</span>
                  <span>{!i.ok && i.refs.length ? <Chip tone="err">{i.refs.join(", ")}</Chip> : w ? <Chip tone="warn">{tr("Rever", "Check")} {i.warn.join(", ")}</Chip> : null}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Ficheiros gerados", "Generated files")}</div>
          <div className="outputs">
            <div className="f"><span><span className="ext">XLSX</span><code>{packageName(claim, owner)}.xlsx</code></span></div>
            <div className="f"><span><span className="ext">PDF</span><code>{packageName(claim, owner)}.pdf</code></span><span className="cat">{claim.lines.length} {tr("recibos · pela ordem das linhas", "receipts · in line order")}</span></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><DownloadBtns claim={claim} /></div>
          <p className="muted small">{tr('O Excel é preenchido sobre o modelo oficial ("To be printed", "Expense Claim Form" e "Détail IK"). As fórmulas e controlos da contabilidade não são alterados.', 'The Excel is filled in on the official template ("To be printed", "Expense Claim Form" and "Détail IK"). The accounting formulas and controls are not changed.')}</p>
          <p className="muted small">{tr(`Ao submeter, ${mgr?.full_name ?? "o manager"} recebe o pedido em Aprovações. Os RH e o Administrativo têm conhecimento. Depois de aprovado, os RH registam e o Administrativo regista o pagamento.`, `When you submit, ${mgr?.full_name ?? "your manager"} receives the claim in Approvals. HR and Accounts are kept informed. Once approved, HR records it and Accounts records the payment.`)}</p>
        </div>
      </div>
    </Modal>
  );
}
