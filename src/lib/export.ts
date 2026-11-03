// Pacote entregue à contabilidade: Excel preenchido sobre o modelo oficial + PDF único com os recibos
import type { Claim, Company, CostCenter, Person } from "../types";
import { downloadReceipt } from "./data";
import { MONTHS_EN, fmtDate, parseISO } from "./format";
import { TYPES, detailText, lineRate, tripKm } from "./rules";

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
  const res = await fetch("/template.xlsx", { cache: "no-store" });
  if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error("Modelo Excel em falta no site (public/template.xlsx). Avise o administrador.");
  const buf = await res.arrayBuffer();
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
    set(F, "K" + r, [l.client, l.details?.legal && l.details.legal !== l.client ? `(${l.details.legal})` : ""].filter(Boolean).join(" "));
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
    if (h.action === "Validado" || h.action === "Registado RH") set(F, "L45", txt);
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
