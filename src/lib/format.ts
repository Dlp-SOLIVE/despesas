import { getLang } from "./i18n";
// Datas e valores no formato usado pela Legendre PT
const eurFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const eur = (v: number | null | undefined) => eurFmt.format(Number(v ?? 0));
export const num1 = (v: number | null | undefined) =>
  new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(v ?? 0));

export const pad = (n: number) => String(n).padStart(2, "0");
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoToday = () => toISO(new Date());
export const parseISO = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
export const fmtDateTime = (s: string) => {
  const d = new Date(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const MONTHS_EN = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
export const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const periodOf = (iso: string) => iso.slice(0, 7);
export const periodLabel = (p: string) => {
  const [y, m] = p.split("-");
  const s = getLang() === "en" ? (MONTHS_EN[Number(m) - 1] ?? "").toLowerCase() : MONTHS_PT[Number(m) - 1] ?? "";
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${y}`;
};
export const shiftPeriod = (p: string, delta: number) => {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
