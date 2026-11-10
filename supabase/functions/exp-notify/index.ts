// Edge Function: exp-notify
// Emails automáticos dos pedidos de despesas (Gmail ou Resend, como nas Entregas):
//   event "submitted" → ao manager: pedido submetido, aguarda aprovação
//   event "approved"  → ao colaborador: pedido aprovado pelo manager
// Língua: a do destinatário (exp_profiles.lang, gravada pela plataforma quando escolhe PT/EN); por defeito PT.
// É chamada pela base de dados (trigger exp_claims_notify, migração 20261110180000_email_aprovado.sql),
// nunca pelo browser. Publicar com «Verify JWT» DESLIGADO: a proteção é o segredo partilhado.
// Segredos (Supabase → Edge Functions → Secrets):
//   NOTIFY_SECRET        o mesmo texto guardado no Vault com o nome exp_notify_secret
//   MAIL_PROVIDER        gmail (por defeito) ou resend
//   GMAIL_USER           conta Gmail que envia (legendre.pt.despesas@gmail.com)
//   GMAIL_APP_PASSWORD   palavra-passe de aplicação dessa conta (16 caracteres)
//   MAIL_FROM            (opcional) ex.: Legendre · Despesas <legendre.pt.despesas@gmail.com>; por defeito GMAIL_USER
//   RESEND_API_KEY       só com MAIL_PROVIDER=resend (MAIL_FROM tem de ser do domínio verificado)
//   APP_URL              (opcional) por defeito https://legendrept-expenses.netlify.app
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.14";

const env = (k: string) => Deno.env.get(k) ?? "";

/** Envia o email; lança erro com a mensagem do serviço se falhar. */
async function sendMail(m: { to: string; replyTo?: string; subject: string; html: string; text: string }) {
  const from = env("MAIL_FROM") || env("GMAIL_USER");
  if (!from) throw new Error("Email não configurado (GMAIL_USER / MAIL_FROM)");
  if ((env("MAIL_PROVIDER") || "gmail") === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], reply_to: m.replyTo, subject: m.subject, html: m.html, text: m.text }),
    });
    if (!r.ok) throw new Error("Resend: " + (await r.text()));
    return;
  }
  // Gmail: porta 465 (o Supabase bloqueia 25 e 587)
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") },
  });
  await t.sendMail({ from, to: m.to, replyTo: m.replyTo, subject: m.subject, html: m.html, text: m.text });
}

type Lang = "pt" | "en";
const MONTHS: Record<Lang, string[]> = {
  pt: ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
// Valores sempre no formato europeu da plataforma (1.234,50 €)
const eurFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num1Fmt = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = { format: (v: number) => eurFmt.format(v) };
const num1 = { format: (v: number) => num1Fmt.format(v) };
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const periodLabel = (p: string, lang: Lang) => {
  const [y, m] = p.split("-");
  return `${MONTHS[lang][Number(m) - 1] ?? m} ${y}`;
};

// Textos dos emails (PT / EN)
const T = {
  pt: {
    hello: (n: string) => `Olá ${n},`,
    submittedIntro: (emp: string) => `<strong>${emp}</strong> submeteu um pedido de reembolso de despesas que aguarda a sua aprovação.`,
    submittedText: (emp: string) => `${emp} submeteu um pedido de reembolso de despesas que aguarda a sua aprovação.`,
    approvedIntro: (who: string) => `O seu pedido de reembolso de despesas foi <strong>aprovado</strong> por <strong>${who}</strong>.`,
    approvedText: (who: string) => `O seu pedido de reembolso de despesas foi aprovado por ${who}.`,
    yourManager: "o seu manager",
    submittedFooter: "Pode aprovar ou devolver com comentários em Aprovações.",
    approvedFooter: "Segue agora para registo pelos RH e, depois, para pagamento.",
    automatic: "Este email é automático.",
    submittedSubject: (emp: string, per: string, tot: string) => `Despesas · ${emp} submeteu o pedido de ${per} (${tot})`,
    approvedSubject: (per: string, tot: string) => `Despesas · Pedido de ${per} aprovado (${tot})`,
    review: "Rever o pedido",
    view: "Ver o pedido",
    month: "Mês",
    costCenter: "Cost center",
    receipts: "Recibos",
    km: "Quilómetros",
    total: "Total",
    employee: "Colaborador",
  },
  en: {
    hello: (n: string) => `Hello ${n},`,
    submittedIntro: (emp: string) => `<strong>${emp}</strong> has submitted an expense claim that is awaiting your approval.`,
    submittedText: (emp: string) => `${emp} has submitted an expense claim that is awaiting your approval.`,
    approvedIntro: (who: string) => `Your expense claim has been <strong>approved</strong> by <strong>${who}</strong>.`,
    approvedText: (who: string) => `Your expense claim has been approved by ${who}.`,
    yourManager: "your manager",
    submittedFooter: "You can approve it or return it with comments in Approvals.",
    approvedFooter: "It now goes to HR to be recorded and then to payment.",
    automatic: "This is an automatic email.",
    submittedSubject: (emp: string, per: string, tot: string) => `Expenses · ${emp} submitted the ${per} claim (${tot})`,
    approvedSubject: (per: string, tot: string) => `Expenses · ${per} claim approved (${tot})`,
    review: "Review the claim",
    view: "View the claim",
    month: "Month",
    costCenter: "Cost center",
    receipts: "Receipts",
    km: "Mileage",
    total: "Total",
    employee: "Employee",
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  const secret = Deno.env.get("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-exp-secret") !== secret) return json({ error: "Não autorizado" }, 401);

  try {
    const { claim_id, event: rawEvent } = await req.json();
    if (!claim_id || typeof claim_id !== "string") return json({ error: "Falta claim_id" }, 400);
    const event = rawEvent === "approved" ? "approved" : "submitted";
    const expected = event === "approved" ? "approved_mgr" : "submitted";

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
    if (claim.status !== expected) return json({ skipped: `O pedido já não está no estado ${expected}` });

    const [owner, profile, lines, trips, settings, cc, last] = await Promise.all([
      sb.from("staff_members").select("full_name, email").eq("id", claim.staff_member_id).single(),
      sb.from("exp_profiles").select("manager_id").eq("staff_member_id", claim.staff_member_id).single(),
      sb.from("exp_lines").select("incl, currency, rate").eq("claim_id", claim.id),
      sb.from("exp_trips").select("km, round_trip").eq("claim_id", claim.id),
      sb.from("exp_settings").select("km_rate").eq("id", 1).single(),
      sb.from("exp_cost_centers").select("label").eq("code", claim.cost_center).maybeSingle(),
      // Último passo do histórico = quem aprovou (o histórico é escrito na mesma transação da mudança de estado)
      sb.from("exp_history").select("actor_id").eq("claim_id", claim.id).order("at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const r of [owner, profile, lines, trips, settings]) if (r.error) throw r.error;

    const managerId = profile.data?.manager_id;
    const mgr = managerId
      ? await sb.from("staff_members").select("full_name, email").eq("id", managerId).single()
      : { data: null, error: null };
    if (mgr.error) throw mgr.error;
    const approverId = last.data?.actor_id ?? managerId;
    const approver = approverId && approverId !== managerId
      ? (await sb.from("staff_members").select("full_name").eq("id", approverId).maybeSingle()).data
      : mgr.data;

    // Destinatário: manager (submetido) ou colaborador (aprovado)
    const to = event === "approved" ? owner.data : mgr.data;
    if (event === "submitted" && !managerId) return json({ skipped: "Colaborador sem manager atribuído" });
    if (!to?.email) return json({ skipped: "Destinatário sem email" });
    const toId = event === "approved" ? claim.staff_member_id : managerId;
    // Se a coluna lang ainda não existir (SQL por correr), dá erro e fica PT
    const langRow = await sb.from("exp_profiles").select("lang").eq("staff_member_id", toId).maybeSingle();
    const lang: Lang = !langRow.error && (langRow.data as { lang?: string } | null)?.lang === "en" ? "en" : "pt";
    const L = T[lang];

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
    const employee = owner.data?.full_name ?? L.employee;
    const period = periodLabel(claim.period, lang);
    const ccText = cc.data?.label ? `${claim.cost_center} · ${cc.data.label}` : claim.cost_center;

    const approverName = approver?.full_name ?? L.yourManager;
    const intro = event === "approved" ? L.approvedIntro(esc(approverName)) : L.submittedIntro(esc(employee));
    const introText = event === "approved" ? L.approvedText(approverName) : L.submittedText(employee);
    const footer = event === "approved" ? L.approvedFooter : L.submittedFooter;
    const subject = event === "approved"
      ? L.approvedSubject(period, eur.format(total))
      : L.submittedSubject(employee, period, eur.format(total));
    const button = event === "approved" ? L.view : L.review;
    const replyTo = event === "approved" ? mgr.data?.email : owner.data?.email;

    const row = (k: string, v: string) =>
      `<tr><td style="color:#777;padding:4px 16px 4px 0">${k}</td><td style="padding:4px 0">${v}</td></tr>`;
    const html = `
<div lang="${lang === "en" ? "en" : "pt-PT"}" style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;padding:24px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e3e3">
    <tr><td style="background:#1d1d1b;color:#ffffff;padding:16px 24px;font-size:15px;letter-spacing:2px;font-weight:bold">LEGENDRE · DESPESAS</td></tr>
    <tr><td style="padding:24px;color:#1d1d1b;font-size:14px;line-height:1.5">
      <p style="margin:0 0 12px">${esc(L.hello(to.full_name))}</p>
      <p style="margin:0 0 16px">${intro}</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;margin:0 0 20px">
        ${row(L.month, `<strong>${esc(period)}</strong>`)}
        ${row(L.costCenter, esc(ccText))}
        ${row(L.receipts, `${(lines.data ?? []).length} · ${esc(eur.format(receipts))}`)}
        ${row(L.km, `${esc(num1.format(km))} km · ${esc(eur.format(kmEUR))}`)}
        ${row(L.total, `<strong>${esc(eur.format(total))}</strong>`)}
      </table>
      <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#e30613;color:#ffffff;text-decoration:none;padding:10px 18px;font-weight:bold;display:inline-block">${esc(button)}</a></p>
      <p style="margin:0;color:#777;font-size:12px">${esc(footer)} ${esc(L.automatic)}</p>
    </td></tr>
  </table>
</div>`;
    const text =
      `${L.hello(to.full_name)}\n\n${introText}\n\n` +
      `${L.month}: ${period}\n${L.costCenter}: ${ccText}\n${L.receipts}: ${(lines.data ?? []).length} · ${eur.format(receipts)}\n` +
      `${L.km}: ${num1.format(km)} km · ${eur.format(kmEUR)}\n${L.total}: ${eur.format(total)}\n\n${footer}\n\n${button}: ${link}\n`;

    let errMsg = "";
    try {
      await sendMail({
        to: to.email,
        replyTo: replyTo || undefined,
        subject,
        html,
        text,
      });
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }
    const ok = !errMsg;
    await sb.from("exp_audit").insert({
      actor_id: null,
      action: ok
        ? `Email (${event === "approved" ? "aprovado" : "submetido"}, ${lang.toUpperCase()}) enviado a ${to.full_name} (pedido ${claim.period} · ${claim.cost_center})`
        : `Falhou o email (${event === "approved" ? "aprovado" : "submetido"}) a ${to.full_name} (pedido ${claim.period} · ${claim.cost_center}): ${errMsg.slice(0, 300)}`,
    });
    return json(ok ? { sent: true } : { error: errMsg }, ok ? 200 : 502);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
