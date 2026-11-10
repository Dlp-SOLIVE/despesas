# Email automático ao aprovador (Supabase + Resend)

Quando um pedido passa a **submetido** (primeira submissão ou nova submissão depois de devolvido), a base de dados
chama a Edge Function `exp-notify`, que envia pela **Resend** um email ao **manager** do colaborador
(Administração → Utilizadores → coluna Manager) com o resumo e o botão **Rever o pedido**.

- O envio é feito no servidor: não depende do browser de quem submete e as chaves nunca vão para o site.
- Uma falha no email **nunca** impede a submissão.
- Cada envio (ou falha) fica no **Audit log**: «Email enviado a …» / «Falhou o email a …».

Ficheiros: `supabase/functions/exp-notify/index.ts`, `supabase/migrations/20261110120000_email_aprovador.sql`,
`src/views/Submit.tsx` (sem EmailJS).

## 1. Resend (resend.com)
1. Criar conta → **Domains → Add domain** → domínio da empresa (ex.: `legendre.pt`, ou um subdomínio como
   `mail.legendre.pt`) → acrescentar no DNS os registos que a Resend indicar (SPF/DKIM) → esperar por **Verified**.
   Sem domínio verificado, a Resend só envia para o email do dono da conta (serve apenas para testar).
2. **API Keys → Create API Key** (permissão *Sending access*) → copiar a chave `re_…`.

## 2. Supabase — segredos da função
Edge Functions → **Secrets** → acrescentar:

| Nome | Valor |
|---|---|
| `RESEND_API_KEY` | a chave `re_…` |
| `RESEND_FROM` | `Legendre · Despesas <despesas@legendre.pt>` (endereço do domínio verificado) |
| `NOTIFY_SECRET` | um texto comprido e aleatório inventado por si (ex.: 40 letras/números) |
| `APP_URL` | opcional; por defeito `https://legendrept-expenses.netlify.app` |

## 3. Supabase — publicar a função
Edge Functions → **Deploy a new function** → nome `exp-notify` → colar `supabase/functions/exp-notify/index.ts` → Deploy.
Depois, nos detalhes da função, **desligar «Verify JWT» / «Enforce JWT verification»** (quem a chama é a base de dados,
protegida pelo `NOTIFY_SECRET`).
Com a CLI: `supabase functions deploy exp-notify --no-verify-jwt --project-ref rfdsxigfodzayoxebbga`.

## 4. Supabase — SQL (uma vez)
SQL Editor → New query → correr, trocando o texto secreto pelo **mesmo** do `NOTIFY_SECRET`:
```sql
select vault.create_secret('https://rfdsxigfodzayoxebbga.supabase.co/functions/v1/exp-notify', 'exp_notify_url');
select vault.create_secret('<o mesmo texto do NOTIFY_SECRET>', 'exp_notify_secret');
```
Depois colar e correr `supabase/migrations/20261110120000_email_aprovador.sql`.

Para mudar o segredo mais tarde:
```sql
select vault.update_secret((select id from vault.secrets where name = 'exp_notify_secret'), '<novo texto>');
```

## 5. Site (GitHub → Netlify)
Substituir `src/views/Submit.tsx` e apagar `src/lib/notify.ts` (um só commit → um deploy).
Se tinha posto variáveis `VITE_EMAILJS_*` no Netlify, podem ser apagadas.

## 6. Testar
1. Conta de teste com manager = o seu utilizador; submeter um pedido (janela anónima).
2. O email chega em segundos; no Audit log aparece «Email enviado a …».
3. Se não chegar:
   - Audit log com «Falhou o email…» → a mensagem é da Resend (domínio por verificar, `RESEND_FROM` errado…).
   - Nada no Audit log → ver as chamadas feitas pela base de dados:
     ```sql
     select status_code, content, error_msg, created from net._http_response order by created desc limit 10;
     ```
     `401` = `NOTIFY_SECRET` diferente do Vault (ou «Verify JWT» ligado); `404` = função com outro nome.
   - Edge Functions → `exp-notify` → **Logs**.

Plano gratuito da Resend: 3 000 emails/mês (100 por dia).
