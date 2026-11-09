// Regras do procedimento de reembolso (RH Legendre PT) — usadas no ecrã e antes de submeter
import type { Claim, Company, CostCenter, Details, ExpType, Line, Person, Settings, Trip } from "../types";
import { parseISO } from "./format";
import { tr } from "./i18n";

export const TYPES: Record<ExpType, { label: string; short: string; hint: string; subs: string[] }> = {
  FDD: {
    label: "Travel E (FDD)",
    short: "Travel",
    get hint() { return tr("Deslocação profissional: viagens, alojamento, refeições e transportes durante uma missão", "Business travel: trips, accommodation, meals and transport during an assignment"); },
    subs: ["Flight ticket", "Train Ticket", "Car renting", "Hotels", "Restaurants", "Fuel (diesel only)", "Fuel (other)", "Others travel expenses"],
  },
  FDM: {
    label: "Representation E-M (FDM)",
    short: "Representation",
    get hint() { return tr("Representação: refeições ou eventos com pessoas externas (clientes, parceiros, investidores)", "Representation: meals or events with external people (clients, partners, investors)"); },
    subs: ["Flight ticket", "Train Ticket", "Car renting", "Hotels", "Restaurants", "Fuel (renting cars only)", "Others travel expenses"],
  },
  OFF: {
    label: "Office E",
    short: "Office",
    get hint() { return tr("Escritório: material, telefone, comida para o escritório, fundo mútuo", "Office: supplies, phone, food for the office, mutual fund"); },
    subs: ["Mutual fund", "Office supplies", "Phone", "Food for office"],
  },
};
export const TYPE_KEYS: ExpType[] = ["FDD", "FDM", "OFF"];

export const VAT_DED: Record<string, number> = { "Fuel (diesel only)": 0.5, "Office supplies": 1, Phone: 1, "Food for office": 1 };
export const OTHERS_KINDS = ["Estacionamento", "Portagem", "Táxi / Uber", "Metro", "Autocarro", "Outro"];
// Valores gravados em PT (vão para o Excel); só o texto mostrado muda
const OTHERS_EN: Record<string, string> = { Estacionamento: "Parking", Portagem: "Toll", "Táxi / Uber": "Taxi / Uber", Metro: "Metro", Autocarro: "Bus", Outro: "Other" };
export const optionLabel = (v: string) => tr(v, OTHERS_EN[v] ?? v);

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
      { k: "invite", label: tr("Convite", "Invitation"), kind: "seg", options: ["Internal", "External"] },
      { k: "motivo", label: tr("Motivo da refeição", "Reason for the meal"), ph: tr("ex.: Jantar investidor", "e.g. Investor dinner") },
      { k: "people", label: tr("Número de pessoas", "Number of people"), kind: "int" },
      { k: "participants", label: tr("Participantes", "Participants"), kind: "people" },
    ];
  if (sub === "Flight ticket" || sub === "Train Ticket")
    return [
      { k: "motivo", label: tr("Motivo da viagem", "Reason for the trip"), ph: sub === "Flight ticket" ? tr("ex.: Convenção Managers Paris", "e.g. Managers convention Paris") : tr("ex.: Visita Obra Hotel Aurora", "e.g. Site visit Hotel Aurora") },
      { k: "origem", label: tr("Origem", "From"), ph: sub === "Flight ticket" ? "Lisboa" : "Lisboa Oriente" },
      { k: "destino", label: tr("Destino", "To"), ph: sub === "Flight ticket" ? "Paris Orly" : "Porto Campanhã" },
    ];
  if (sub === "Hotels")
    return [
      { k: "cidade", label: tr("Cidade", "City"), ph: "Porto" },
      { k: "motivo", label: tr("Motivo da estadia", "Reason for the stay"), ph: tr("Reunião cliente ABC", "Meeting with client ABC") },
    ];
  if (sub === "Car renting")
    return [
      { k: "local", label: tr("Local / período", "Place / period"), ph: tr("Porto, 3 a 5 nov", "Porto, 3–5 Nov") },
      { k: "motivo", label: tr("Motivo", "Reason"), ph: tr("Visitas de obra Norte", "Site visits North") },
    ];
  if (sub.startsWith("Fuel")) return [{ k: "motivo", label: tr("Deslocação / motivo", "Trip / reason"), ph: tr("Deslocação obra Sines", "Trip to Sines site") }];
  if (sub === "Others travel expenses")
    return [
      { k: "kind", label: tr("Tipo", "Type"), kind: "seg", options: OTHERS_KINDS },
      { k: "local", label: tr("Local ou trajeto", "Place or route"), ph: tr("Porto, Rua X  /  aeroporto > hotel", "Porto, Rua X  /  airport > hotel") },
      { k: "motivo", label: tr("Motivo / projeto associado", "Reason / related project"), ph: tr("Visita projeto Hotel Aurora", "Visit to Hotel Aurora project") },
    ];
  return [{ k: "descricao", label: tr("Descrição", "Description"), ph: sub === "Food for office" ? tr("Café e água escritório Lisboa", "Coffee and water, Lisbon office") : tr("Descrição da compra", "Description of the purchase") }];
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
    if (v === undefined || v === null || String(v).trim() === "") out.push(tr(`Details: falta "${f.label.toLowerCase()}"`, `Details: missing "${f.label.toLowerCase()}"`));
  }
  if (sub === "Restaurants") {
    const n = Number(d.people) || 0;
    const listed = (d.participants ?? []).filter((p) => p.name && p.name.trim()).length;
    if (n && listed < n) out.push(tr(`Indicou ${n} pessoas e listou ${listed}`, `${n} people entered but ${listed} listed`));
    if (d.invite === "External" && !(d.participants ?? []).some((p) => p.company && p.company.trim())) out.push(tr("Indique a empresa dos participantes externos", "Enter the company of the external participants"));
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

// k = grupo da regra (usado na checklist, independente da língua)
export type IssueKey = "img" | "date" | "cat" | "details" | "values" | "nif" | "sub";
export type Issue = { lv: "err" | "warn"; msg: string; k: IssueKey };
export type RuleCtx = { settings: Settings; company: Company | null; today: string };

const digits = (s: string) => s.replace(/\D/g, "");
// Recibo sem NIF do adquirente (ex.: compra online num site estrangeiro que não pede NIF)
export const NIF_NA = "N/A";
export const isNifNA = (n: string | null | undefined) => /^n\s*\/?\s*a$/i.test((n ?? "").trim());

export function lineIssues(l: Line, ctx: RuleCtx): Issue[] {
  const { settings, company, today } = ctx;
  const out: Issue[] = [];
  if (!l.file_path) out.push({ lv: "err", k: "img", msg: tr("Falta imagem do recibo", "Receipt image missing") });
  if (!l.receipt_date) out.push({ lv: "err", k: "date", msg: tr("Data do recibo em falta", "Receipt date missing") });
  else {
    const d = parseISO(l.receipt_date);
    const t = parseISO(today);
    if (d > t) out.push({ lv: "err", k: "date", msg: tr("Data no futuro", "Date in the future") });
    const lim = new Date(t);
    lim.setMonth(lim.getMonth() - settings.max_age_months);
    if (d < lim) out.push({ lv: "err", k: "date", msg: tr(`Recibo com mais de ${settings.max_age_months} meses`, `Receipt older than ${settings.max_age_months} months`) });
  }
  if (!l.type || !l.sub) out.push({ lv: "err", k: "cat", msg: tr("Categoria em falta", "Category missing") });
  else detailIssues(l.sub, l.details ?? {}).forEach((m) => out.push({ lv: "err", k: "details", msg: m }));
  if (!l.client || !l.client.trim()) out.push({ lv: "err", k: "values", msg: tr("Entidade (client) em falta", "Supplier (client) missing") });
  const ex = Number(l.excl);
  const inc = Number(l.incl);
  if (!(inc > 0) || !(ex > 0)) out.push({ lv: "err", k: "values", msg: tr("Valores em falta", "Amounts missing") });
  else if (ex > inc + 0.001) out.push({ lv: "err", k: "values", msg: tr("Valor sem IVA superior ao valor com IVA", "Amount excl. VAT is higher than amount incl. VAT") });
  else {
    const r = ((inc - ex) / ex) * 100;
    if (r > 0.5 && ![6, 13, 23].some((v) => Math.abs(v - r) < 0.6)) out.push({ lv: "warn", k: "values", msg: tr(`Taxa de IVA invulgar (${r.toFixed(1)} %)`, `Unusual VAT rate (${r.toFixed(1)} %)`) });
  }
  if (l.currency !== "EUR" && !(Number(l.rate) > 0)) out.push({ lv: "err", k: "values", msg: tr("Taxa de câmbio em falta", "Exchange rate missing") });
  if (!l.nif) out.push({ lv: "err", k: "nif", msg: tr("NIF da empresa em falta no recibo", "Company VAT number (NIF) missing on the receipt") });
  else if (isNifNA(l.nif)) out.push({ lv: "warn", k: "nif", msg: tr("Recibo sem NIF da empresa (N/A)", "Receipt without company VAT number (N/A)") });
  else if (company && digits(l.nif) !== digits(company.nif)) out.push({ lv: "err", k: "nif", msg: tr(`NIF não é o da ${company.name}`, `VAT number is not ${company.name}'s`) });
  if (l.sub === "Others travel expenses") {
    const s = suggestSub(l.client);
    if (s) out.push({ lv: "warn", k: "sub", msg: tr(`Parece "${s}": use a subcategoria própria`, `Looks like "${s}": use the specific subcategory`) });
    if (l.details?.kind === "Outro") out.push({ lv: "warn", k: "sub", msg: tr('"Outro": confirme que não existe subcategoria própria', '"Other": check there is no specific subcategory') });
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
  const has = (keys: IssueKey[], lv: "err" | "warn" = "err") =>
    li.filter((x) => x.is.some((i) => i.lv === lv && keys.includes(i.k))).map((x) => `${tr("Linha", "Line")} ${x.l.no}`);
  const t = parseISO(ctx.today);
  const [py, pm] = c.period.split("-").map(Number);
  const periodPast = t.getFullYear() * 12 + t.getMonth() > py * 12 + pm - 1;
  void periodPast;
  const veh = ctx.vehicle;
  const items: CheckItem[] = [
    { ok: !!(u && u.full_name && u.matricula && cc && company), label: tr("Cabeçalho completo: mês, ano, nome, matrícula, empresa e cost center", "Complete header: month, year, name, employee number, company and cost center"), refs: u && !u.matricula ? [tr("Matrícula em falta no perfil", "Employee number missing in profile")] : [], warn: [] },
    { ok: c.lines.length + c.trips.length > 0, label: tr("Pelo menos um recibo ou trajeto registado", "At least one receipt or trip recorded"), refs: [], warn: [] },
    { ok: c.lines.length <= ctx.settings.max_lines, label: tr(`Máximo de ${ctx.settings.max_lines} recibos por formulário`, `Maximum of ${ctx.settings.max_lines} receipts per form`), refs: c.lines.length > ctx.settings.max_lines ? [`${c.lines.length} ${tr("recibos", "receipts")}`] : [], warn: [] },
    { ok: !has(["img"]).length, label: tr("Cada recibo tem a imagem anexada", "Every receipt has its image attached"), refs: has(["img"]), warn: [] },
    { ok: !has(["date"]).length, label: tr(`Datas reais dos recibos, com menos de ${ctx.settings.max_age_months} meses`, `Actual receipt dates, less than ${ctx.settings.max_age_months} months old`), refs: has(["date"]), warn: [] },
    { ok: !has(["cat"]).length, label: tr("Categorias do quadro de referência", "Categories from the reference table"), refs: has(["cat"]), warn: has(["sub"], "warn") },
    { ok: !has(["details"]).length, label: tr("Details completos, com participantes nas refeições", "Complete details, with participants for meals"), refs: has(["details"]), warn: [] },
    { ok: !has(["values"]).length, label: tr("Valores e IVA coerentes (sem IVA = com IVA quando não discriminado)", "Consistent amounts and VAT (excl. VAT = incl. VAT when VAT is not shown)"), refs: has(["values"]), warn: has(["values"], "warn") },
    { ok: !has(["nif"]).length, label: tr("NIF da empresa em todos os recibos", "Company VAT number (NIF) on every receipt"), refs: has(["nif"]), warn: has(["nif"], "warn") },
    { ok: !c.trips.length || !!(veh && veh.model && plateOk(veh.plate)), label: tr("Viatura identificada para os quilómetros (matrícula XX-XX-XX)", "Vehicle identified for mileage (plate XX-XX-XX)"), refs: [], warn: [] },
    { ok: !c.trips.length || c.insurance_declared, label: tr("Declaração de seguro automóvel para quilómetros", "Car insurance declaration for mileage"), refs: [], warn: [] },
  ];
  return { items, ready: items.every((i) => i.ok), lineIssues: li, company };
}

export const STATUS: Record<string, { label: string; tone: "info" | "warn" | "err" | "ok" }> = {
  draft: { get label() { return tr("Rascunho", "Draft"); }, tone: "info" },
  returned: { get label() { return tr("Devolvido", "Returned"); }, tone: "err" },
  submitted: { get label() { return tr("Aguarda manager", "Awaiting manager"); }, tone: "warn" },
  approved_mgr: { get label() { return tr("Aguarda registo RH", "Awaiting HR"); }, tone: "warn" },
  validated_rh: { get label() { return tr("Aguarda pagamento", "Awaiting payment"); }, tone: "warn" },
  posted: { get label() { return tr("Pago", "Paid"); }, tone: "ok" },
};
export const ROLES: Record<string, string> = {
  get colaborador() { return tr("Colaborador", "Employee"); },
  manager: "Manager",
  get rh() { return tr("Recursos Humanos", "Human Resources"); },
  get contabilidade() { return tr("Administrativo (pagamentos)", "Accounts (payments)"); },
  get admin() { return tr("Administrador", "Administrator"); },
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
