// Notificações por email (EmailJS) — avisa o manager quando um pedido é submetido.
// Configuração no Netlify (Environment variables):
//   VITE_EMAILJS_PUBLIC_KEY, VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID
// Sem estas variáveis, a submissão funciona na mesma e não é enviado email.
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;
const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined;

export const notifyEnabled = Boolean(PUBLIC_KEY && SERVICE_ID && TEMPLATE_ID);

export type SubmitNotice = {
  to_email: string;
  to_name: string;
  employee: string;
  period: string;
  cost_center: string;
  receipts: number;
  km: string;
  total: string;
  link: string;
};

/** Envia o email ao manager. Devolve true se foi enviado; nunca lança erro. */
export async function notifyManager(p: SubmitNotice): Promise<boolean> {
  if (!notifyEnabled || !p.to_email) return false;
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: TEMPLATE_ID,
        user_id: PUBLIC_KEY,
        template_params: { ...p, receipts: String(p.receipts) },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ligação direta para a revisão do pedido (abre em Aprovações depois do login). */
export const claimLink = (claimId: string) => `${window.location.origin}/?pedido=${encodeURIComponent(claimId)}`;
