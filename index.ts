// Edge Function: exp-ocr
// Lê um recibo guardado no bucket "despesas-recibos" e devolve os campos sugeridos.
// O ficheiro é descarregado COM a sessão do utilizador (respeita as regras de acesso do Storage).
// Segredos necessários (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY
// Opcional: ANTHROPIC_MODEL (por defeito claude-sonnet-4-5)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `És um assistente de contabilidade em Portugal. Lê este recibo/fatura e responde APENAS com JSON válido, sem texto à volta, com esta forma:
{"date":"AAAA-MM-DD ou null","client":"nome do comerciante/entidade emitente ou null","nif_buyer":"NIF do adquirente (cliente) tal como impresso, ou null","total_incl":número com IVA ou null,"total_excl":número sem IVA ou null,"currency":"EUR ou GBP","vat_breakdown":true/false,"suggested_type":"FDD|FDM|OFF|null","suggested_sub":"uma de: Flight ticket, Train Ticket, Car renting, Hotels, Restaurants, Fuel (diesel only), Fuel (other), Others travel expenses, Mutual fund, Office supplies, Phone, Food for office — ou null","others_kind":"Estacionamento|Portagem|Táxi / Uber|Metro|Autocarro|Outro|null","city":"cidade ou null","route_from":"origem (viagens) ou null","route_to":"destino (viagens) ou null"}
Regras: usa a data do documento (não a data de hoje). Se o IVA não estiver discriminado, vat_breakdown=false e total_excl=total_incl. Combustível gasóleo → "Fuel (diesel only)". Estacionamento, portagens, táxi, metro, autocarro → "Others travel expenses". Não inventes valores: usa null quando não for legível.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { path } = await req.json();
    if (!path || typeof path !== "string") throw new Error("Falta o caminho do ficheiro");
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("Leitura automática não configurada (ANTHROPIC_API_KEY em falta)");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: file, error } = await supabase.storage.from("despesas-recibos").download(path);
    if (error || !file) throw new Error("Sem acesso ao ficheiro");
    if (file.size > 8 * 1024 * 1024) throw new Error("Ficheiro demasiado grande para leitura automática (máx. 8 MB)");

    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const type = file.type || (path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const source = type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: type, data: b64 } };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5",
        max_tokens: 600,
        messages: [{ role: "user", content: [source, { type: "text", text: PROMPT }] }],
      }),
    });
    if (!r.ok) throw new Error(`Serviço de leitura indisponível (${r.status})`);
    const out = await r.json();
    const text: string = (out.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return new Response(JSON.stringify({ ok: true, data: json }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...cors, "content-type": "application/json" },
    });
  }
});
