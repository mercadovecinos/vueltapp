-- ============================================================
-- vueltapp — Preparación para migración desde GAS
-- ============================================================
-- Correr ANTES de importar datos del Sheet.
-- Esto permite insertar usuarios con los UUIDs viejos de GAS
-- y actualiza las referencias automáticamente cuando el usuario
-- hace login por primera vez con su nueva cuenta Supabase.
-- ============================================================

-- 1. Agregar columna email a users (para matchear al hacer login)
alter table public.users add column if not exists email text;

-- 2. Quitar FK que obliga a que users.id exista en auth.users
--    (los IDs viejos de GAS no están en auth.users)
alter table public.users drop constraint if exists users_id_fkey;

-- 3. Agregar ON UPDATE CASCADE en todas las FKs que apuntan a users
--    Así cuando actualizamos users.id (al hacer login), todo se actualiza solo

alter table public.trips drop constraint if exists trips_driver_id_fkey;
alter table public.trips add constraint trips_driver_id_fkey
  foreign key (driver_id) references public.users(id) on update cascade on delete cascade;

alter table public.requests drop constraint if exists requests_driver_id_fkey;
alter table public.requests add constraint requests_driver_id_fkey
  foreign key (driver_id) references public.users(id) on update cascade;

alter table public.requests drop constraint if exists requests_requester_id_fkey;
alter table public.requests add constraint requests_requester_id_fkey
  foreign key (requester_id) references public.users(id) on update cascade;

alter table public.payments drop constraint if exists payments_from_user_id_fkey;
alter table public.payments add constraint payments_from_user_id_fkey
  foreign key (from_user_id) references public.users(id) on update cascade;

alter table public.payments drop constraint if exists payments_to_user_id_fkey;
alter table public.payments add constraint payments_to_user_id_fkey
  foreign key (to_user_id) references public.users(id) on update cascade;
