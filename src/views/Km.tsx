import { useState } from "react";
import { addFav, addTrip, deleteFav, deleteTrip, saveVehicle, setInsurance } from "../lib/data";
import { eur, fmtDate, num1 } from "../lib/format";
import { claimTotals, fmtPlate, plateOk, tripKm } from "../lib/rules";
import { Empty, Field, useApp } from "../ui";
import { ClaimHeader, canEdit, myClaim } from "./common";
import { MonthView } from "./Month";
import { tr } from "../lib/i18n";

export function KmView() {
  const app = useApp();
  const claim = myClaim(app);
  const blank = { trip_date: app.today, origin: "", dest: "", purpose: "", km: "", round_trip: true };
  const [n, setN] = useState(blank);
  const [fav, setFav] = useState(false);
  const [model, setModel] = useState(app.vehicle?.model ?? "");
  const [plate, setPlate] = useState(app.vehicle?.plate ?? "");
  const [busy, setBusy] = useState(false);
  if (!claim) return <MonthView />;
  const ed = canEdit(app, claim) && claim.staff_member_id === app.me.id;
  const t = claimTotals(claim, app.refs.settings);
  const ok = claim.insurance_declared && plateOk(plate) && model.trim() && n.trip_date && n.origin.trim() && n.dest.trim() && n.purpose.trim() && Number(n.km) > 0;
  const kmNum = Number(n.km) || 0;

  async function run(fn: () => Promise<void>, msg?: string) {
    setBusy(true);
    try {
      await fn();
      await app.reload();
      if (msg) app.toast(msg);
    } catch (e) {
      app.fail(e);
    } finally {
      setBusy(false);
    }
  }
  const saveVeh = () => {
    if (model === (app.vehicle?.model ?? "") && plate === (app.vehicle?.plate ?? "")) return;
    if (plate && !plateOk(plate)) return app.toast(tr("Matrícula inválida: use o formato XX-XX-XX.", "Invalid plate: use the format XX-XX-XX."), "err");
    void run(() => saveVehicle({ staff_member_id: app.me.id, model: model.trim(), plate: plate.trim().toUpperCase() }), tr("Viatura guardada.", "Vehicle saved."));
  };
  const add = () =>
    void run(async () => {
      if (!claim) return;
      const trip = { trip_date: n.trip_date, origin: n.origin.trim(), dest: n.dest.trim(), purpose: n.purpose.trim(), km: Number(n.km), round_trip: n.round_trip };
      await addTrip(claim.id, trip);
      if (fav) await addFav({ staff_member_id: app.me.id, origin: trip.origin, dest: trip.dest, purpose: trip.purpose, km: trip.km, round_trip: trip.round_trip });
      setN({ ...blank, trip_date: n.trip_date });
      setFav(false);
    }, tr("Trajeto adicionado.", "Trip added."));
  const trips = [...claim.trips].sort((a, b) => a.trip_date.localeCompare(b.trip_date));

  return (
    <div className="app-body">
      <ClaimHeader claim={claim} eyebrow={`Détail IK · ${num1(t.km)} km · ${eur(t.kmEUR)}`} actions={<button className="btn" onClick={() => app.go("mes", claim.id)}>{tr("Ver recibos", "View receipts")}</button>} />
      <div className="veh">
        <Field label={tr("Viatura pessoal", "Personal car")}><input className="in" disabled={!ed} value={model} placeholder={tr("Marca e modelo", "Make and model")} onChange={(e) => setModel(e.target.value)} onBlur={saveVeh} /></Field>
        <Field label={tr("Matrícula", "Plate")} hint={plate && !plateOk(plate) ? tr("Formato XX-XX-XX", "Format XX-XX-XX") : undefined}><input className="in" disabled={!ed} value={plate} placeholder="XX-XX-XX" maxLength={8} onChange={(e) => setPlate(fmtPlate(e.target.value))} onBlur={saveVeh} /></Field>
        <Field label={tr("Taxa", "Rate")}><div className="in ro">{eur(t.kmRate)} / km</div></Field>
      </div>
      <label className={claim.insurance_declared ? "notice cb" : "notice cb warn-n"} style={{ marginBottom: 16 }}>
        <input type="checkbox" disabled={!ed || busy} checked={claim.insurance_declared} onChange={(e) => { const v = e.target.checked; void run(async () => { await setInsurance(claim.id, v); if (v) app.log(`Declarou seguro automóvel · ${claim.period}`); }); }} />
        <span>{tr("Declaro ter seguro automóvel válido para a viatura indicada e assumo o risco em caso de acidente.", "I declare that I have valid car insurance for this vehicle and accept the risk in case of an accident.")} <span className="muted">{tr("Obrigatório antes de registar deslocações, em cada pedido.", "Required before recording trips, on every claim.")}</span></span>
      </label>
      {ed && !claim.insurance_declared && <div className="notice warn-n" style={{ marginBottom: 16 }}>{tr("Para registar deslocações, preencha a viatura e a matrícula e assinale a declaração de seguro.", "To record trips, fill in the vehicle and plate and tick the insurance declaration.")}</div>}
      {ed && claim.insurance_declared && (
        <>
          {app.favs.length > 0 && (
            <div className="opts" style={{ margin: "4px 0 16px" }}>
              <span className="optlab">{tr("Trajetos frequentes", "Frequent trips")}</span>
              {app.favs.map((fv) => (
                <span key={fv.id} className="favchip">
                  <button type="button" disabled={busy || !plateOk(plate) || !model.trim()} title={tr("Adicionar com a data de hoje", "Add with today's date")} onClick={() => void run(() => addTrip(claim.id, { trip_date: app.today, origin: fv.origin, dest: fv.dest, purpose: fv.purpose, km: fv.km, round_trip: fv.round_trip }), tr(`Trajeto adicionado a ${fmtDate(app.today)}.`, `Trip added on ${fmtDate(app.today)}.`))}>
                    {fv.dest.split(",")[0]} · {num1(fv.km)} km{fv.round_trip ? " ⇄" : ""}
                  </button>
                  <button type="button" className="x-sm" aria-label={tr("Remover dos frequentes", "Remove from frequent trips")} onClick={() => void run(() => deleteFav(fv.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="trip-form">
            <Field label={tr("Data", "Date")}><input className="in" type="date" max={app.today} value={n.trip_date} onChange={(e) => setN({ ...n, trip_date: e.target.value })} /></Field>
            <Field label={tr("Origem", "From")}><input className="in" value={n.origin} placeholder={tr("Morada de partida", "Starting address")} onChange={(e) => setN({ ...n, origin: e.target.value })} /></Field>
            <Field label={tr("Destino", "To")}><input className="in" value={n.dest} placeholder={tr("Obra, cliente, morada", "Site, client, address")} onChange={(e) => setN({ ...n, dest: e.target.value })} /></Field>
            <Field label={tr("Motivo / projeto", "Reason / project")}><input className="in" value={n.purpose} placeholder={tr("Reunião de obra", "Site meeting")} onChange={(e) => setN({ ...n, purpose: e.target.value })} /></Field>
            <Field label={tr("Distância (km)", "Distance (km)")} hint={kmNum ? (n.round_trip ? `${tr("Ida e volta", "Round trip")}: 2 × ${num1(kmNum)} = ${num1(kmNum * 2)} km` : `${tr("Só ida", "One way")}: ${num1(kmNum)} km`) : tr("Distância de origem a destino", "Distance from start to destination")}><input className="in num" type="number" step="0.1" min="0" value={n.km} onChange={(e) => setN({ ...n, km: e.target.value })} /></Field>
            <div className="tf-end">
              <label className="cb"><input type="checkbox" checked={n.round_trip} onChange={(e) => setN({ ...n, round_trip: e.target.checked })} /> {tr("Ida e volta", "Round trip")}</label>
              <label className="cb"><input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} /> {tr("Guardar como frequente", "Save as frequent")}</label>
              <button className="btn primary" disabled={!ok || busy} onClick={add}>{tr("Adicionar", "Add")}</button>
            </div>
          </div>
        </>
      )}
      {trips.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr("Data", "Date")}</th><th>{tr("Origem", "From")}</th><th>{tr("Destino", "To")}</th><th>{tr("Motivo / projeto", "Reason / project")}</th><th>{tr("Ida e volta", "Round trip")}</th><th className="num">Km</th><th className="num">{tr("Valor", "Amount")}</th>{ed && <th></th>}</tr></thead>
            <tbody>
              {trips.map((tp) => (
                <tr key={tp.id}>
                  <td className="nw">{fmtDate(tp.trip_date)}</td><td>{tp.origin}</td><td>{tp.dest}</td><td>{tp.purpose}</td><td>{tp.round_trip ? tr("Sim", "Yes") : tr("Não", "No")}</td>
                  <td className="num">{num1(tripKm(tp))}</td><td className="num">{eur(tripKm(tp) * t.kmRate)}</td>
                  {ed && <td><button className="link-button" onClick={() => void run(() => deleteTrip(tp.id))}>{tr("Apagar", "Delete")}</button></td>}
                </tr>
              ))}
              <tr className="tot"><td colSpan={5}>{tr("Total de quilómetros", "Total kilometres")}</td><td className="num">{num1(t.km)}</td><td className="num">{eur(t.kmEUR)}</td>{ed && <td></td>}</tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={tr("Sem trajetos neste mês", "No trips this month")}>{tr("Registe as deslocações com viatura pessoal. O total segue para a secção 3 do formulário.", "Record trips made with your personal car. The total goes to section 3 of the form.")}</Empty>
      )}
    </div>
  );
}
