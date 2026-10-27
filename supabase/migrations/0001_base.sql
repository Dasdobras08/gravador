-- Confere — base de contas, planos, saldo de minutos e reuniões.
-- Aplicar no SQL Editor do Supabase (ou `supabase db push`). Veja docs/SUPABASE.md.
-- Segurança: toda tabela com dados de usuário tem RLS; o servidor usa o token do usuário
-- (RLS vale) e só usa a chave de serviço no processamento em segundo plano e no saldo.

-- ───────────────────────────── Planos ─────────────────────────────
create table public.plans (
  id text primary key,
  name text not null,
  allowance_minutes int not null check (allowance_minutes >= 0),
  trial_days int,            -- só o plano de teste tem prazo próprio
  price_cents int,           -- BRL em centavos; NULL = a definir
  active boolean not null default true
);

-- PLACEHOLDERS: confirme minutos e preços antes de lançar.
insert into public.plans (id, name, allowance_minutes, trial_days, price_cents) values
  ('teste',         'Teste gratuito', 20,   7,    0),
  ('intermediario', 'Intermediário',  300,  null, null),
  ('premium',       'Premium',        1200, null, null);

-- ─────────────────────── Perfis e assinatura ───────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  period_start timestamptz not null default now(),
  period_end timestamptz not null,
  provider text,
  provider_ref text,
  updated_at timestamptz not null default now()
);

-- Livro de saldo. bucket 'plan' = consumo da franquia do período; 'extra' = minutos avulsos
-- (positivo = compra, negativo = consumo). Só o servidor (service_role) escreve aqui.
create table public.minute_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('plan', 'extra')),
  delta_seconds int not null,
  reason text not null check (reason in ('usage', 'extra_purchase', 'adjustment')),
  period_start timestamptz,
  meeting_id uuid,           -- sem FK: apagar a reunião não apaga o histórico de consumo
  note text,
  created_at timestamptz not null default now(),
  check (bucket = 'extra' or period_start is not null)
);
create index minute_ledger_user_idx on public.minute_ledger (user_id, bucket, period_start);

-- ───────────────────────────── Reuniões ─────────────────────────────
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  filename text,
  mime text,
  source text not null default 'arquivo' check (source in ('gravacao', 'arquivo')),
  duration_sec numeric,
  marks jsonb not null default '[]'::jsonb,
  status text not null default 'transcribing' check (status in ('transcribing', 'summarizing', 'ready', 'error')),
  error text,
  failed_stage text,
  demo boolean not null default false,
  transcript jsonb,
  result jsonb,
  audio_path text,           -- objeto no Storage: <user_id>/<meeting_id>
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetings_user_created_idx on public.meetings (user_id, created_at desc);
create index meetings_pending_idx on public.meetings (status) where status in ('transcribing', 'summarizing');

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

-- ─────────────────── Novo usuário → perfil + teste de 7 dias ───────────────────
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.plans;
begin
  select * into t from public.plans where id = 'teste';
  insert into public.profiles (id) values (new.id);
  insert into public.subscriptions (user_id, plan_id, status, period_start, period_end)
  values (new.id, 'teste', 'trialing', now(), now() + make_interval(days => coalesce(t.trial_days, 7)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── Saldo ─────────────────────────────
create function public._quota_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (
    select s.*, p.name as plan_name, p.allowance_minutes
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.user_id = p_user
  ), x as (
    select s.*,
      greatest(0, s.allowance_minutes * 60 + coalesce((
        select sum(l.delta_seconds) from public.minute_ledger l
        where l.user_id = p_user and l.bucket = 'plan' and l.period_start = s.period_start), 0)) as plan_rem,
      greatest(0, coalesce((
        select sum(l.delta_seconds) from public.minute_ledger l
        where l.user_id = p_user and l.bucket = 'extra'), 0)) as extra_rem
    from s
  )
  select jsonb_build_object(
    'plan_id', plan_id, 'plan_name', plan_name, 'status', status, 'period_end', period_end,
    'plan_seconds_remaining', plan_rem, 'extra_seconds', extra_rem,
    'active', status in ('trialing', 'active') and now() < period_end,
    'can_process', status in ('trialing', 'active') and now() < period_end and (plan_rem + extra_rem) > 0
  ) from x
$$;

-- Saldo do próprio usuário (usa auth.uid(); não aceita id de terceiros).
create function public.my_quota() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public._quota_of(auth.uid())
$$;

-- Consome segundos: primeiro a franquia do plano, depois minutos extras; o excedente da
-- última gravação é absorvido pelo plano. Idempotente por reunião.
create function public.consume_seconds(p_user uuid, p_seconds int, p_meeting uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sub public.subscriptions; allowance int; plan_rem int; extra_rem int;
  take_plan int; take_extra int; rest int;
begin
  if p_seconds is null or p_seconds <= 0 then return public._quota_of(p_user); end if;
  select * into sub from public.subscriptions where user_id = p_user for update;
  if not found then raise exception 'assinatura inexistente'; end if;
  if p_meeting is not null and exists (
      select 1 from public.minute_ledger where meeting_id = p_meeting and reason = 'usage') then
    return public._quota_of(p_user);
  end if;
  select allowance_minutes * 60 into allowance from public.plans where id = sub.plan_id;
  select allowance + coalesce(sum(delta_seconds), 0) into plan_rem from public.minute_ledger
    where user_id = p_user and bucket = 'plan' and period_start = sub.period_start;
  select coalesce(sum(delta_seconds), 0) into extra_rem from public.minute_ledger
    where user_id = p_user and bucket = 'extra';
  take_plan := least(p_seconds, greatest(plan_rem, 0));
  rest := p_seconds - take_plan;
  take_extra := least(rest, greatest(extra_rem, 0));
  rest := rest - take_extra;  -- excedente absorvido pelo plano
  if take_plan + rest > 0 then
    insert into public.minute_ledger (user_id, bucket, delta_seconds, reason, period_start, meeting_id)
    values (p_user, 'plan', -(take_plan + rest), 'usage', sub.period_start, p_meeting);
  end if;
  if take_extra > 0 then
    insert into public.minute_ledger (user_id, bucket, delta_seconds, reason, meeting_id)
    values (p_user, 'extra', -take_extra, 'usage', p_meeting);
  end if;
  return public._quota_of(p_user);
end $$;

-- Crédito de minutos extras (chamado pelo servidor após pagamento confirmado).
create function public.grant_extra_seconds(p_user uuid, p_seconds int, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_seconds <= 0 then raise exception 'quantidade inválida'; end if;
  insert into public.minute_ledger (user_id, bucket, delta_seconds, reason, note)
  values (p_user, 'extra', p_seconds, 'extra_purchase', p_note);
  return public._quota_of(p_user);
end $$;

revoke all on function public._quota_of(uuid), public.consume_seconds(uuid, int, uuid),
  public.grant_extra_seconds(uuid, int, text), public.my_quota() from public, anon, authenticated;
grant execute on function public.my_quota() to authenticated;
grant execute on function public._quota_of(uuid), public.consume_seconds(uuid, int, uuid),
  public.grant_extra_seconds(uuid, int, text) to service_role;

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.minute_ledger enable row level security;
alter table public.meetings enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy subs_read on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_read on public.minute_ledger for select to authenticated using (user_id = (select auth.uid()));

create policy meetings_select on public.meetings for select to authenticated using (user_id = (select auth.uid()));
create policy meetings_insert on public.meetings for insert to authenticated with check (user_id = (select auth.uid()));
create policy meetings_update on public.meetings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy meetings_delete on public.meetings for delete to authenticated using (user_id = (select auth.uid()));

-- Usuários nunca escrevem em plans, subscriptions e minute_ledger (sem policy de escrita = negado).
revoke insert, update, delete on public.plans, public.subscriptions, public.minute_ledger from anon, authenticated;

-- ───────────────────────────── Storage (áudio privado) ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 26214400, array['audio/*', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy audio_select on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
