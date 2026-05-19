-- supabase_cancel_booking.sql
-- SQL snippets for cancelling bookings in the `schedule_bookings` table.
-- Run these in Supabase SQL Editor or via psql using your POSTGRES_CONNECTION_STRING.

-- 1) Cancel a booking by booking `id` (recommended)
-- Replace <booking-uuid> with the actual UUID of the booking row.
-- Example:
-- DELETE FROM public.schedule_bookings WHERE id = '3c9f7f2a-8a3b-4d2a-9f3d-5b6e7f8c9a0b';

-- 2) Cancel a booking by user + slot_key (safer if you don't have the id)
-- Replace <user_id> and <slot_key> with the actual values.
-- Example:
-- DELETE FROM public.schedule_bookings
-- WHERE user_id = 'discord|123456789012345678'
--   AND slot_key = 'course_1|2|20:00';

-- 3) Optional: preview rows that would be deleted before running DELETE
-- SELECT * FROM public.schedule_bookings
-- WHERE user_id = 'discord|123456789012345678'
--   AND slot_key = 'course_1|2|20:00';

-- 4) Audit: move deleted rows to an audit table instead of hard delete
-- CREATE TABLE IF NOT EXISTS public.schedule_bookings_audit (LIKE public.schedule_bookings INCLUDING ALL, deleted_at timestamptz DEFAULT now());
-- WITH moved AS (
--   DELETE FROM public.schedule_bookings
--   WHERE id = '3c9f7f2a-8a3b-4d2a-9f3d-5b6e7f8c9a0b'
--   RETURNING *
-- )
-- INSERT INTO public.schedule_bookings_audit SELECT *, now() FROM moved;

-- Notes:
-- - Use the booking `id` returned by the API on creation when possible.
-- - The serverless API also supports deleting a booking via DELETE /api/bookings?id=<id>&userId=<userId>.
-- - Always run a SELECT first to verify which rows will be affected.
