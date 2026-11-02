// Edge Function: exp-docusign
// Assinatura DocuSign das aprovações (manager e RH), com assinatura embebida (o aprovador assina sem sair do fluxo).
// Envio feito por um utilizador de serviço DocuSign da empresa (JWT Grant).
//
// Segredos (Supabase → Edge Functions → Secrets):
//   DOCUSIGN_INTEGRATION_KEY  — Integration Key (Apps and Keys)
//   DOCUSIGN_USER_ID          — API Username (GUID) do utilizador que envia
//   DOCUSIGN_ACCOUNT_ID       — API Account ID (GUID)
//   DOCUSIGN_PRIVATE_KEY      — chave RSA privada (texto completo, com BEGIN/END)
//   DOCUSIGN_ENV              — "demo" (testes) ou "prod"
//
// Ações (POST JSON, com a sessão do utilizador):
//   { action: "start",  claim_id, pdf_base64, return_url }  → { url, envelope_id }
//   { action: "finish", claim_id, envelope_id, comment, notes } → { ok }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "content-type": "application/json" } });
const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`DocuSign não configurado (${k} em falta)`);
  return v;
};

// ── JWT Grant ──
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const enc = (s: string) => new TextEncoder().encode(s);
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}
// DocuSign entrega PKCS#1 ("BEGIN RSA PRIVATE KEY"); o WebCrypto precisa de PKCS#8
function pkcs1to8(pkcs1: Uint8Array): Uint8Array {
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...algo, ...octet];
  return new Uint8Array([0x30, ...derLen(body.length), ...body]);
}
async function importKey(pem: string): Promise<CryptoKey> {
  const isPkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const der = isPkcs1 ? pkcs1to8(raw) : raw;
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
async function accessToken(): Promise<{ token: string; base: string; account: string }> {
  const authHost = env("DOCUSIGN_ENV") === "prod" ? "account.docusign.com" : "account-d.docusign.com";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(enc(JSON.stringify({ iss: env("DOCUSIGN_INTEGRATION_KEY"), sub: env("DOCUSIGN_USER_ID"), aud: authHost, iat: now, exp: now + 3000, scope: "signature impersonation" })));
  const key = await importKey(env("DOCUSIGN_PRIVATE_KEY").replace(/\\n/g, "\n"));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc(`${header}.${payload}`)));
  const r = await fetch(`https://${authHost}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  const t = await r.json();
  if (!r.ok) {
    if (t.error === "consent_required") {
      const url = `https://${authHost}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${env("DOCUSIGN_INTEGRATION_KEY")}&redirect_uri=https://www.docusign.com`;
      throw new Error(`Falta autorizar a aplicação na DocuSign. O administrador DocuSign deve abrir: ${url}`);
    }
    throw new Error(`DocuSign: ${t.error_description ?? t.error ?? r.status}`);
  }
  const ui = await (await fetch(`https://${authHost}/oauth/userinfo`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
  const account = env("DOCUSIGN_ACCOUNT_ID");
  const acc = (ui.accounts ?? []).find((a: { account_id: string }) => a.account_id === account);
  if (!acc) throw new Error("DocuSign: conta (DOCUSIGN_ACCOUNT_ID) não encontrada para este utilizador");
  return { token: t.access_token, base: `${acc.base_uri}/restapi/v2.1/accounts/${account}`, account };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const url = Deno.env.get("SUPABASE_URL")!;
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: au } = await user.auth.getUser();
    const email = au.user?.email?.toLowerCase();
    if (!email) throw new Error("Sessão inválida");
    const { data: sm } = await admin.from("staff_members").select("id, full_name, email").ilike("email", email).maybeSingle();
    const { data: prof } = sm ? await admin.from("exp_profiles").select("active").eq("staff_member_id", sm.id).maybeSingle() : { data: null };
    if (!sm || !prof?.active) throw new Error("Utilizador sem acesso");
    const me = { id: sm.id as string, full_name: sm.full_name as string, email: (sm.email as string).toLowerCase() };
    const { data: st } = await admin.from("exp_settings").select("docusign_enabled").eq("id", 1).maybeSingle();
    if (!st?.docusign_enabled) throw new Error("DocuSign está desligado nos Parâmetros");

    // o utilizador tem de conseguir ver o pedido (RLS com a sessão dele)
    const { data: claim } = await user.from("exp_claims").select("id, staff_member_id, period, cost_center, status").eq("id", body.claim_id).maybeSingle();
    if (!claim) throw new Error("Pedido não encontrado");
    if (!["submitted", "approved_mgr"].includes(claim.status)) throw new Error("Este passo não é assinado por DocuSign");

    const ds = await accessToken();
    const H = { Authorization: `Bearer ${ds.token}`, "content-type": "application/json" };

    if (body.action === "start") {
      if (!body.pdf_base64) throw new Error("Falta o documento");
      const { data: owner } = await admin.from("staff_members").select("full_name").eq("id", claim.staff_member_id).maybeSingle();
      const stepLabel = claim.status === "submitted" ? "Aprovação do manager" : "Validação RH";
      const env1 = await fetch(`${ds.base}/envelopes`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          emailSubject: `Despesas ${claim.period} · ${owner?.full_name ?? ""} · ${stepLabel}`.slice(0, 100),
          documents: [{ documentBase64: body.pdf_base64, name: `Despesas ${claim.period} ${claim.cost_center}`, fileExtension: "pdf", documentId: "1" }],
          recipients: {
            signers: [{
              email: me.email, name: me.full_name, recipientId: "1", routingOrder: "1", clientUserId: me.id,
              tabs: {
                signHereTabs: [{ anchorString: "/assinatura/", anchorUnits: "pixels", anchorYOffset: "-8" }],
                dateSignedTabs: [{ anchorString: "/data/", anchorUnits: "pixels", anchorYOffset: "-4" }],
              },
            }],
          },
          status: "sent",
        }),
      });
      const e = await env1.json();
      if (!env1.ok) throw new Error(`DocuSign: ${e.message ?? e.errorCode ?? env1.status}`);
      const view = await fetch(`${ds.base}/envelopes/${e.envelopeId}/views/recipient`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ returnUrl: body.return_url, authenticationMethod: "none", email: me.email, userName: me.full_name, clientUserId: me.id }),
      });
      const v = await view.json();
      if (!view.ok) throw new Error(`DocuSign: ${v.message ?? view.status}`);
      await admin.from("exp_signatures").insert({ claim_id: claim.id, step: claim.status, signer_id: me.id, envelope_id: e.envelopeId, status: "sent" });
      return json({ ok: true, url: v.url, envelope_id: e.envelopeId });
    }

    if (body.action === "finish") {
      const { data: sigRow } = await admin.from("exp_signatures").select("*").eq("envelope_id", body.envelope_id).eq("claim_id", claim.id).maybeSingle();
      if (!sigRow || sigRow.signer_id !== me.id) throw new Error("Envelope desconhecido");
      const s = await (await fetch(`${ds.base}/envelopes/${body.envelope_id}`, { headers: H })).json();
      if (s.status === "declined" || s.status === "voided") {
        await admin.from("exp_signatures").update({ status: s.status }).eq("id", sigRow.id);
        throw new Error("Assinatura recusada ou anulada na DocuSign. O pedido não foi aprovado.");
      }
      if (s.status !== "completed") throw new Error("A assinatura ainda não está concluída na DocuSign.");
      const pdf = new Uint8Array(await (await fetch(`${ds.base}/envelopes/${body.envelope_id}/documents/combined`, { headers: { Authorization: `Bearer ${ds.token}` } })).arrayBuffer());
      const path = `${claim.staff_member_id}/${claim.id}/assinado-${sigRow.step}-${body.envelope_id}.pdf`;
      const up = await admin.storage.from("despesas-recibos").upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error(up.error.message);
      await admin.from("exp_signatures").update({ status: "completed", signed_path: path, completed_at: new Date().toISOString() }).eq("id", sigRow.id);
      const { error } = await user.rpc("exp_decide", { p_claim: claim.id, p_action: "approve", p_comment: body.comment ?? "", p_notes: {}, p_docusign: true });
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
    throw new Error("Ação inválida");
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
