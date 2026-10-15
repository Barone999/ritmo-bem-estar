-- Optional sexual activity log for each cycle day.
-- NULL means "not recorded"; false means the user explicitly recorded no activity.
ALTER TABLE public.cycle_logs
  ADD COLUMN IF NOT EXISTS sexual_activity boolean NULL;
