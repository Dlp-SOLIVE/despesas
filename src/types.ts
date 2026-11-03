export type ExpRole = "colaborador" | "manager" | "rh" | "contabilidade" | "admin";
export type ClaimStatus = "draft" | "returned" | "submitted" | "approved_mgr" | "validated_rh" | "posted";
export type ExpType = "FDD" | "FDM" | "OFF";
export type Currency = "EUR" | "GBP";

export type Person = {
  id: string;
  full_name: string;
  email: string;
  role: ExpRole;
  manager_id: string | null;
  company_id: string | null;
  matricula: string | null;
  active: boolean;
  uses_km: boolean;
  created_at?: string;
};

export type Company = { id: string; name: string; nif: string };

export type CostCenter = {
  code: string;
  label: string;
  company_id: string;
  owner_id: string | null;
  active: boolean;
};

export type Settings = {
  km_rate: number;
  max_age_months: number;
  open_day: number;
  max_lines: number;
  retention_years: number;
};

export type Participant = { name: string; company?: string };

export type Details = {
  legal?: string;
  invite?: string;
  motivo?: string;
  people?: string;
  participants?: Participant[];
  origem?: string;
  destino?: string;
  cidade?: string;
  local?: string;
  kind?: string;
  descricao?: string;
};

export type Line = {
  id: string;
  claim_id: string;
  no: number;
  receipt_date: string | null;
  type: ExpType | null;
  sub: string | null;
  details: Details;
  client: string | null;
  nif: string | null;
  currency: Currency;
  rate: number;
  excl: number | null;
  incl: number | null;
  file_path: string | null;
  file_type: string | null;
  ocr: Record<string, unknown> | null;
  approver_note: string | null;
};

export type Trip = {
  id: string;
  claim_id: string;
  trip_date: string;
  origin: string;
  dest: string;
  purpose: string;
  km: number;
  round_trip: boolean;
};

export type HistoryItem = {
  id: number;
  claim_id: string;
  actor_id: string | null;
  action: string;
  comment: string | null;
  at: string;
};

export type Claim = {
  id: string;
  staff_member_id: string;
  cost_center: string;
  period: string;
  status: ClaimStatus;
  insurance_declared: boolean;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  km_rate: number | null;
  submitted_at: string | null;
  posted_at: string | null;
  paid_on: string | null;
  payment_ref: string | null;
  created_at: string;
  lines: Line[];
  trips: Trip[];
  history: HistoryItem[];
};

export type Vehicle = { staff_member_id: string; model: string; plate: string };

export type FavTrip = {
  id: string;
  staff_member_id: string;
  origin: string;
  dest: string;
  purpose: string;
  km: number;
  round_trip: boolean;
};

export type AuditItem = { id: number; actor_id: string | null; action: string; at: string };

export type Refs = {
  companies: Company[];
  costCenters: CostCenter[];
  settings: Settings;
  people: Person[];
};
