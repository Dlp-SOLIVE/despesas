// Leitura gratuita de recibos, toda no browser (nada sai do computador do colaborador):
// 1) código QR fiscal da AT (faturas portuguesas desde 2022) — dados exatos
// 2) texto do PDF (faturas digitais) ou OCR Tesseract (fotografias) — nome, categoria e, sem QR, data e total
import jsQR from "jsqr";
import type { OcrResult } from "./data";

export type LocalRead = OcrResult & { source: "qr" | "texto" | "nenhum"; atcud?: string | null; nif_issuer?: string | null; legal_name?: string | null };

type Progress = (msg: string) => void;

// ── QR fiscal (Portaria 195/2020) ──
// A:NIF emitente * B:NIF adquirente * F:data AAAAMMDD * H:ATCUD * N:total impostos * O:total com impostos …
export function parseFiscalQR(raw: string): LocalRead | null {
  if (!/(^|\*)A:\d+/.test(raw) || !/\*O:/.test(raw)) return null;
  const f: Record<string, string> = {};
  for (const part of raw.split("*")) {
    const i = part.indexOf(":");
    if (i > 0) f[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const num = (v?: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
  const d = f.F && /^\d{8}$/.test(f.F) ? `${f.F.slice(0, 4)}-${f.F.slice(4, 6)}-${f.F.slice(6, 8)}` : null;
  const total = num(f.O);
  const tax = num(f.N) ?? 0;
  const fmtNif = (n?: string) => (n && /^\d{9}$/.test(n) ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n ?? null);
  return {
    source: "qr",
    date: d,
    nif_buyer: f.B && f.B !== "999999990" ? fmtNif(f.B) : null,
    nif_issuer: fmtNif(f.A),
    total_incl: total,
    total_excl: total !== null ? Math.round((total - tax) * 100) / 100 : null,
    vat_breakdown: tax > 0,
    currency: "EUR",
    atcud: f.H ?? null,
  };
}

function scanCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return r ? r.data : null;
}

function drawScaled(src: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

async function qrFromBitmap(bmp: ImageBitmap | HTMLCanvasElement, w: number, h: number): Promise<string | null> {
  // várias resoluções: QR pequenos precisam de resolução alta, fotos grandes leem-se melhor reduzidas
  for (const side of [1600, 2400, 1000, 3200]) {
    const hit = scanCanvas(drawScaled(bmp, w, h, side));
    if (hit) return hit;
  }
  // metade inferior ampliada (o QR costuma estar no fundo do talão)
  const c = document.createElement("canvas");
  c.width = Math.min(w, 1600);
  c.height = Math.round((h / 2) * (c.width / w));
  c.getContext("2d")?.drawImage(bmp, 0, h / 2, w, h / 2, 0, 0, c.width, c.height);
  return scanCanvas(c);
}

// ── PDF (pdf.js) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdf(blob: Blob): Promise<any> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPdfPage(pdf: any, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.ceil(viewport.width);
  c.height = Math.ceil(viewport.height);
  const ctx = c.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return c;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pdfText(pdf: any): Promise<string> {
  let out = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastY: number | null = null;
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      const y = it.transform ? it.transform[5] : null;
      out += (lastY !== null && y !== null && Math.abs(y - lastY) > 2 ? "\n" : " ") + (it.str ?? "");
      lastY = y;
    }
    out += "\n";
  }
  return out;
}

// ── Tesseract ──
async function ocrText(src: Blob | HTMLCanvasElement, progress: Progress): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  progress("A ler o texto do recibo…");
  const worker = await createWorker("por");
  try {
    const r = await worker.recognize(src);
    return r.data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

// ── Interpretação do texto ──
// Rejeita lixo do OCR ("2rT gROOQ! 1 FA ISTI…"): palavras reais, poucas misturas de maiúsculas/dígitos/símbolos
function looksLikeName(l: string): boolean {
  const s = l.trim();
  if (s.length < 3 || s.length > 60) return false;
  const letters = (s.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (letters / s.length < 0.7) return false;
  if (/[!?<>{}[\]|\\^~=_*#$%]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 6) return false;
  const good = words.filter((w) => {
    const c = w.replace(/[.,&'’-]/g, "");
    if (!/^[A-Za-zÀ-ÿ]+$/.test(c)) return false;
    if (c.length > 1 && !/[aeiouyàáâãéêíóôõúAEIOUYÀÁÂÃÉÊÍÓÔÕÚ]/.test(c)) return false;
    // aceita TUDO MAIÚSCULAS, Capitalizado ou minúsculas — não mistura tipo "gROOQ"
    return c === c.toUpperCase() || c === c.toLowerCase() || c === c[0].toUpperCase() + c.slice(1).toLowerCase();
  }).length;
  return good / words.length >= 0.75;
}

// Primeira página de um PDF como imagem (pré-visualização)
export async function pdfPreview(blob: Blob): Promise<string> {
  const pdf = await loadPdf(blob);
  const c = await renderPdfPage(pdf, 1, 1);
  return c.toDataURL("image/jpeg", 0.8);
}
const MONEY = /(\d{1,3}(?:[ .]\d{3})*[,.]\d{2})(?!\d)/g;
const toNum = (s: string) => Number(s.replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));

export function parseText(text: string): Partial<LocalRead> {
  const t = text.replace(/\r/g, "");
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const low = t.toLowerCase();
  const out: Partial<LocalRead> = {};
  // data
  const dm = t.match(/\b(\d{4})[-/.](\d{2})[-/.](\d{2})\b/) ?? null;
  const dm2 = t.match(/\b(\d{2})[-/.](\d{2})[-/.](\d{4})\b/) ?? null;
  if (dm) out.date = `${dm[1]}-${dm[2]}-${dm[3]}`;
  else if (dm2) out.date = `${dm2[3]}-${dm2[2]}-${dm2[1]}`;
  // total: linha com "total" (sem "iva"/"sem"), maior valor encontrado nessas linhas
  let best: number | null = null;
  for (const l of lines) {
    const ll = l.toLowerCase();
    if (/total|a pagar|valor pago|montante/.test(ll) && !/sub ?total|s\/ ?iva|sem iva|base|incid|iva \d/.test(ll)) {
      const ms = [...l.matchAll(MONEY)].map((m) => toNum(m[1])).filter((n) => n > 0 && n < 100000);
      for (const n of ms) if (best === null || n > best) best = n;
    }
  }
  if (best !== null) out.total_incl = best;
  // NIFs de 9 dígitos
  const nifs = [...t.matchAll(/\b([1235689]\d{2}) ?(\d{3}) ?(\d{3})\b/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  if (nifs.length) out.nif_issuer = nifs[0];
  if (nifs.length > 1) out.nif_buyer = nifs[nifs.length - 1];
  // Denominação legal: linha com a forma jurídica (Lda, Unipessoal, S.A.…), juntando a linha anterior se o nome vier partido
  const LEGAL = /\b(l\.?da|limitada|unipessoal|s\.\s?a\.?|sa|s\.?g\.?p\.?s|sociedade|crl)\.?\s*$/i;
  const ADDR = /\d{4}-\d{3}|^(av|rua|r\.|largo|praça|pc|estrada|travessa|calçada)\b|nif|nipc|contribuinte|capital|matr[ií]cula|tel[ef.:]/i;
  const top = lines.slice(0, 20);
  let legalIdx = -1;
  for (let i = 0; i < top.length; i++) {
    if (LEGAL.test(top[i]) && !ADDR.test(top[i])) {
      legalIdx = i;
      let name = top[i];
      // só junta a linha anterior se esta linha, sem a forma jurídica, tiver uma só palavra ("Nabeiro, Unipessoal Lda.")
      let core = top[i];
      for (let k = 0; k < 3; k++) core = core.replace(/[\s,]*(l\.?da|limitada|unipessoal|s\.\s?a|sa|s\.?g\.?p\.?s|sociedade|crl)\.?\s*$/i, "");
      const partial = core.trim().split(/\s+/).filter(Boolean).length <= 1;
      if (partial && i > 0 && !ADDR.test(top[i - 1]) && /^[A-Za-zÀ-ÿ]/.test(top[i - 1]) && !/[,.]\s*$/.test(top[i - 1]) && top[i - 1].length < 45) {
        name = top[i - 1] + " " + top[i];
        legalIdx = i - 1;
      }
      out.legal_name = name.replace(/\s*,\s*/g, ", ").replace(/\s{2,}/g, " ").trim().slice(0, 90);
      break;
    }
  }
  // Designação comercial: linha legível acima da morada/denominação legal (os logótipos nem sempre se leem)
  const stop = top.findIndex((l) => ADDR.test(l));
  const lim = [legalIdx, stop].filter((x) => x >= 0).reduce((a, b) => Math.min(a, b), 8);
  const name = top.slice(0, lim).find((l) => looksLikeName(l) && /[A-ZÀ-Ý]/.test(l) && l.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 4 && !/fatura|recibo|original|duplicado|www|@/i.test(l));
  if (name) out.client = name.replace(/\s{2,}/g, " ").slice(0, 60);
  // categoria sugerida
  const has = (re: RegExp) => re.test(low);
  if (has(/gas[óo]leo|diesel/)) { out.suggested_type = "FDD"; out.suggested_sub = "Fuel (diesel only)"; }
  else if (has(/gasolina|sem chumbo|\bgpl\b/)) { out.suggested_type = "FDD"; out.suggested_sub = "Fuel (other)"; }
  else if (has(/estacionamento|parque|parking|emel|saba|empark/)) { out.suggested_type = "FDD"; out.suggested_sub = "Others travel expenses"; out.others_kind = "Estacionamento"; }
  else if (has(/portagem|brisa|ascendi|via verde/)) { out.suggested_type = "FDD"; out.suggested_sub = "Others travel expenses"; out.others_kind = "Portagem"; }
  else if (has(/t[áa]xi|uber|bolt|free ?now/)) { out.suggested_type = "FDD"; out.suggested_sub = "Others travel expenses"; out.others_kind = "Táxi / Uber"; }
  else if (has(/metropolitano|\bmetro\b|navegante|carris/)) { out.suggested_type = "FDD"; out.suggested_sub = "Others travel expenses"; out.others_kind = "Metro"; }
  else if (has(/hotel|alojamento|pousada|hostel|estadia/)) { out.suggested_type = "FDD"; out.suggested_sub = "Hotels"; }
  else if (has(/comboio|\bcp\b|alfa pendular|intercidades|comboios de portugal/)) { out.suggested_type = "FDD"; out.suggested_sub = "Train Ticket"; }
  else if (has(/\btap\b|ryanair|easyjet|voo|flight|boarding/)) { out.suggested_type = "FDD"; out.suggested_sub = "Flight ticket"; }
  else if (has(/restaurante|tasca|marisqueira|churrasqueira|pizzaria|sushi|refei[çc][ãa]o|couvert|prato|sobremesa|bebida|caf[ée]\b|menu/)) { out.suggested_type = "FDD"; out.suggested_sub = "Restaurants"; }
  else if (has(/papelaria|toner|staples|material de escrit/)) { out.suggested_type = "OFF"; out.suggested_sub = "Office supplies"; }
  return out;
}

// ── Entrada principal ──
export async function readReceiptLocally(blob: Blob, type: string, progress: Progress): Promise<LocalRead> {
  let qr: LocalRead | null = null;
  let text = "";
  progress("A procurar o código QR…");
  if (type === "application/pdf") {
    const pdf = await loadPdf(blob);
    text = await pdfText(pdf);
    for (let i = 1; i <= Math.min(pdf.numPages, 2) && !qr; i++) {
      const c = await renderPdfPage(pdf, i, 2.5);
      const raw = await qrFromBitmap(c, c.width, c.height);
      if (raw) qr = parseFiscalQR(raw);
    }
    if (text.replace(/\s/g, "").length < 40) {
      // PDF digitalizado (só imagem): OCR da primeira página
      text = await ocrText(await renderPdfPage(pdf, 1, 2), progress);
    }
  } else {
    const bmp = await createImageBitmap(blob);
    const raw = await qrFromBitmap(bmp, bmp.width, bmp.height);
    if (raw) qr = parseFiscalQR(raw);
    text = await ocrText(drawScaled(bmp, bmp.width, bmp.height, 2000), progress);
  }
  const fromText = parseText(text);
  if (qr) {
    // QR manda nos valores; o texto só acrescenta nome e categoria
    return { ...qr, client: fromText.client ?? null, legal_name: fromText.legal_name ?? null, suggested_type: fromText.suggested_type ?? null, suggested_sub: fromText.suggested_sub ?? null, others_kind: fromText.others_kind ?? null };
  }
  const anything = fromText.date || fromText.total_incl || fromText.client;
  return { source: anything ? "texto" : "nenhum", currency: "EUR", vat_breakdown: null, total_excl: null, ...fromText };
}
