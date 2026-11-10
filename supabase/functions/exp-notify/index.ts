// Edge Function: exp-notify
// Envia (via Resend) o email ao manager quando um pedido de despesas é submetido.
// É chamada pela base de dados (trigger exp_claims_notify, migração 20261110120000_email_aprovador.sql),
// nunca pelo browser. Publicar com «Verify JWT» DESLIGADO: a proteção é o segredo partilhado.
// Segredos (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   chave da Resend (re_…)
//   RESEND_FROM      remetente, ex.: Legendre · Despesas <despesas@legendre.pt> (domínio verificado na Resend)
//   NOTIFY_SECRET    o mesmo texto guardado no Vault com o nome exp_notify_secret
//   APP_URL          (opcional) por defeito https://legendrept-expenses.netlify.app
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const periodLabel = (p: string) => {
  const [y, m] = p.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const secret = Deno.env.get("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-exp-secret") !== secret) return json({ error: "Não autorizado" }, 401);

  try {
    const { claim_id } = await req.json();
    if (!claim_id || typeof claim_id !== "string") return json({ error: "Falta claim_id" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: claim, error: e1 } = await sb
      .from("exp_claims")
      .select("id, staff_member_id, cost_center, period, status, km_rate")
      .eq("id", claim_id)
      .maybeSingle();
    if (e1) throw e1;
    if (!claim) return json({ error: "Pedido não encontrado" }, 404);
    if (claim.status !== "submitted") return json({ skipped: "O pedido já não está submetido" });

    const [owner, profile, lines, trips, settings, cc] = await Promise.all([
      sb.from("staff_members").select("full_name, email").eq("id", claim.staff_member_id).single(),
      sb.from("exp_profiles").select("manager_id").eq("staff_member_id", claim.staff_member_id).single(),
      sb.from("exp_lines").select("incl, currency, rate").eq("claim_id", claim.id),
      sb.from("exp_trips").select("km, round_trip").eq("claim_id", claim.id),
      sb.from("exp_settings").select("km_rate").eq("id", 1).single(),
      sb.from("exp_cost_centers").select("label").eq("code", claim.cost_center).maybeSingle(),
    ]);
    for (const r of [owner, profile, lines, trips, settings]) if (r.error) throw r.error;

    const managerId = profile.data?.manager_id;
    if (!managerId) return json({ skipped: "Colaborador sem manager atribuído" });
    const mgr = await sb.from("staff_members").select("full_name, email").eq("id", managerId).single();
    if (mgr.error) throw mgr.error;
    if (!mgr.data?.email) return json({ skipped: "Manager sem email" });

    // Mesmas contas que claimTotals (src/lib/rules.ts)
    const receipts = (lines.data ?? []).reduce((a, l) => {
      const rate = l.currency === "EUR" ? 1 : Number(l.rate) || 0;
      return a + Math.round((Number(l.incl) || 0) * rate * 100) / 100;
    }, 0);
    const km = (trips.data ?? []).reduce((a, t) => a + (Number(t.km) || 0) * (t.round_trip ? 2 : 1), 0);
    const kmRate = Number(claim.km_rate ?? settings.data?.km_rate ?? 0.4);
    const kmEUR = Math.round(km * kmRate * 100) / 100;
    const total = receipts + kmEUR;

    const appUrl = (Deno.env.get("APP_URL") ?? "https://legendrept-expenses.netlify.app").replace(/\/+$/, "");
    const link = `${appUrl}/?pedido=${encodeURIComponent(claim.id)}`;
    const employee = owner.data?.full_name ?? "Colaborador";
    const period = periodLabel(claim.period);
    const ccText = cc.data?.label ? `${claim.cost_center} · ${cc.data.label}` : claim.cost_center;

    const row = (k: string, v: string) =>
      `<tr><td style="color:#777;padding:4px 16px 4px 0">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;padding:24px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e3e3">
    <tr><td style="background:#1d1d1b;color:#ffffff;padding:16px 24px;font-size:15px;letter-spacing:2px;font-weight:bold">LEGENDRE · DESPESAS</td></tr>
    <tr><td style="padding:24px;color:#1d1d1b;font-size:14px;line-height:1.5">
      <p style="margin:0 0 12px">Olá ${esc(mgr.data.full_name)},</p>
      <p style="margin:0 0 16px"><strong>${esc(employee)}</strong> submeteu um pedido de reembolso de despesas que aguarda a sua aprovação.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;margin:0 0 20px">
        ${row("Mês", `<strong>${esc(period)}</strong>`)}
        ${row("Cost center", esc(ccText))}
        ${row("Recibos", `${(lines.data ?? []).length} · ${esc(eur.format(receipts))}`)}
        ${row("Quilómetros", `${esc(num1.format(km))} km · ${esc(eur.format(kmEUR))}`)}
        ${row("Total", `<strong>${esc(eur.format(total))}</strong>`)}
      </table>
      <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#e30613;color:#ffffff;text-decoration:none;padding:10px 18px;font-weight:bold;display:inline-block">Rever o pedido</a></p>
      <p style="margin:0;color:#777;font-size:12px">Pode aprovar ou devolver com comentários em Aprovações. Este email é automático: não responda.</p>
    </td></tr>
  </table>
</div>`;
    const text =
      `Olá ${mgr.data.full_name},\n\n${employee} submeteu um pedido de reembolso de despesas que aguarda a sua aprovação.\n\n` +
      `Mês: ${period}\nCost center: ${ccText}\nRecibos: ${(lines.data ?? []).length} · ${eur.format(receipts)}\n` +
      `Quilómetros: ${num1.format(km)} km · ${eur.format(kmEUR)}\nTotal: ${eur.format(total)}\n\nRever o pedido: ${link}\n`;

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("RESEND_FROM");
    if (!apiKey || !from) throw new Error("Resend não configurado (RESEND_API_KEY / RESEND_FROM)");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mgr.data.email],
        reply_to: owner.data?.email || undefined,
        subject: `Despesas · ${employee} submeteu o pedido de ${period} (${eur.format(total)})`,
        html,
        text,
      }),
    });
    const out = await res.json().catch(() => ({}));
    const ok = res.ok;
    await sb.from("exp_audit").insert({
      actor_id: null,
      action: ok
        ? `Email enviado a ${mgr.data.full_name} (pedido ${claim.period} · ${claim.cost_center})`
        : `Falhou o email a ${mgr.data.full_name} (pedido ${claim.period} · ${claim.cost_center}): ${(out as { message?: string }).message ?? res.status}`,
    });
    return json(ok ? { sent: true, id: (out as { id?: string }).id } : { error: out }, ok ? 200 : 502);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
