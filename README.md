# LEGENDRE · Despesas

Plataforma de pedidos de reembolso de despesas e mapa de quilómetros da Legendre PT.
Gera o **Excel oficial** ("To be printed", "Expense Claim Form", "Détail IK") e o **PDF único** com os recibos numerados, tal como a contabilidade exige.

- Repositório: `Dlp-SOLIVE/despesas` (ramo `main` → deploy automático no Netlify)
- Supabase: **o mesmo do Sistema de Compras** (`rfdsxigfodzayoxebbga`). Tabelas com prefixo `exp_`; o login e a tabela `staff_members` são partilhados.

## Tecnologia
Vite + React + TypeScript (`tsc -b && vite build`), Supabase (Auth, Postgres com RLS, Storage, Edge Function), ExcelJS e pdf-lib (carregados só ao exportar).

## Fluxo
Colaborador (rascunho, recibos, km) → submete a partir do dia 20 → **Manager** aprova ou devolve → **RH** valida → **Contabilidade** descarrega Excel + PDF e marca como lançado.
O estado só muda pelas funções `exp_submit`, `exp_decide`, `exp_admin_reopen` (há um trigger que o garante). O audit log não pode ser alterado.

## Instalação (uma vez, por esta ordem)

### 1. Base de dados
Supabase → **SQL Editor** → New query → colar todo o ficheiro `supabase/migrations/20261102120000_despesas_schema.sql` → **Run**.
Confirme que é o projeto `rfdsxigfodzayoxebbga` (o das Compras). O script não altera nenhuma tabela das Compras.

### 2. Leitura automática (Claude)
1. console.anthropic.com → API Keys → **Create Key** (conta da empresa).
2. Supabase → **Edge Functions** → Secrets → `ANTHROPIC_API_KEY` = a chave.
3. Publicar a função `supabase/functions/exp-ocr`:
   - pelo browser: Edge Functions → **Deploy a new function** → nome `exp-ocr` → colar `index.ts` → Deploy;
   - ou com a CLI: `supabase functions deploy exp-ocr --project-ref rfdsxigfodzayoxebbga`.
Sem chave, a plataforma funciona na mesma: os recibos são preenchidos à mão.

### 3. GitHub
Carregar todos os ficheiros desta pasta para `Dlp-SOLIVE/despesas` (Add file → Upload files → arrastar o conteúdo da pasta → Commit).

### 4. Netlify
Add new site → Import from GitHub → `Dlp-SOLIVE/despesas`. Build: `npm run build`, pasta `dist` (já definidos em `netlify.toml`).
Site configuration → **Environment variables**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (os mesmos valores do site das Compras). **Nunca** a service role key.
Depois: Deploys → Trigger deploy → confirmar **Published**.

### 5. Supabase Auth
Authentication → URL Configuration → **Redirect URLs**: acrescentar o endereço Netlify das Despesas (para a recuperação de palavra-passe).

### 6. Primeiro administrador
Entrar no site com a sua conta das Compras (ou criar conta) e pedir acesso. No SQL Editor:
```sql
insert into public.exp_profiles(staff_member_id, role, active, company_id)
select id, 'admin', true, 'LEGDR' from public.staff_members where lower(email) = lower('o.seu.email@legendre.pt')
on conflict (staff_member_id) do update set role = 'admin', active = true;
```
A partir daí, em **Administração**: criar cost centers, aprovar utilizadores e atribuir perfil (Colaborador, Manager, RH, Contabilidade) e manager.

## Acessos
- Contas novas criadas nas Despesas ficam em `staff_members` como `viewer` inativo: **não** ganham acesso ao Sistema de Compras.
- Cada colaborador vê os seus pedidos; o manager vê os da equipa; RH, contabilidade e administrador veem todos.
- Recibos no bucket privado `despesas-recibos` (`<colaborador>/<pedido>/<ficheiro>`), acessíveis só a quem vê o pedido.
- Pedidos lançados só podem ser reabertos ou apagados pelo administrador, com motivo registado no audit log. Conservação legal: 10 anos.

## Alterações futuras
SQL primeiro (Supabase), depois commit no GitHub, confirmar deploy **Published**, abrir com Ctrl+Shift+R.
