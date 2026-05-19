-- supabase.sql
-- Create table for schedule state

CREATE TABLE IF NOT EXISTS public.schedule_state (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_state_id ON public.schedule_state (id);

-- Insert initial row (id = 'main')
INSERT INTO public.schedule_state (id, payload)
VALUES (
  'main',
  '{"courses": [], "meta": {"source":"admin","version":1}}'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET payload = EXCLUDED.payload, updated_at = now();

-- Shared bookings table: each row is one reserved seat
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
