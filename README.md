# LEGENDRE · Despesas

Plataforma de pedidos de reembolso de despesas e mapa de quilómetros da Legendre PT.
Gera o **Excel oficial** ("To be printed", "Expense Claim Form", "Détail IK") e o **PDF único** com os recibos numerados, tal como a contabilidade exige.

- Site: https://legendrept-expenses.netlify.app (Netlify, projeto `legendrept-expenses`)
- Repositório: `Dlp-SOLIVE/despesas` (ramo `main` → deploy automático no Netlify)
- Supabase: projeto próprio `Legendre-Expenses` (`rfdsxigfodzayoxebbga`), separado do Sistema de Compras. Tabelas com prefixo `exp_`.
- Interface em português e inglês (botões PT / EN); os emails seguem a língua de quem os recebe.

## Tecnologia
Vite + React + TypeScript, Supabase (Auth, Postgres com RLS, Storage, Edge Functions, Vault, pg_net), ExcelJS e pdf-lib (carregados só ao exportar).

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `src/` | `main.tsx`, `App.tsx` (login, registo, pedido de acesso), `Shell.tsx` (navegação), `ui.tsx`, `types.ts`, `styles.css` |
| `src/lib/` | `data.ts` (chamadas ao Supabase), `rules.ts` (regras do procedimento RH), `export.ts` (Excel + PDF), `localOcr.ts` (leitura dos recibos), `i18n.ts` (PT/EN), `format.ts`, `supabase.ts` |
| `src/views/` | Ecrãs: O meu mês, Recibo, Quilómetros, Submeter, Aprovações/Pagamentos, Histórico/Perfil, Administração |
| `public/` | `template.xlsx` (modelo oficial do Excel) e ícones |
| `supabase/migrations/` | SQL, por ordem de data |
| `supabase/functions/` | `exp-notify` (emails automáticos), `exp-ocr` (leitura de recibos com Claude, opcional) |
| `docs/` | `NOTIFICACOES-EMAIL.md` (configuração e diagnóstico dos emails) |

## Circuito
1. **Colaborador**: rascunho do mês (recibos e km) → submete, em qualquer dia do mês.
2. **Manager** do colaborador (definido em Administração → Utilizadores) aprova ou devolve. RH e Administrativo veem o pedido em «Para conhecimento».
3. **RH**: «Registar (RH)».
4. **Administrativo (pagamentos)**, separador **Pagamentos**: «Registar pagamento», com data (até hoje) e referência → **Pago**.

Em qualquer passo, quem decide pode **devolver**. A devolução exige um comentário e pode levar notas por recibo.
Ninguém aprova o próprio pedido (exceto o administrador). Depois de pago, só o administrador reabre ou apaga, com motivo.
O estado só muda pelas funções `exp_submit`, `exp_decide`, `exp_admin_reopen` (há um trigger que o garante). O audit log não pode ser alterado.

### Emails automáticos
Saem do Supabase (Edge Function `exp-notify`, chamada por um trigger), pela conta Gmail configurada:

| Quando | Quem recebe |
|---|---|
| Pedido submetido | Manager |
| Pedido aprovado pelo manager | Colaborador |
| Pedido devolvido (motivo + notas por recibo) | Colaborador |
| Pagamento registado (data + referência) | Colaborador |

Configuração, segredos e diagnóstico: `docs/NOTIFICACOES-EMAIL.md`.

## Regras do procedimento RH
- Um pedido por mês e por cost center. Recibos com até 3 meses. Máximo de 24 recibos e 61 trajetos.
- NIF da empresa em cada recibo (LEGDR 515 345 946; Legendre Ibérica 515 461 504).
- Subcategoria própria em vez de "Others travel expenses". DETAILS obrigatório (restaurantes: interno/externo, motivo, participantes; voo/comboio: motivo e origem > destino; hotel: cidade e motivo).
- Sem IVA discriminado: valor sem IVA = valor com IVA.
- Quilómetros a 0,40 €, matrícula XX-XX-XX e declaração de seguro automóvel (sem declaração não há trajetos).
- Nome dos ficheiros: `AnoMês – Expense Claim Form – Nome Apelido MATxxxxx`.

## Leitura automática dos recibos
Gratuita e sem configuração: corre no browser do colaborador (nada é enviado para serviços externos).
1. **Código QR fiscal** das faturas portuguesas (Portaria 195/2020): data, NIF emitente e adquirente, total, IVA, ATCUD — dados exatos.
2. **Texto**: PDF digital (pdf.js) ou fotografia (Tesseract, português) — nome da entidade, categoria sugerida e, sem QR, data e total.

Todos os campos continuam editáveis. Recibos estrangeiros e talões sem QR leem-se pior: confirmar sempre.
A Edge Function `exp-ocr` (Claude, chave `ANTHROPIC_API_KEY`) está preparada mas não é usada nesta versão.

## Instalação de raiz (só para recriar a plataforma)

### 1. Base de dados
Supabase → **SQL Editor** → correr os ficheiros de `supabase/migrations/` **uma vez, por ordem de data**, numa base de dados nova.
As migrações a partir de 3/11 podem voltar a correr sem problema; as duas primeiras (2/11) não, porque ainda criam a coluna do DocuSign, removida depois.
Depois de mudar funções ou colunas: `notify pgrst, 'reload schema';`.

Os ficheiros de 3/11 e 4/11 foram reconstruídos a 11/11/2026 a partir da definição em produção. Correr todas as migrações numa base de dados nova dá exatamente a estrutura de produção (verificado: 194 objetos, sem diferenças).

### 2. Emails
Seguir `docs/NOTIFICACOES-EMAIL.md` (conta Gmail, segredos, função `exp-notify` com «Verify JWT» desligado, Vault).

### 3. Netlify
Import from GitHub → `Dlp-SOLIVE/despesas`. Build `npm run build`, pasta `dist` (já em `netlify.toml`).
Environment variables: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API). **Nunca** a service role key.

### 4. Supabase Auth
Authentication → URL Configuration: Site URL `https://legendrept-expenses.netlify.app` e Redirect URL `https://legendrept-expenses.netlify.app/**`.

### 5. Primeiro administrador
Criar conta no site e pedir acesso. No SQL Editor:
```sql
insert into public.exp_profiles(staff_member_id, role, active, company_id)
select id, 'admin', true, 'LEGDR' from public.staff_members where lower(email) = lower('o.seu.email@legendre.pt')
on conflict (staff_member_id) do update set role = 'admin', active = true;
```
A partir daí, em **Administração**: cost centers, aprovar utilizadores, perfil (Colaborador, Manager, RH, Administrativo) e manager de cada um.

## Acessos
- Cada colaborador vê os seus pedidos; o manager vê os da equipa; RH, Administrativo e administrador veem todos.
- Recibos no bucket privado `despesas-recibos` (`<colaborador>/<pedido>/<ficheiro>`), acessíveis só a quem vê o pedido.
- Conservação legal: 10 anos.

## Alterações futuras
- Ordem: **SQL** no Supabase → **função** (Edge Functions → colar → Deploy) → **merge** no GitHub (deploy automático no Netlify).
- Cada deploy no Netlify gasta créditos: juntar alterações num só merge.
- Confirmar o deploy **Published** e testar numa janela anónima (a cache do browser pode mostrar a versão antiga).
- Editar ficheiros pelo editor do GitHub (lápis) e não por «Upload files», que achata as pastas.
