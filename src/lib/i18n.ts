// Língua da interface (PT / EN). Guardada no browser; o Excel oficial e os dados não mudam.
import { useSyncExternalStore } from "react";

export type Lang = "pt" | "en";
const KEY = "despesas_lang";

let lang: Lang = (() => {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "pt" || v === "en") return v;
  } catch {
    // sem storage
  }
  return "pt";
})();
const subs = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = lang === "pt" ? "pt-PT" : "en";

export const getLang = () => lang;
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    // sem storage
  }
  document.documentElement.lang = l === "pt" ? "pt-PT" : "en";
  subs.forEach((f) => f());
}
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    getLang,
    getLang,
  );
}
/** Texto na língua atual: tr("Guardar", "Save") */
export const tr = (pt: string, en: string) => (lang === "en" ? en : pt);

// Ações gravadas no histórico (em PT na base de dados) → texto a mostrar
const ACTIONS: Record<string, string> = {
  "Submetido ao manager": "Submitted to manager",
  Aprovado: "Approved",
  Validado: "Validated",
  "Registado RH": "Recorded by HR",
  Lançado: "Posted",
  Pago: "Paid",
  Devolvido: "Returned",
  "Reaberto pelo administrador": "Reopened by administrator",
  Criado: "Created",
};
export const trAction = (a: string) => (lang === "en" ? ACTIONS[a] ?? a : a);

// Mensagens de erro do servidor (Supabase) mais comuns
const SERVER: [RegExp, string][] = [
  [/^Pedido não encontrado/, "Claim not found"],
  [/^Não tem permissão para decidir este pedido neste estado/, "You are not allowed to act on this claim at this stage"],
  [/^Não pode aprovar o seu próprio pedido/, "You cannot approve your own claim"],
  [/^Indique o motivo da devolução/, "Enter the reason for returning the claim"],
  [/^Indique o motivo/, "Enter a reason"],
  [/^Indique a data do pagamento/, "Enter the payment date"],
  [/^A data do pagamento não pode ser futura/, "The payment date cannot be in the future"],
  [/^Só o administrador/, "Administrator only"],
  [/^Falta a declaração de seguro automóvel/, "The car insurance declaration is missing"],
  [/^(\d+) recibo\(s\) com dados em falta ou fora do prazo/, "$1 receipt(s) with missing data or out of date"],
  [/^O estado do pedido só muda pelas ações da plataforma/, "The claim status can only change through the platform actions"],
  [/^Sem acesso ao ficheiro/, "No access to the file"],
  [/^Modelo Excel em falta no site.*/, "Excel template missing on the site (public/template.xlsx). Tell the administrator."],
  [/^Imagem inválida/, "Invalid image"],
];
export const trServer = (m: string) => {
  if (lang !== "en") return m;
  for (const [re, en] of SERVER) if (re.test(m)) return m.replace(re, en);
  return m;
};
