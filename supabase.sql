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
