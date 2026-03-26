-- Support background fetch runs and synced in-app/email notification preferences
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.fetch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  initiated_by UUID,
  summary TEXT,
  error_message TEXT,
  result_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fetch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view fetch runs"
ON public.fetch_runs
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can queue fetch runs"
ON public.fetch_runs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND (initiated_by IS NULL OR initiated_by = auth.uid()));

CREATE INDEX idx_fetch_runs_status_created_at
ON public.fetch_runs (status, created_at DESC);

CREATE INDEX idx_fetch_runs_scheduled_for
ON public.fetch_runs (scheduled_for)
WHERE status = 'queued';

CREATE TRIGGER update_fetch_runs_updated_at
BEFORE UPDATE ON public.fetch_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  in_app_fetch_complete BOOLEAN NOT NULL DEFAULT true,
  email_fetch_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification preferences"
ON public.notification_preferences
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
ON public.notification_preferences
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
ON public.notification_preferences
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fetch_run_id UUID REFERENCES public.fetch_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fetch_complete',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own app notifications"
ON public.app_notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own app notifications"
ON public.app_notifications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own app notifications"
ON public.app_notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_app_notifications_user_created_at
ON public.app_notifications (user_id, created_at DESC);

CREATE INDEX idx_app_notifications_unread
ON public.app_notifications (user_id, read_at, created_at DESC);