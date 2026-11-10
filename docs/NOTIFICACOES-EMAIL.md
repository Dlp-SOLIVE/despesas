# Emails automáticos (Supabase + Gmail)

Quando um pedido passa a **submetido** (primeira submissão ou nova submissão depois de devolvido), a base de dados
chama a Edge Function `exp-notify`, que envia pelo **Gmail** (como a plataforma de Entregas) um email ao **manager** do colaborador
(Administração → Utilizadores → coluna Manager) com o resumo e o botão **Rever o pedido**.

Quando o manager **aprova** o pedido, o **colaborador** recebe um email «Pedido de … aprovado», com quem aprovou,
o resumo e o botão **Ver o pedido** (responder vai para o manager).

**Língua:** cada email sai na língua que o destinatário escolheu na plataforma (botões PT / EN), guardada no
perfil (`exp_profiles.lang`, migração `20261111100000_email_idioma.sql`). Quem nunca escolheu recebe em português.
Valores sempre no formato europeu (1.234,50 €).

- O envio é feito no servidor: não depende do browser de quem submete e as chaves nunca vão para o site.
- Uma falha no email **nunca** impede a submissão.
- Cada envio (ou falha) fica no **Audit log**: «Email enviado a …» / «Falhou o email a …».

Ficheiros: `supabase/functions/exp-notify/index.ts`, `supabase/migrations/20261110180000_email_aprovado.sql`
(substitui o trigger de `20261110120000_email_aprovador.sql`),
`src/views/Submit.tsx` (sem EmailJS).

## 1. Conta Gmail (sem DNS nem IT)
Conta das Despesas: **`legendre.pt.despesas@gmail.com`**.
1. Conta Google → **Segurança** → ativar a **Verificação em dois passos** (obrigatório para o passo seguinte).
2. Conta Google → Segurança → **Palavras-passe de aplicações** (ou myaccount.google.com/apppasswords)
   → nome `Despesas Supabase` → **Criar** → copiar os 16 caracteres (sem espaços).

## 2. Supabase — segredos da função
Projeto **Legendre-Expenses** → Edge Functions → **Secrets** → acrescentar:

| Nome | Valor |
|---|---|
| `MAIL_PROVIDER` | `gmail` |
| `GMAIL_USER` | `legendre.pt.despesas@gmail.com` |
| `GMAIL_APP_PASSWORD` | os 16 caracteres do passo 1 |
| `MAIL_FROM` | opcional: `Legendre · Despesas <legendre.pt.despesas@gmail.com>` (o nome que o manager vê) |
| `NOTIFY_SECRET` | um texto comprido e aleatório inventado por si (ex.: 40 letras/números) |
| `APP_URL` | opcional; por defeito `https://legendrept-expenses.netlify.app` |

No Gmail, o endereço em `MAIL_FROM` tem de ser o próprio `GMAIL_USER`; só o nome antes do `<…>` pode mudar.
Mais tarde, se o IT autorizar um domínio na Resend: `MAIL_PROVIDER` = `resend`, `RESEND_API_KEY` = chave `re_…`,
`MAIL_FROM` = endereço desse domínio. Os segredos mudam sem voltar a publicar a função.

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
Depois colar e correr `supabase/migrations/20261110180000_email_aprovado.sql`.

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
   - Audit log com «Falhou o email…» → a mensagem é do Gmail («Invalid login» = `GMAIL_USER` ou palavra-passe de aplicação errados).
   - Nada no Audit log → ver as chamadas feitas pela base de dados:
     ```sql
     select status_code, content, error_msg, created from net._http_response order by created desc limit 10;
     ```
     `401` = `NOTIFY_SECRET` diferente do Vault (ou «Verify JWT» ligado); `404` = função com outro nome.
   - Edge Functions → `exp-notify` → **Logs**.

Limite do Gmail: cerca de 500 emails por dia.
