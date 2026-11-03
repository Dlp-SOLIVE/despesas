// Regras do procedimento de reembolso (RH Legendre PT) — usadas no ecrã e antes de submeter
import type { Claim, Company, CostCenter, Details, ExpType, Line, Person, Settings, Trip } from "../types";
import { MONTHS_PT, parseISO } from "./format";

export const TYPES: Record<ExpType, { label: string; short: string; hint: string; subs: string[] }> = {
  FDD: {
    label: "Travel E (FDD)",
    short: "Travel",
    hint: "Deslocação profissional: viagens, alojamento, refeições e transportes durante uma missão",
    subs: ["Flight ticket", "Train Ticket", "Car renting", "Hotels", "Restaurants", "Fuel (diesel only)", "Fuel (other)", "Others travel expenses"],
  },
  FDM: {
    label: "Representation E-M (FDM)",
    short: "Representation",
    hint: "Representação: refeições ou eventos com pessoas externas (clientes, parceiros, investidores)",
    subs: ["Flight ticket", "Train Ticket", "Car renting", "Hotels", "Restaurants", "Fuel (renting cars only)", "Others travel expenses"],
  },
  OFF: {
    label: "Office E",
    short: "Office",
    hint: "Escritório: material, telefone, comida para o escritório, fundo mútuo",
    subs: ["Mutual fund", "Office supplies", "Phone", "Food for office"],
  },
};
export const TYPE_KEYS: ExpType[] = ["FDD", "FDM", "OFF"];

export const VAT_DED: Record<string, number> = { "Fuel (diesel only)": 0.5, "Office supplies": 1, Phone: 1, "Food for office": 1 };
export const OTHERS_KINDS = ["Estacionamento", "Portagem", "Táxi / Uber", "Metro", "Autocarro", "Outro"];

export type DetailField = {
  k: keyof Details;
  label: string;
  kind?: "seg" | "int" | "people";
  options?: string[];
  ph?: string;
};

export function detailSchema(sub: string | null): DetailField[] {
  if (!sub) return [];
  if (sub === "Restaurants")
    return [
      { k: "invite", label: "Convite", kind: "seg", options: ["Internal", "External"] },
      { k: "motivo", label: "Motivo da refeição", ph: "ex.: Jantar investidor" },
      { k: "people", label: "Número de pessoas", kind: "int" },
      { k: "participants", label: "Participantes", kind: "people" },
    ];
  if (sub === "Flight ticket" || sub === "Train Ticket")
    return [
      { k: "motivo", label: "Motivo da viagem", ph: sub === "Flight ticket" ? "ex.: Convenção Managers Paris" : "ex.: Visita Obra Hotel Aurora" },
      { k: "origem", label: "Origem", ph: sub === "Flight ticket" ? "Lisboa" : "Lisboa Oriente" },
      { k: "destino", label: "Destino", ph: sub === "Flight ticket" ? "Paris Orly" : "Porto Campanhã" },
    ];
  if (sub === "Hotels")
    return [
      { k: "cidade", label: "Cidade", ph: "Porto" },
      { k: "motivo", label: "Motivo da estadia", ph: "Reunião cliente ABC" },
    ];
  if (sub === "Car renting")
    return [
      { k: "local", label: "Local / período", ph: "Porto, 3 a 5 nov" },
      { k: "motivo", label: "Motivo", ph: "Visitas de obra Norte" },
    ];
  if (sub.startsWith("Fuel")) return [{ k: "motivo", label: "Deslocação / motivo", ph: "Deslocação obra Sines" }];
  if (sub === "Others travel expenses")
    return [
      { k: "kind", label: "Tipo", kind: "seg", options: OTHERS_KINDS },
      { k: "local", label: "Local ou trajeto", ph: "Porto, Rua X  /  aeroporto > hotel" },
      { k: "motivo", label: "Motivo / projeto associado", ph: "Visita projeto Hotel Aurora" },
    ];
  return [{ k: "descricao", label: "Descrição", ph: sub === "Food for office" ? "Café e água escritório Lisboa" : "Descrição da compra" }];
}

export function detailText(sub: string | null, d: Details = {}): string {
  const x = (v?: string) => (v && v.trim() ? v.trim() : "…");
  if (!sub) return "";
  if (sub === "Restaurants") {
    const names = (d.participants ?? []).filter((p) => p.name).map((p) => (p.company ? `${p.name}, ${p.company}` : p.name)).join(" + ");
    return `${x(d.invite)} Invit ${x(d.people)} people - ${x(d.motivo)}${names ? ` (${names})` : ""}`;
  }
  if (sub === "Flight ticket") return `${x(d.motivo)} - Voo ${x(d.origem)} > ${x(d.destino)}`;
  if (sub === "Train Ticket") return `${x(d.motivo)} - Comboio ${x(d.origem)} > ${x(d.destino)}`;
  if (sub === "Hotels") return `Noite ${x(d.cidade)} - ${x(d.motivo)}`;
  if (sub === "Car renting") return `Aluguer viatura ${x(d.local)} - ${x(d.motivo)}`;
  if (sub.startsWith("Fuel")) return `Viatura alugada - ${x(d.motivo)}`;
  if (sub === "Others travel expenses") return `${[d.kind, d.local].filter(Boolean).join(" ") || "…"} - ${x(d.motivo)}`;
  return d.descricao ?? "";
}

function detailIssues(sub: string, d: Details): string[] {
  const out: string[] = [];
  for (const f of detailSchema(sub)) {
    if (f.kind === "people") continue;
    const v = d[f.k];
    if (v === undefined || v === null || String(v).trim() === "") out.push(`Details: falta "${f.label.toLowerCase()}"`);
  }
  if (sub === "Restaurants") {
    const n = Number(d.people) || 0;
    const listed = (d.participants ?? []).filter((p) => p.name && p.name.trim()).length;
    if (n && listed < n) out.push(`Indicou ${n} pessoas e listou ${listed}`);
    if (d.invite === "External" && !(d.participants ?? []).some((p) => p.company && p.company.trim())) out.push("Indique a empresa dos participantes externos");
  }
  return out;
}

export const lineRate = (l: Line) => (l.currency === "EUR" ? 1 : Number(l.rate) || 0);
export const lineEUR = (l: Line) => Math.round((Number(l.incl) || 0) * lineRate(l) * 100) / 100;
export const lineVATded = (l: Line) => ((Number(l.incl) || 0) - (Number(l.excl) || 0)) * lineRate(l) * (VAT_DED[l.sub ?? ""] ?? 0);
export const tripKm = (t: Trip) => (Number(t.km) || 0) * (t.round_trip ? 2 : 1);

export type Totals = { FDD: number; FDM: number; OFF: number; n: Record<ExpType, number>; km: number; kmRate: number; kmEUR: number; vat: number; total: number };

export function claimTotals(c: Claim, settings: Settings): Totals {
  const t: Totals = { FDD: 0, FDM: 0, OFF: 0, n: { FDD: 0, FDM: 0, OFF: 0 }, km: 0, kmRate: 0, kmEUR: 0, vat: 0, total: 0 };
  for (const l of c.lines) {
    if (l.type) {
      t[l.type] += lineEUR(l);
      t.n[l.type] += 1;
    }
    t.vat += lineVATded(l);
  }
  t.km = c.trips.reduce((a, x) => a + tripKm(x), 0);
  t.kmRate = Number(c.km_rate ?? settings.km_rate);
  t.kmEUR = Math.round(t.km * t.kmRate * 100) / 100;
  t.total = t.FDD + t.FDM + t.OFF + t.kmEUR;
  return t;
}

export function suggestSub(client: string | null): string | null {
  const c = (client ?? "").toLowerCase();
  if (/restaur|tasca|cantinho|café|pizz|sushi|bistro|churrasq/.test(c)) return "Restaurants";
  if (/hotel|pousada|ibis|novotel|hostel|booking/.test(c)) return "Hotels";
  if (/galp|repsol|\bbp\b|cepsa|prio/.test(c)) return "Fuel";
  if (/\btap\b|ryanair|easyjet|air france|vueling|transavia/.test(c)) return "Flight ticket";
  if (/^cp$|comboios|sncf|renfe/.test(c)) return "Train Ticket";
  return null;
}

export type Issue = { lv: "err" | "warn"; msg: string };
export type RuleCtx = { settings: Settings; company: Company | null; today: string };

const digits = (s: string) => s.replace(/\D/g, "");

export function lineIssues(l: Line, ctx: RuleCtx): Issue[] {
  const { settings, company, today } = ctx;
  const out: Issue[] = [];
  if (!l.file_path) out.push({ lv: "err", msg: "Falta imagem do recibo" });
  if (!l.receipt_date) out.push({ lv: "err", msg: "Data do recibo em falta" });
  else {
    const d = parseISO(l.receipt_date);
    const t = parseISO(today);
    if (d > t) out.push({ lv: "err", msg: "Data no futuro" });
    const lim = new Date(t);
    lim.setMonth(lim.getMonth() - settings.max_age_months);
    if (d < lim) out.push({ lv: "err", msg: `Recibo com mais de ${settings.max_age_months} meses` });
  }
  if (!l.type || !l.sub) out.push({ lv: "err", msg: "Categoria em falta" });
  else detailIssues(l.sub, l.details ?? {}).forEach((m) => out.push({ lv: "err", msg: m }));
  if (!l.client || !l.client.trim()) out.push({ lv: "err", msg: "Entidade (client) em falta" });
  const ex = Number(l.excl);
  const inc = Number(l.incl);
  if (!(inc > 0) || !(ex > 0)) out.push({ lv: "err", msg: "Valores em falta" });
  else if (ex > inc + 0.001) out.push({ lv: "err", msg: "Valor sem IVA superior ao valor com IVA" });
  else {
    const r = ((inc - ex) / ex) * 100;
    if (r > 0.5 && ![6, 13, 23].some((v) => Math.abs(v - r) < 0.6)) out.push({ lv: "warn", msg: `Taxa de IVA invulgar (${r.toFixed(1)} %)` });
  }
  if (l.currency !== "EUR" && !(Number(l.rate) > 0)) out.push({ lv: "err", msg: "Taxa de câmbio em falta" });
  if (!l.nif) out.push({ lv: "err", msg: "NIF da empresa em falta no recibo" });
  else if (company && digits(l.nif) !== digits(company.nif)) out.push({ lv: "err", msg: `NIF não é o da ${company.name}` });
  if (l.sub === "Others travel expenses") {
    const s = suggestSub(l.client);
    if (s) out.push({ lv: "warn", msg: `Parece "${s}": use a subcategoria própria` });
    if (l.details?.kind === "Outro") out.push({ lv: "warn", msg: '"Outro": confirme que não existe subcategoria própria' });
  }
  return out;
}

export type CheckItem = { ok: boolean; label: string; refs: string[]; warn: string[] };

export function claimChecklist(
  c: Claim,
  ctx: { settings: Settings; people: Person[]; costCenters: CostCenter[]; companies: Company[]; today: string; vehicle: { model: string; plate: string } | null },
) {
  const u = ctx.people.find((p) => p.id === c.staff_member_id);
  const cc = ctx.costCenters.find((x) => x.code === c.cost_center);
  const company = ctx.companies.find((x) => x.id === (cc ? cc.company_id : u?.company_id)) ?? null;
  const rc: RuleCtx = { settings: ctx.settings, company, today: ctx.today };
  const li = [...c.lines].sort((a, b) => a.no - b.no).map((l) => ({ l, is: lineIssues(l, rc) }));
  const has = (re: RegExp, lv: "err" | "warn" = "err") =>
    li.filter((x) => x.is.some((i) => i.lv === lv && re.test(i.msg))).map((x) => `Linha ${x.l.no}`);
  const t = parseISO(ctx.today);
  const [py, pm] = c.period.split("-").map(Number);
  const periodPast = t.getFullYear() * 12 + t.getMonth() > py * 12 + pm - 1;
  void periodPast;
  const veh = ctx.vehicle;
  const items: CheckItem[] = [
    { ok: !!(u && u.full_name && u.matricula && cc && company), label: "Cabeçalho completo: mês, ano, nome, matrícula, empresa e cost center", refs: u && !u.matricula ? ["Matrícula em falta no perfil"] : [], warn: [] },
    { ok: c.lines.length + c.trips.length > 0, label: "Pelo menos um recibo ou trajeto registado", refs: [], warn: [] },
    { ok: c.lines.length <= ctx.settings.max_lines, label: `Máximo de ${ctx.settings.max_lines} recibos por formulário`, refs: c.lines.length > ctx.settings.max_lines ? [`${c.lines.length} recibos`] : [], warn: [] },
    { ok: !has(/imagem/).length, label: "Cada recibo tem a imagem anexada", refs: has(/imagem/), warn: [] },
    { ok: !has(/Data|meses|futuro/).length, label: `Datas reais dos recibos, com menos de ${ctx.settings.max_age_months} meses`, refs: has(/Data|meses|futuro/), warn: [] },
    { ok: !has(/Categoria/).length, label: "Categorias do quadro de referência", refs: has(/Categoria/), warn: has(/Parece|Outro/, "warn") },
    { ok: !has(/Details|pessoas|empresa dos/).length, label: "Details completos, com participantes nas refeições", refs: has(/Details|pessoas|empresa dos/), warn: [] },
    { ok: !has(/Valores|IVA|câmbio|Entidade/).length, label: "Valores e IVA coerentes (sem IVA = com IVA quando não discriminado)", refs: has(/Valores|IVA|câmbio|Entidade/), warn: has(/IVA/, "warn") },
    { ok: !has(/NIF/).length, label: "NIF da empresa em todos os recibos", refs: has(/NIF/), warn: has(/NIF/, "warn") },
    { ok: !c.trips.length || !!(veh && veh.model && plateOk(veh.plate)), label: "Viatura identificada para os quilómetros (matrícula XX-XX-XX)", refs: [], warn: [] },
    { ok: !c.trips.length || c.insurance_declared, label: "Declaração de seguro automóvel para quilómetros", refs: [], warn: [] },
  ];
  return { items, ready: items.every((i) => i.ok), lineIssues: li, company };
}

export const STATUS: Record<string, { label: string; tone: "info" | "warn" | "err" | "ok" }> = {
  draft: { label: "Rascunho", tone: "info" },
  returned: { label: "Devolvido", tone: "err" },
  submitted: { label: "Aguarda manager", tone: "warn" },
  approved_mgr: { label: "Aguarda registo RH", tone: "warn" },
  validated_rh: { label: "Aguarda pagamento", tone: "warn" },
  posted: { label: "Pago", tone: "ok" },
};
export const ROLES: Record<string, string> = {
  colaborador: "Colaborador",
  manager: "Manager",
  rh: "Recursos Humanos",
  contabilidade: "Administrativo (pagamentos)",
  admin: "Administrador",
};

export function packageName(c: Claim, u: Person | undefined) {
  return `${c.period.replace("-", "")} – Expense Claim Form – ${u?.full_name ?? ""} ${u?.matricula ?? ""}`.trim();
}

// Matrícula da viatura: XX-XX-XX (letras ou algarismos)
export const fmtPlate = (v: string) => {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return c.match(/.{1,2}/g)?.join("-") ?? "";
};
export const plateOk = (v: string) => /^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$/.test(v);
