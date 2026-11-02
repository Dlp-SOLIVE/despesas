// Pacote entregue à contabilidade: Excel preenchido sobre o modelo oficial + PDF único com os recibos
import type { Claim, Company, CostCenter, Person } from "../types";
import { downloadReceipt } from "./data";
import { MONTHS_EN, fmtDate, parseISO } from "./format";
import { TYPES, claimTotals, detailText, lineRate, tripKm } from "./rules";
import type { Settings } from "../types";

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

type Ctx = { people: Person[]; costCenters: CostCenter[]; companies: Company[]; vehicle: { model: string; plate: string } | null };

export async function buildExcel(claim: Claim, ctx: Ctx): Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("exceljs");
  const Ex = mod.Workbook ? mod : mod.default;
  const u = ctx.people.find((p) => p.id === claim.staff_member_id);
  const cc = ctx.costCenters.find((x) => x.code === claim.cost_center);
  const co = ctx.companies.find((x) => x.id === (cc ? cc.company_id : u?.company_id));
  const buf = await (await fetch("/template.xlsx")).arrayBuffer();
  const wb = new Ex.Workbook();
  await wb.xlsx.load(buf);
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  const P = wb.getWorksheet("To be printed");
  const F = wb.getWorksheet("EXPENSE CLAIM FORM");
  const K = wb.getWorksheet("Détail IK");
  if (!P || !F || !K) throw new Error("Modelo Excel inválido: faltam folhas");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (ws: any, addr: string, v: unknown) => {
    const c = ws.getCell(addr);
    if (c.formula || c.sharedFormula) return; // nunca escrever por cima de fórmulas da contabilidade
    c.value = v;
  };
  const [y, m] = claim.period.split("-").map(Number);
  const parts = (u?.full_name ?? "").trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ");
  set(P, "C2", MONTHS_EN[m - 1]);
  set(P, "E2", y);
  set(P, "H2", last || first);
  set(P, "H4", first);
  set(P, "H6", co?.name ?? "");
  set(P, "I8", claim.cost_center);
  set(P, "C71", new Date());
  for (let r = 11; r <= 34; r++) {
    for (const col of ["C", "D", "E", "F", "G", "K", "N", "O", "R"]) set(F, col + r, null);
    set(F, "M" + r, "EUR");
    set(F, "Q" + r, 1);
  }
  [...claim.lines].sort((a, b) => a.no - b.no).slice(0, 24).forEach((l, i) => {
    const r = 11 + i;
    const t = l.type ? TYPES[l.type].label : "";
    const rate = lineRate(l);
    set(F, "C" + r, l.receipt_date ? parseISO(l.receipt_date) : null);
    set(F, "D" + r, t);
    set(F, "E" + r, l.sub ?? "");
    set(F, "F" + r, t + (l.sub ?? ""));
    set(F, "G" + r, detailText(l.sub, l.details));
    set(F, "K" + r, l.client ?? "");
    set(F, "M" + r, l.currency);
    set(F, "N" + r, Number(l.excl));
    set(F, "O" + r, Number(l.incl));
    set(F, "Q" + r, rate);
    set(F, "R" + r, Math.round(Number(l.incl) * rate * 100) / 100);
  });
  const who = (id: string | null) => ctx.people.find((p) => p.id === id)?.full_name ?? "";
  for (const h of claim.history) {
    const txt = `${who(h.actor_id)} · ${fmtDate(h.at)}`;
    if (h.action === "Submetido ao manager") set(F, "E45", txt);
    if (h.action === "Aprovado") set(F, "I45", txt);
    if (h.action === "Validado") set(F, "L45", txt);
  }
  set(K, "E7", claim.vehicle_model ?? ctx.vehicle?.model ?? "");
  set(K, "E9", claim.vehicle_plate ?? ctx.vehicle?.plate ?? "");
  for (let r = 13; r <= 73; r++) {
    set(K, "B" + r, null);
    set(K, "C" + r, null);
    set(K, "H" + r, null);
  }
  [...claim.trips].sort((a, b) => a.trip_date.localeCompare(b.trip_date)).slice(0, 61).forEach((t, i) => {
    const r = 13 + i;
    set(K, "B" + r, parseISO(t.trip_date));
    set(K, "C" + r, `${t.origin} para ${t.dest}${t.round_trip ? " (ida e volta)" : ""} – ${t.purpose}`);
    set(K, "H" + r, tripKm(t));
  });
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function toJpeg(blob: Blob): Promise<Uint8Array> {
  const img = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")?.drawImage(img, 0, 0);
  const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
  if (!b) throw new Error("Imagem inválida");
  return new Uint8Array(await b.arrayBuffer());
}

export async function buildPDF(claim: Claim): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stamp = (page: any, no: number) => {
    const h = page.getHeight();
    page.drawRectangle({ x: 18, y: h - 50, width: 36, height: 32, color: rgb(0.902, 0.137, 0.212) });
    const s = String(no);
    page.drawText(s, { x: 36 - font.widthOfTextAtSize(s, 16) / 2, y: h - 40, size: 16, font, color: rgb(1, 1, 1) });
  };
  for (const l of [...claim.lines].sort((a, b) => a.no - b.no)) {
    if (!l.file_path) {
      const p = doc.addPage(A4);
      stamp(p, l.no);
      p.drawText("Recibo em falta", { x: 70, y: 780, size: 14, font });
      continue;
    }
    const blob = await downloadReceipt(l.file_path);
    const type = l.file_type || blob.type;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (type === "application/pdf") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p, i) => {
        doc.addPage(p);
        if (i === 0) stamp(p, l.no);
      });
      continue;
    }
    const img = type === "image/png" ? await doc.embedPng(bytes) : type === "image/jpeg" || type === "image/jpg" ? await doc.embedJpg(bytes) : await doc.embedJpg(await toJpeg(blob));
    const p = doc.addPage(A4);
    const margin = 40;
    const sc = Math.min((A4[0] - 2 * margin) / img.width, (A4[1] - 2 * margin - 30) / img.height);
    const w = img.width * sc;
    const h = img.height * sc;
    p.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - 30 - h) / 2, width: w, height: h });
    stamp(p, l.no);
  }
  const out = await doc.save();
  return new Blob([out as unknown as BlobPart], { type: "application/pdf" });
}

// Documento enviado à DocuSign: folha de aprovação (com âncoras de assinatura) + recibos
export async function buildSigningPDF(
  claim: Claim,
  ctx: { people: Person[]; costCenters: CostCenter[]; companies: Company[]; settings: Settings },
  signer: Person,
  stepLabel: string,
): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const red = rgb(0.902, 0.137, 0.212);
  const grey = rgb(0.43, 0.43, 0.43);
  const owner = ctx.people.find((p) => p.id === claim.staff_member_id);
  const cc = ctx.costCenters.find((x) => x.code === claim.cost_center);
  const co = ctx.companies.find((x) => x.id === cc?.company_id);
  const t = claimTotals(claim, ctx.settings);
  const money = (v: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " EUR";
  let y = 790;
  page.drawRectangle({ x: 40, y: y + 10, width: 40, height: 4, color: red });
  page.drawText("LEGENDRE · DESPESAS", { x: 40, y: y - 10, size: 10, font: bold, color: red });
  y -= 44;
  page.drawText(`Pedido de reembolso · ${MONTHS_EN[Number(claim.period.slice(5, 7)) - 1]} ${claim.period.slice(0, 4)}`, { x: 40, y, size: 18, font: bold });
  y -= 30;
  const row = (k: string, v: string) => {
    page.drawText(k, { x: 40, y, size: 10, font: reg, color: grey });
    page.drawText(v, { x: 200, y, size: 10, font: bold });
    y -= 18;
  };
  row("Colaborador", `${owner?.full_name ?? ""} ${owner?.matricula ? "· " + owner.matricula : ""}`);
  row("Empresa", co?.name ?? "");
  row("Cost center", `${claim.cost_center} · ${cc?.label ?? ""}`);
  row("Recibos / trajetos", `${claim.lines.length} / ${claim.trips.length}`);
  y -= 10;
  row("1 · Travel E (FDD)", money(t.FDD));
  row("2 · Representation E-M (FDM)", money(t.FDM));
  row("3 · Quilómetros", `${money(t.kmEUR)}  (${t.km.toFixed(1)} km)`);
  row("4 · Office E", money(t.OFF));
  page.drawLine({ start: { x: 40, y: y + 8 }, end: { x: 555, y: y + 8 }, thickness: 1 });
  y -= 6;
  row("Total geral", money(t.total));
  y -= 30;
  page.drawText(stepLabel.toUpperCase(), { x: 40, y, size: 10, font: bold, color: red });
  y -= 20;
  page.drawText(`Declaro que revi este pedido e os recibos anexos (páginas seguintes) e que os aprovo.`, { x: 40, y, size: 10, font: reg });
  y -= 50;
  page.drawText(signer.full_name, { x: 40, y: y + 34, size: 10, font: bold });
  page.drawLine({ start: { x: 40, y }, end: { x: 300, y }, thickness: 0.8, color: grey });
  page.drawText("/assinatura/", { x: 44, y: y + 4, size: 6, font: reg, color: rgb(1, 1, 1) });
  page.drawText("Assinatura", { x: 40, y: y - 12, size: 8, font: reg, color: grey });
  page.drawLine({ start: { x: 340, y }, end: { x: 555, y }, thickness: 0.8, color: grey });
  page.drawText("/data/", { x: 344, y: y + 4, size: 6, font: reg, color: rgb(1, 1, 1) });
  page.drawText("Data", { x: 340, y: y - 12, size: 8, font: reg, color: grey });
  const receipts = await PDFDocument.load(new Uint8Array(await (await buildPDF(claim)).arrayBuffer()));
  const pages = await doc.copyPages(receipts, receipts.getPageIndices());
  pages.forEach((pg) => doc.addPage(pg));
  return doc.saveAsBase64();
}
