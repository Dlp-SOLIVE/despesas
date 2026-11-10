# Email automático ao aprovador (pedido submetido)

Quando um colaborador submete (ou volta a submeter, depois de devolvido) o pedido do mês, o **manager** dele
(Administração → Utilizadores → coluna Manager) recebe um email com o resumo e o botão **Rever o pedido**,
que abre a revisão do pedido em Aprovações (depois do login).

O código já está na plataforma (`src/lib/notify.ts`, chamado em `src/views/Submit.tsx`).
Só falta ligar o EmailJS — sem estas variáveis a submissão funciona na mesma, mas não sai email.

## 1. EmailJS (emailjs.com)
1. **Email Services → Add New Service** → Outlook 365 (ou Gmail) → ligar à conta que envia
   (ex.: caixa genérica despesas@…) → anotar o **Service ID**.
2. **Email Templates → Create New Template**:
   - **To Email:** `{{to_email}}`
   - **From Name:** `Legendre · Despesas`
   - **Subject:** `Despesas · {{employee}} submeteu o pedido de {{period}} ({{total}})`
   - **Content → Edit content → Code:** colar `docs/emailjs-template-submissao.html`
   - Save → anotar o **Template ID**.
3. **Account → General → Public Key** → anotar.
4. **Account → Security**: em *Allowed origins* pôr `https://legendrept-expenses.netlify.app`
   (impede outros sites de usar a chave).

Variáveis que a plataforma envia ao modelo: `to_email`, `to_name`, `employee`, `period`, `cost_center`,
`receipts`, `km`, `total`, `link`.

## 2. Netlify
Site configuration → **Environment variables** → acrescentar:

| Variável | Valor |
|---|---|
| `VITE_EMAILJS_PUBLIC_KEY` | Public Key |
| `VITE_EMAILJS_SERVICE_ID` | Service ID |
| `VITE_EMAILJS_TEMPLATE_ID` | Template ID |

Depois: **Deploys → Trigger deploy** (as variáveis `VITE_` só entram num build novo).

## 3. Testar
1. Conta de teste com manager = o seu utilizador.
2. Submeter um pedido (janela anónima) → aparece «Email enviado a …» no registo e o email chega.
3. Se falhar, aparece o aviso «O pedido foi submetido, mas o email ao manager não foi enviado»:
   ver EmailJS → **Email History** (erro do serviço) e se as 3 variáveis estão no Netlify.

Notas
- Plano gratuito do EmailJS: 200 emails/mês — chega para os pedidos mensais.
- Sem manager atribuído o botão Submeter fica bloqueado, por isso há sempre destinatário.
