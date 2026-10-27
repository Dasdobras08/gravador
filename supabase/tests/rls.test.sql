-- Testes da migração 0001 em Postgres real (com stubs.sql). Falha com erro se algo estiver errado.
\set ON_ERROR_STOP on
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as
  $$ begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x.com'), ('bbbbbbbb-0000-0000-0000-000000000002', 'b@x.com');

-- novo usuário: perfil + teste de 7 dias com 20 min
select pg_temp.ok((select count(*) from public.profiles) = 2, 'perfis criados pelo gatilho');
select pg_temp.ok((select plan_id = 'teste' and status = 'trialing' and period_end - period_start = interval '7 days'
  from public.subscriptions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'teste de 7 dias');
select pg_temp.ok((select (public._quota_of('aaaaaaaa-0000-0000-0000-000000000001')->>'plan_seconds_remaining')::int = 1200),
  '20 minutos de saldo');

-- consumo: 15 min saem do plano; 10 min: 5 do plano + 5 de extra (se houver) senão excedente absorvido
select public.consume_seconds('aaaaaaaa-0000-0000-0000-000000000001', 900, 'cccccccc-0000-0000-0000-000000000001');
select pg_temp.ok((select (public._quota_of('aaaaaaaa-0000-0000-0000-000000000001')->>'plan_seconds_remaining')::int = 300), 'restam 5 min');
select public.consume_seconds('aaaaaaaa-0000-0000-0000-000000000001', 900, 'cccccccc-0000-0000-0000-000000000001');
select pg_temp.ok((select (public._quota_of('aaaaaaaa-0000-0000-0000-000000000001')->>'plan_seconds_remaining')::int = 300), 'consumo idempotente por reunião');
select public.grant_extra_seconds('aaaaaaaa-0000-0000-0000-000000000001', 600, 'teste');
select public.consume_seconds('aaaaaaaa-0000-0000-0000-000000000001', 600, 'cccccccc-0000-0000-0000-000000000002');
select pg_temp.ok((select (q->>'plan_seconds_remaining')::int = 0 and (q->>'extra_seconds')::int = 300
  from (select public._quota_of('aaaaaaaa-0000-0000-0000-000000000001') q) t), 'plano esgota e extras cobrem o resto');
select public.consume_seconds('aaaaaaaa-0000-0000-0000-000000000001', 2000, 'cccccccc-0000-0000-0000-000000000003');
select pg_temp.ok((select (q->>'can_process')::boolean = false from (select public._quota_of('aaaaaaaa-0000-0000-0000-000000000001') q) t),
  'saldo zerado bloqueia novo processamento');
-- teste expirado bloqueia
update public.subscriptions set period_end = now() - interval '1 day' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.ok((select (public._quota_of('bbbbbbbb-0000-0000-0000-000000000002')->>'can_process')::boolean = false), 'teste expirado bloqueia');
update public.subscriptions set period_end = now() + interval '7 days' where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- RLS como usuário A
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.meetings (title) values ('Reunião de A');
select pg_temp.ok((select count(*) from public.meetings) = 1, 'A vê a própria reunião');
select pg_temp.ok((select user_id = auth.uid() from public.meetings limit 1), 'user_id padrão = auth.uid()');
select pg_temp.ok((select count(*) from public.subscriptions) = 1, 'A vê só a própria assinatura');
select pg_temp.ok((select count(*) from public.minute_ledger) > 0 and (select count(distinct user_id) from public.minute_ledger) = 1, 'A vê só o próprio saldo');
select pg_temp.ok((select (public.my_quota()->>'plan_id') = 'teste'), 'my_quota funciona para o próprio usuário');

do $$ begin
  begin insert into public.meetings (title, user_id) values ('forjada', 'bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'FALHOU: A inseriu reunião em nome de B';
  exception when insufficient_privilege or check_violation then null; end;
  begin perform public.consume_seconds('aaaaaaaa-0000-0000-0000-000000000001', 1, null);
    raise exception 'FALHOU: usuário executou consume_seconds';
  exception when insufficient_privilege then null; end;
  begin perform public.grant_extra_seconds('aaaaaaaa-0000-0000-0000-000000000001', 99999, 'x');
    raise exception 'FALHOU: usuário concedeu minutos a si';
  exception when insufficient_privilege then null; end;
  begin perform public._quota_of('bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'FALHOU: usuário leu saldo de outro';
  exception when insufficient_privilege then null; end;
  begin update public.subscriptions set plan_id = 'premium';
    raise exception 'FALHOU: usuário trocou o próprio plano';
  exception when insufficient_privilege then null; end;
  begin insert into public.minute_ledger (user_id, bucket, delta_seconds, reason, period_start)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 'plan', 99999, 'adjustment', now());
    raise exception 'FALHOU: usuário escreveu no livro de saldo';
  exception when insufficient_privilege then null; end;
end $$;

-- A tenta mexer na reunião de B: não enxerga nem altera
reset role;
insert into public.meetings (title, user_id) values ('Reunião de B', 'bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.meetings where title = 'Reunião de B') = 0, 'A não enxerga reunião de B');
update public.meetings set title = 'hack' where title = 'Reunião de B';
delete from public.meetings where title = 'Reunião de B';
reset role;
select pg_temp.ok((select count(*) from public.meetings where title = 'Reunião de B') = 1, 'reunião de B intacta');

-- Storage: pasta do próprio usuário
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into storage.objects (bucket_id, name) values ('audio', 'aaaaaaaa-0000-0000-0000-000000000001/m1');
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('audio', 'bbbbbbbb-0000-0000-0000-000000000002/m1');
    raise exception 'FALHOU: A gravou na pasta de B';
  exception when insufficient_privilege or check_violation then null; end;
end $$;
reset role;
select pg_temp.ok((select not public from storage.buckets where id = 'audio'), 'bucket privado');

-- apagar usuário apaga tudo (LGPD)
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from public.meetings where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.minute_ledger where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.subscriptions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'exclusão em cascata');
\echo TODOS OS TESTES SQL PASSARAM
