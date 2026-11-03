# LEGENDRE · Despesas

Plataforma de pedidos de reembolso de despesas e mapa de quilómetros da Legendre PT.
Gera o **Excel oficial** ("To be printed", "Expense Claim Form", "Détail IK") e o **PDF único** com os recibos numerados, tal como a contabilidade exige.

- Repositório: `Dlp-SOLIVE/despesas` (ramo `main` → deploy automático no Netlify)
- Supabase: projeto próprio `Legendre-Expenses` (`rfdsxigfodzayoxebbga`), separado do Sistema de Compras. Tabelas com prefixo `exp_`.

## Tecnologia
Vite + React + TypeScript (`tsc -b && vite build`), Supabase (Auth, Postgres com RLS, Storage, Edge Function), ExcelJS e pdf-lib (carregados só ao exportar).

## Fluxo
Colaborador (rascunho, recibos, km) → submete a partir do dia 20 → **Manager** aprova ou devolve → **RH** valida → **Contabilidade** descarrega Excel + PDF e marca como lançado.
O estado só muda pelas funções `exp_submit`, `exp_decide`, `exp_admin_reopen` (há um trigger que o garante). O audit log não pode ser alterado.

## Instalação (uma vez, por esta ordem)

### 1. Base de dados
Supabase → **SQL Editor** → New query → colar todo o ficheiro `supabase/migrations/20261102120000_despesas_schema.sql` → **Run**.
Pode voltar a correr o script sem problema (não duplica nada).

### 2. Leitura automática dos recibos
Gratuita e sem configuração: corre no browser do colaborador (nada é enviado para serviços externos).
1. **Código QR fiscal** das faturas portuguesas (Portaria 195/2020): data, NIF emitente e adquirente, total, IVA, ATCUD — dados exatos.
2. **Texto**: PDF digital (pdf.js) ou fotografia (Tesseract, português) — nome da entidade, categoria sugerida e, sem QR, data e total.
Todos os campos continuam editáveis. Recibos estrangeiros e talões sem QR leem-se pior: confirmar sempre.

**Opcional, mais tarde (Claude):** a Edge Function `supabase/functions/exp-ocr` fica pronta para quando houver chave `ANTHROPIC_API_KEY`; não é usada nesta versão.
1. console.anthropic.com → API Keys → **Create Key** (conta da empresa).
2. Supabase → **Edge Functions** → Secrets → `ANTHROPIC_API_KEY` = a chave.
3. Publicar a função `supabase/functions/exp-ocr`:
   - pelo browser: Edge Functions → **Deploy a new function** → nome `exp-ocr` → colar `index.ts` → Deploy;
   - ou com a CLI: `supabase functions deploy exp-ocr --project-ref rfdsxigfodzayoxebbga`.
Sem chave, a plataforma funciona na mesma: os recibos são preenchidos à mão.

### 2b. DocuSign (opcional, pode ser desligado)
Assinatura real das aprovações do manager e dos RH. Envio por um utilizador de serviço da conta DocuSign da empresa; cada aprovador assina com o seu nome e email, sem sair da plataforma.
1. SQL: correr `supabase/migrations/20261103100000_docusign.sql`.
2. DocuSign (administrador da conta): **Settings → Apps and Keys → Add App and Integration Key**. Em *Authentication*, **Generate RSA** e guardar a chave privada. Em *Redirect URIs*, acrescentar `https://www.docusign.com`.
3. Copiar da mesma página: *Integration Key*, *API Username* (User ID) e *API Account ID*.
4. Supabase → Edge Functions → Secrets: `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` (texto completo da chave) e `DOCUSIGN_ENV` (`demo` para testar, `prod` para a conta real).
5. Publicar a função `supabase/functions/exp-docusign` (Deploy a new function → nome `exp-docusign`).
6. Na primeira utilização a plataforma mostra um link de autorização (consentimento): o utilizador de serviço abre-o uma vez e aceita.
7. Na plataforma: Administração → Parâmetros → **DocuSign** ligado; cada aprovador ativa DocuSign no Perfil.
Nota: aplicações novas começam no ambiente *demo* da DocuSign; para usar a conta real é preciso pedir o *Go-Live* da Integration Key (feito pela DocuSign depois de alguns envios de teste).

### 3. GitHub
Carregar todos os ficheiros desta pasta para `Dlp-SOLIVE/despesas` (Add file → Upload files → arrastar o conteúdo da pasta → Commit).

### 4. Netlify
Add new site → Import from GitHub → `Dlp-SOLIVE/despesas`. Build: `npm run build`, pasta `dist` (já definidos em `netlify.toml`).
Site configuration → **Environment variables**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API). **Nunca** a service role key.
Depois: Deploys → Trigger deploy → confirmar **Published**.

### 5. Supabase Auth
Authentication → URL Configuration → **Redirect URLs**: acrescentar o endereço Netlify das Despesas (para a recuperação de palavra-passe).

### 6. Primeiro administrador
Criar conta no site e pedir acesso. No SQL Editor:
```sql
insert into public.exp_profiles(staff_member_id, role, active, company_id)
select id, 'admin', true, 'LEGDR' from public.staff_members where lower(email) = lower('o.seu.email@legendre.pt')
on conflict (staff_member_id) do update set role = 'admin', active = true;
```
A partir daí, em **Administração**: criar cost centers, aprovar utilizadores e atribuir perfil (Colaborador, Manager, RH, Contabilidade) e manager.

## Acessos
- Cada colaborador vê os seus pedidos; o manager vê os da equipa; RH, contabilidade e administrador veem todos.
- Recibos no bucket privado `despesas-recibos` (`<colaborador>/<pedido>/<ficheiro>`), acessíveis só a quem vê o pedido.
- Pedidos lançados só podem ser reabertos ou apagados pelo administrador, com motivo registado no audit log. Conservação legal: 10 anos.

## Alterações futuras
SQL primeiro (Supabase), depois commit no GitHub, confirmar deploy **Published**, abrir com Ctrl+Shift+R.
