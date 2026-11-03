// Acesso ao Supabase (tabelas exp_*, bucket despesas-recibos, função exp-ocr)
import type { AuditItem, Claim, Company, CostCenter, FavTrip, Line, Person, Refs, Settings, Trip, Vehicle } from "../types";
import { sb } from "./supabase";

const BUCKET = "despesas-recibos";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const DEFAULT_SETTINGS: Settings = { km_rate: 0.4, max_age_months: 3, open_day: 20, max_lines: 24, retention_years: 10 };

export async function loadMe(email: string): Promise<Person | null> {
  const res = await sb().from("exp_people").select("*").ilike("email", email).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as Person | null) ?? null;
}

export async function requestAccess(fullName: string, matricula: string, company: string, usesKm: boolean) {
  check(await sb().rpc("exp_request_access", { p_full_name: fullName, p_matricula: matricula, p_company: company, p_uses_km: usesKm }));
}

export async function loadRefs(): Promise<Refs> {
  const [co, cc, st, pp] = await Promise.all([
    sb().from("exp_companies").select("*").order("id"),
    sb().from("exp_cost_centers").select("*").order("code"),
    sb().from("exp_settings").select("*").eq("id", 1).maybeSingle(),
    sb().from("exp_people").select("*").order("full_name"),
  ]);
  const s = check(st) as Settings | null;
  return {
    companies: (check(co) as Company[]) ?? [],
    costCenters: (check(cc) as CostCenter[]) ?? [],
    settings: s
      ? { km_rate: Number(s.km_rate), max_age_months: Number(s.max_age_months), open_day: Number(s.open_day), max_lines: Number(s.max_lines), retention_years: Number(s.retention_years) }
      : DEFAULT_SETTINGS,
    people: (check(pp) as Person[]) ?? [],
  };
}

type ClaimRow = Omit<Claim, "lines" | "trips" | "history"> & { lines: Line[] | null; trips: Trip[] | null; history: Claim["history"] | null };

export async function loadClaims(): Promise<Claim[]> {
  const rows = check(
    await sb()
      .from("exp_claims")
      .select("*, lines:exp_lines(*), trips:exp_trips(*), history:exp_history(*)")
      .order("period", { ascending: false }),
  ) as ClaimRow[];
  return (rows ?? []).map((r) => ({
    ...r,
    lines: (r.lines ?? []).map((l) => ({ ...l, details: l.details ?? {}, excl: l.excl === null ? null : Number(l.excl), incl: l.incl === null ? null : Number(l.incl), rate: Number(l.rate) })).sort((a, b) => a.no - b.no),
    trips: (r.trips ?? []).map((t) => ({ ...t, km: Number(t.km) })),
    history: (r.history ?? []).sort((a, b) => a.at.localeCompare(b.at)),
  }));
}

export async function createClaim(staffId: string, costCenter: string, period: string): Promise<string> {
  // id gerado no browser: evita ler a linha no mesmo pedido do insert (RLS)
  const id = crypto.randomUUID();
  check(await sb().from("exp_claims").insert({ id, staff_member_id: staffId, cost_center: costCenter, period }));
  return id;
}

export async function setInsurance(claimId: string, value: boolean) {
  check(await sb().from("exp_claims").update({ insurance_declared: value }).eq("id", claimId));
}

export type LineInput = Omit<Line, "id" | "claim_id" | "approver_note"> & { id?: string };

export async function saveLine(claimId: string, line: LineInput) {
  const payload = {
    claim_id: claimId,
    no: line.no,
    receipt_date: line.receipt_date || null,
    type: line.type,
    sub: line.sub,
    details: line.details,
    client: line.client,
    nif: line.nif,
    currency: line.currency,
    rate: line.currency === "EUR" ? 1 : line.rate,
    excl: line.excl,
    incl: line.incl,
    file_path: line.file_path,
    file_type: line.file_type,
    ocr: line.ocr,
    approver_note: null,
  };
  if (line.id) check(await sb().from("exp_lines").update(payload).eq("id", line.id));
  else check(await sb().from("exp_lines").insert(payload));
}

export async function deleteLine(claim: Claim, line: Line) {
  check(await sb().from("exp_lines").delete().eq("id", line.id));
  if (line.file_path) await sb().storage.from(BUCKET).remove([line.file_path]);
  const rest = claim.lines.filter((l) => l.id !== line.id).sort((a, b) => a.no - b.no);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].no !== i + 1) check(await sb().from("exp_lines").update({ no: i + 1 }).eq("id", rest[i].id));
  }
}

export async function uploadReceipt(file: File, staffId: string, claimId: string): Promise<{ path: string; type: string }> {
  const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
  const path = `${staffId}/${claimId}/${crypto.randomUUID()}.${ext}`;
  check(await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }));
  return { path, type: file.type };
}

const urlCache = new Map<string, { url: string; until: number }>();
export async function receiptURL(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const res = await sb().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (res.error || !res.data) throw new Error(res.error?.message ?? "Sem acesso ao ficheiro");
  urlCache.set(path, { url: res.data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return res.data.signedUrl;
}

export async function downloadReceipt(path: string): Promise<Blob> {
  const res = await sb().storage.from(BUCKET).download(path);
  if (res.error || !res.data) throw new Error(res.error?.message ?? "Sem acesso ao ficheiro");
  return res.data;
}

export type OcrResult = {
  date?: string | null;
  client?: string | null;
  nif_buyer?: string | null;
  total_incl?: number | null;
  total_excl?: number | null;
  currency?: string | null;
  vat_breakdown?: boolean | null;
  suggested_type?: string | null;
  suggested_sub?: string | null;
  others_kind?: string | null;
  city?: string | null;
  route_from?: string | null;
  route_to?: string | null;
};

export async function runOcr(path: string): Promise<OcrResult> {
  const res = await sb().functions.invoke("exp-ocr", { body: { path } });
  if (res.error) throw new Error(res.error.message);
  const body = res.data as { ok: boolean; data?: OcrResult; error?: string };
  if (!body.ok || !body.data) throw new Error(body.error ?? "Não foi possível ler o recibo");
  return body.data;
}


export async function addTrip(claimId: string, t: Omit<Trip, "id" | "claim_id">) {
  check(await sb().from("exp_trips").insert({ claim_id: claimId, ...t }));
}
export async function deleteTrip(id: string) {
  check(await sb().from("exp_trips").delete().eq("id", id));
}

export async function loadVehicle(staffId: string): Promise<Vehicle | null> {
  const res = await sb().from("exp_vehicles").select("*").eq("staff_member_id", staffId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as Vehicle | null) ?? null;
}
export async function saveVehicle(v: Vehicle) {
  check(await sb().from("exp_vehicles").upsert(v));
}
export async function loadFavs(staffId: string): Promise<FavTrip[]> {
  return (check(await sb().from("exp_fav_trips").select("*").eq("staff_member_id", staffId).order("created_at")) as FavTrip[]).map((f) => ({ ...f, km: Number(f.km) }));
}
export async function addFav(f: Omit<FavTrip, "id">) {
  check(await sb().from("exp_fav_trips").insert(f));
}
export async function deleteFav(id: string) {
  check(await sb().from("exp_fav_trips").delete().eq("id", id));
}

export async function submitClaim(id: string) {
  check(await sb().rpc("exp_submit", { p_claim: id }));
}
export async function decideClaim(id: string, action: "approve" | "return", comment: string, notes: Record<string, string>, payment?: { paidOn: string; ref: string }) {
  check(await sb().rpc("exp_decide", { p_claim: id, p_action: action, p_comment: comment, p_notes: notes, p_paid_on: payment?.paidOn ?? null, p_payment_ref: payment?.ref ?? null }));
}
export async function adminReopen(id: string, reason: string) {
  check(await sb().rpc("exp_admin_reopen", { p_claim: id, p_reason: reason }));
}
export async function adminDelete(id: string, reason: string) {
  check(await sb().rpc("exp_admin_delete", { p_claim: id, p_reason: reason }));
}

export async function audit(actorId: string, action: string) {
  await sb().from("exp_audit").insert({ actor_id: actorId, action });
}
export async function loadAudit(): Promise<AuditItem[]> {
  return check(await sb().from("exp_audit").select("*").order("at", { ascending: false }).limit(500)) as AuditItem[];
}

export async function upsertCostCenter(cc: CostCenter, isNew: boolean) {
  if (isNew) check(await sb().from("exp_cost_centers").insert(cc));
  else check(await sb().from("exp_cost_centers").update({ label: cc.label, company_id: cc.company_id, owner_id: cc.owner_id, active: cc.active }).eq("code", cc.code));
}
export async function updateProfile(staffId: string, patch: Partial<Pick<Person, "role" | "manager_id" | "company_id" | "matricula" | "active" | "uses_km">>) {
  check(await sb().from("exp_profiles").update(patch).eq("staff_member_id", staffId));
}
export async function updateSettings(patch: Partial<Settings>) {
  check(await sb().from("exp_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1));
}
export async function updateCompany(id: string, nif: string) {
  check(await sb().from("exp_companies").update({ nif }).eq("id", id));
}
