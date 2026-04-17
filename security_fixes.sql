-- ============================================================
-- vueltapp — Security fixes
-- Correr en Supabase SQL Editor
-- ============================================================


-- ════════════════════════════════
-- 1. RLS: políticas con ownership real
-- ════════════════════════════════

-- Users: cada uno ve y edita solo su propio perfil
drop policy if exists "Authenticated: all on users" on public.users;

create policy "users: select all authenticated"    on public.users for select to authenticated using (true);
create policy "users: insert own"                  on public.users for insert to authenticated with check (id = auth.uid());
create policy "users: update own"                  on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Trips: todos ven; solo el conductor puede insertar/actualizar/borrar sus viajes
drop policy if exists "Authenticated: all on trips" on public.trips;

create policy "trips: select all authenticated"    on public.trips for select to authenticated using (true);
create policy "trips: insert own"                  on public.trips for insert to authenticated with check (driver_id = auth.uid());
create policy "trips: update own"                  on public.trips for update to authenticated using (driver_id = auth.uid());
create policy "trips: delete own"                  on public.trips for delete to authenticated using (driver_id = auth.uid());

-- Requests: conductor y pasajero ven sus propias; insertar libre (para solicitar);
--           solo el conductor puede aprobar/rechazar (update cuando es driver);
--           solo el pasajero o conductor puede cancelar (update cuando es requester/driver)
drop policy if exists "Authenticated: all on requests" on public.requests;

create policy "requests: select own"               on public.requests for select to authenticated
  using (driver_id = auth.uid() or requester_id = auth.uid());

create policy "requests: insert as requester"      on public.requests for insert to authenticated
  with check (requester_id = auth.uid());

create policy "requests: update as driver"         on public.requests for update to authenticated
  using (driver_id = auth.uid());

create policy "requests: cancel as requester"      on public.requests for update to authenticated
  using (requester_id = auth.uid() and status in ('solicitado', 'aprobado'));

-- Payments: solo las partes involucradas pueden ver; inserción via RPC (ver abajo)
drop policy if exists "Authenticated: all on payments" on public.payments;

create policy "payments: select own"               on public.payments for select to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- Pagos solo se insertan via RPC add_payment (que valida que auth.uid() = to_user_id)
-- No se permite insert directo desde el cliente
create policy "payments: no direct insert"         on public.payments for insert to authenticated
  with check (false);


-- ════════════════════════════════
-- 2. Token: invalidar después de usar
-- ════════════════════════════════

create or replace function public.respond_to_request_by_token(
  p_token   uuid,
  p_action  text,
  p_comment text default ''
)
returns jsonb language plpgsql security definer as $$
declare
  v_req record;
begin
  select * into v_req from public.requests where token = p_token;
  if not found then
    return '{"error":"Link inválido o ya fue usado"}'::jsonb;
  end if;
  if v_req.status != 'solicitado' then
    return jsonb_build_object('error', 'Esta solicitud ya fue respondida (' || v_req.status || ')');
  end if;

  update public.requests set
    status         = case when p_action = 'approve' then 'aprobado' else 'rechazado' end,
    driver_comment = p_comment,
    token          = null,   -- invalidar token después de usar
    updated_at     = now()
  where token = p_token;

  return '{"ok":true}'::jsonb;
end;
$$;


-- ════════════════════════════════
-- 3. CHECK constraints: validación en DB
-- ════════════════════════════════

-- Parcela: número entre 1 y 50
alter table public.users drop constraint if exists users_parcela_check;
alter table public.users add constraint users_parcela_check
  check (parcela ~ '^\d{1,2}$' and parcela::int between 1 and 50);

-- Nombre: no vacío, máx 100 chars
alter table public.users drop constraint if exists users_name_check;
alter table public.users add constraint users_name_check
  check (length(trim(name)) > 0 and length(name) <= 100);

-- Nota de viaje: máx 500 chars
alter table public.trips drop constraint if exists trips_note_check;
alter table public.trips add constraint trips_note_check
  check (length(note) <= 500);

-- Hora: formato HH:MM
alter table public.trips drop constraint if exists trips_time_check;
alter table public.trips add constraint trips_time_check
  check (time ~ '^\d{2}:\d{2}$');

-- Dirección: solo valores válidos
alter table public.trips drop constraint if exists trips_direction_check;
alter table public.trips add constraint trips_direction_check
  check (direction in ('salida', 'regreso'));

-- Cupos: entre 1 y 10
alter table public.trips drop constraint if exists trips_seats_check;
alter table public.trips add constraint trips_seats_check
  check (total_seats between 1 and 10);

-- Nota de solicitud: máx 300 chars
alter table public.requests drop constraint if exists requests_note_check;
alter table public.requests add constraint requests_note_check
  check (length(note) <= 300);

-- Comentario del conductor: máx 300 chars
alter table public.requests drop constraint if exists requests_comment_check;
alter table public.requests add constraint requests_comment_check
  check (length(driver_comment) <= 300);

-- Monto de pago: positivo
alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments add constraint payments_amount_check
  check (amount > 0);

-- Solicitud única por viaje/pasajero (no duplicar)
alter table public.requests drop constraint if exists requests_unique_active;
alter table public.requests add constraint requests_unique_active
  unique (trip_id, requester_id);


-- ════════════════════════════════
-- 4. RPC: registro de pago con autorización server-side
-- ════════════════════════════════

create or replace function public.add_payment(
  p_from_user_id uuid,
  p_amount       int
)
returns jsonb language plpgsql security definer as $$
begin
  -- Solo el acreedor (auth.uid() = to_user_id) puede registrar el pago
  if auth.uid() is null then
    return '{"error":"No autenticado"}'::jsonb;
  end if;
  if p_amount <= 0 then
    return '{"error":"Monto inválido"}'::jsonb;
  end if;

  insert into public.payments (from_user_id, to_user_id, amount)
  values (p_from_user_id, auth.uid(), p_amount);

  return '{"ok":true}'::jsonb;
end;
$$;
