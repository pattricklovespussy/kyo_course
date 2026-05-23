-- Supabase schema for kyo_course-main
-- Paste this whole file into Supabase SQL Editor.

create extension if not exists pgcrypto;

CREATE TABLE IF NOT EXISTS public.schedule_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_state_id ON public.schedule_state (id);

-- Insert initial schedule row (id = 'main')
INSERT INTO public.schedule_state (id, payload)
VALUES (
  'main',
  '{"courses": [], "meta": {"source":"admin","version":1}}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET payload = EXCLUDED.payload, updated_at = now();

-- Bookings table: each row is one reserved seat
CREATE TABLE IF NOT EXISTS public.schedule_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  user_name text NOT NULL,
  course_id text NOT NULL,
  course_name text,
  day int NOT NULL,
  time text NOT NULL,
  slot_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_bookings_course_id ON public.schedule_bookings (course_id);
CREATE INDEX IF NOT EXISTS idx_schedule_bookings_user_id ON public.schedule_bookings (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_bookings_user_slot ON public.schedule_bookings (user_id, slot_key);

-- Discord OAuth credentials for auto-join / DM flows
CREATE TABLE IF NOT EXISTS public.discord_users (
  user_id text PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  discord_username text NOT NULL,
  discord_access_token text NOT NULL,
  discord_refresh_token text,
  discord_token_scope text,
  discord_token_type text,
  discord_avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discord_users_discord_id ON public.discord_users (discord_id);

-- UID verification requests (user submits UID, admin approves/rejects)
CREATE TABLE IF NOT EXISTS public.discord_uid_verifications (
  user_id text PRIMARY KEY,
  discord_username text,
  discord_uid text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uid_verifications_status ON public.discord_uid_verifications (status);
CREATE INDEX IF NOT EXISTS idx_uid_verifications_submitted_at ON public.discord_uid_verifications (submitted_at DESC);
