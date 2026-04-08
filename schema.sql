-- ============================================================
-- vueltapp — Supabase Schema
-- ============================================================
-- SETUP:
-- 1. Crear proyecto en supabase.com
-- 2. SQL Editor → New Query → pegar este archivo completo
-- 3. Reemplazar los 3 valores de configuración de email (abajo)
-- 4. Ejecutar todo
-- ============================================================

-- ── Configuración de email (completar antes de ejecutar) ──
-- Paso 1: Crear cuenta en resend.com → obtener API key
-- Paso 2: Agregar dominio mercadovecinos.cl y verificarlo (3 registros DNS)
-- Paso 3: Reemplazar los valores de abajo

-- RESEND_KEY  → tu API key de resend.com (ej: re_xxxxxxxxxxxxxxxx)
-- FROM_EMAIL  → ej: vueltapp@mercadovecinos.cl
-- APP_URL     → https://mercadovecinos.github.io/vueltapp

-- ════════════════════════════════════════════════════════════


-- ── Extensión para HTTP requests (emails) ──
create extension if not exists pg_net;


-- ════════════════════════════════
-- TABLAS
-- ════════════════════════════════

create table if not exists public.users (
  id         uuid references auth.users on delete cascade primary key,
  name       text not null,
  parcela    text not null,
  created_at timestamptz default now()
);

create table if not exists public.trips (
  id             uuid default gen_random_uuid() primary key,
  driver_id      uuid references public.users(id) on delete cascade not null,
  driver_name    text not null,
  driver_parcela text not null,
  date           date not null,
  time           text not null,
  direction      text not null,      -- 'salida' | 'vuelta'
  pueblo_point   text not null,
  total_seats    int  not null,
  note           text default '',
  created_at     timestamptz default now()
);

create table if not exists public.requests (
  id               uuid default gen_random_uuid() primary key,
  trip_id          uuid references public.trips(id) on delete cascade not null,
  driver_id        uuid references public.users(id),
  driver_name      text,
  requester_id     uuid references public.users(id) not null,
  requester_name   text not null,
  requester_parcela text not null,
  status           text not null default 'solicitado', -- solicitado|aprobado|rechazado|cancelado
  token            uuid default gen_random_uuid() unique,
  driver_comment   text default '',
  note             text default '',
  cancel_reason    text default '',  -- 'by_driver' | 'by_passenger'
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.payments (
  id           uuid default gen_random_uuid() primary key,
  from_user_id uuid references public.users(id) not null,
  to_user_id   uuid references public.users(id) not null,
  amount       int  not null,
  created_at   timestamptz default now()
);


-- ════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════
-- Usuarios autenticados pueden leer y escribir todo.
-- La lógica de negocio (quién puede cancelar qué, etc.) se valida en el código JS.

alter table public.users    enable row level security;
alter table public.trips    enable row level security;
alter table public.requests enable row level security;
alter table public.payments enable row level security;

-- Users
create policy "Authenticated: all on users" on public.users
  for all to authenticated using (true) with check (true);

-- Trips
create policy "Authenticated: all on trips" on public.trips
  for all to authenticated using (true) with check (true);

-- Requests
create policy "Authenticated: all on requests" on public.requests
  for all to authenticated using (true) with check (true);

-- Payments
create policy "Authenticated: all on payments" on public.payments
  for all to authenticated using (true) with check (true);


-- ════════════════════════════════
-- RPCs (llamadas especiales)
-- ════════════════════════════════

-- Leer solicitud por token (para responder desde email sin estar logueado)
create or replace function public.get_request_for_email(p_token uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_req  record;
  v_trip record;
begin
  select * into v_req from public.requests where token = p_token;
  if not found then return '{"error":"Link inválido o ya fue usado"}'::jsonb; end if;

  select * into v_trip from public.trips where id = v_req.trip_id;

  return jsonb_build_object(
    'status',          v_req.status,
    'requester_name',  v_req.requester_name,
    'driver_name',     v_req.driver_name,
    'note',            v_req.note,
    'trip_date',       v_trip.date::text,
    'trip_time',       v_trip.time,
    'direction',       v_trip.direction,
    'pueblo_point',    v_trip.pueblo_point
  );
end;
$$;

-- Responder solicitud por token (aprobar/rechazar desde link del email)
create or replace function public.respond_to_request_by_token(
  p_token   uuid,
  p_action  text,      -- 'approve' | 'reject'
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
    updated_at     = now()
  where token = p_token;

  return '{"ok":true}'::jsonb;
end;
$$;


-- ════════════════════════════════
-- EMAIL TRIGGERS (via pg_net → Resend)
-- ════════════════════════════════
-- Si no tienes Resend configurado aún, igual puedes ejecutar este schema.
-- Los triggers simplemente no enviarán emails hasta que pongas la key real.

-- 1. Nueva solicitud → email al conductor
create or replace function public.notify_new_request()
returns trigger language plpgsql security definer as $$
declare
  v_trip         record;
  v_driver_email text;
  v_route        text;
  v_body         text;
  v_approve_url  text;
  v_reject_url   text;
  -- ▼ REEMPLAZAR ESTOS VALORES ▼
  v_resend_key   text := '!!RESEND_KEY!!';
  v_from         text := '!!FROM_EMAIL!!';
  v_app_url      text := '!!APP_URL!!';
  -- ▲ REEMPLAZAR ESTOS VALORES ▲
begin
  if v_resend_key = '!!RESEND_KEY!!' then return new; end if; -- sin configurar, salir

  select * into v_trip from public.trips where id = new.trip_id;
  select email into v_driver_email from auth.users where id = new.driver_id;
  if v_driver_email is null then return new; end if;

  v_route       := case when v_trip.direction = 'salida' then 'PBI → ' || v_trip.pueblo_point else v_trip.pueblo_point || ' → PBI' end;
  v_approve_url := v_app_url || '/?respond=approve&token=' || new.token;
  v_reject_url  := v_app_url || '/?respond=reject&token='  || new.token;

  v_body :=
    new.requester_name || ' (Parcela ' || new.requester_parcela || ') quiere unirse a tu viaje del ' ||
    to_char(v_trip.date, 'DD/MM/YYYY') || ' a las ' || v_trip.time || chr(10) ||
    'Ruta: ' || v_route ||
    case when coalesce(new.note,'') != '' then chr(10) || chr(10) || 'Nota del pasajero: "' || new.note || '"' else '' end ||
    chr(10) || chr(10) || '✅ APROBAR: ' || v_approve_url ||
    chr(10) || chr(10) || '❌ RECHAZAR: ' || v_reject_url ||
    chr(10) || chr(10) || 'O responde directamente desde vueltapp.';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_resend_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from',    v_from,
      'to',      array[v_driver_email],
      'subject', '🛻 Solicitud de viaje — ' || new.requester_name,
      'text',    v_body
    )::text
  );
  return new;
exception when others then return new;
end;
$$;

create trigger trg_new_request
  after insert on public.requests
  for each row execute function public.notify_new_request();


-- 2. Solicitud respondida / cancelada → email al pasajero o conductor
create or replace function public.notify_request_update()
returns trigger language plpgsql security definer as $$
declare
  v_trip          record;
  v_driver_email  text;
  v_req_email     text;
  v_route         text;
  v_to_email      text;
  v_subject       text;
  v_body          text;
  -- ▼ REEMPLAZAR ESTOS VALORES ▼
  v_resend_key    text := '!!RESEND_KEY!!';
  v_from          text := '!!FROM_EMAIL!!';
  -- ▲ REEMPLAZAR ESTOS VALORES ▲
begin
  if v_resend_key = '!!RESEND_KEY!!' then return new; end if;

  select * into v_trip from public.trips where id = new.trip_id;
  v_route := case when v_trip.direction = 'salida' then 'PBI → ' || v_trip.pueblo_point else v_trip.pueblo_point || ' → PBI' end;

  -- Caso 1: aprobado o rechazado → email al pasajero
  if old.status = 'solicitado' and new.status in ('aprobado', 'rechazado') then
    select email into v_req_email from auth.users where id = new.requester_id;
    v_to_email := v_req_email;
    if new.status = 'aprobado' then
      v_subject := '✅ Viaje aprobado — ' || new.driver_name;
      v_body    := new.driver_name || ' aprobó tu solicitud para el ' || to_char(v_trip.date, 'DD/MM/YYYY') || ' a las ' || v_trip.time || '. ¡Nos vemos en la ruta!';
    else
      v_subject := '❌ Solicitud rechazada — ' || new.driver_name;
      v_body    := new.driver_name || ' rechazó tu solicitud para el ' || to_char(v_trip.date, 'DD/MM/YYYY') || ' a las ' || v_trip.time || '.' ||
        case when coalesce(new.driver_comment,'') != '' then chr(10) || chr(10) || 'Comentario: ' || new.driver_comment else '' end;
    end if;

  -- Caso 2: cancelado por conductor → email al pasajero
  elsif new.status = 'cancelado' and new.cancel_reason = 'by_driver' then
    select email into v_req_email from auth.users where id = new.requester_id;
    v_to_email := v_req_email;
    v_subject  := '❌ Viaje cancelado — ' || new.driver_name;
    v_body     := new.driver_name || ' canceló el viaje del ' || to_char(v_trip.date, 'DD/MM/YYYY') || ' a las ' || v_trip.time || '.' ||
      chr(10) || 'Ruta: ' || v_route || chr(10) || chr(10) || 'Tu solicitud quedó sin efecto. Busca otro viaje en vueltapp.';

  -- Caso 3: cancelado por pasajero (era aprobado) → email al conductor
  elsif new.status = 'cancelado' and new.cancel_reason = 'by_passenger' and old.status = 'aprobado' then
    select email into v_driver_email from auth.users where id = new.driver_id;
    v_to_email := v_driver_email;
    v_subject  := '⚠️ Pasajero canceló su cupo — ' || new.requester_name;
    v_body     := new.requester_name || ' canceló su cupo en tu viaje del ' || to_char(v_trip.date, 'DD/MM/YYYY') || ' a las ' || v_trip.time || '.' ||
      chr(10) || 'Ruta: ' || v_route || chr(10) || 'Quedó un cupo libre.';

  else
    return new;
  end if;

  if v_to_email is null or v_to_email = '' then return new; end if;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_resend_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from',    v_from,
      'to',      array[v_to_email],
      'subject', v_subject,
      'text',    v_body
    )::text
  );
  return new;
exception when others then return new;
end;
$$;

create trigger trg_request_update
  after update on public.requests
  for each row execute function public.notify_request_update();
