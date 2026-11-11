CREATE TABLE IF NOT EXISTS public.forwarding_job_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.forwarding_jobs(id) ON DELETE CASCADE,
  leg_no integer NOT NULL CHECK (leg_no BETWEEN 1 AND 99),
  leg_role text NOT NULL DEFAULT 'main_carriage'
    CHECK (leg_role IN ('pre_carriage','main_carriage','transshipment','on_carriage','last_mile','other')),
  mode text NOT NULL DEFAULT 'ocean'
    CHECK (mode IN ('ocean','air','road','rail','barge','warehouse','other')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','booked','cargo_received','departed','in_transit','arrived','customs','delivered','exception','cancelled')),
  carrier text NOT NULL DEFAULT '',
  service_reference text NOT NULL DEFAULT '',
  tracking_reference text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT '',
  etd date,
  eta date,
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  customer_visible boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forwarding_job_legs_job_leg_no_key UNIQUE (job_id, leg_no)
);
ALTER TABLE public.forwarding_job_legs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forwarding_job_legs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forwarding_job_legs TO service_role;
CREATE INDEX IF NOT EXISTS forwarding_job_legs_job_order_idx
  ON public.forwarding_job_legs (job_id, leg_no) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.forwarding_job_leg_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.forwarding_jobs(id) ON DELETE CASCADE,
  leg_id uuid NOT NULL REFERENCES public.forwarding_job_legs(id) ON DELETE CASCADE,
  event_code text NOT NULL CHECK (event_code IN
    ('booking_confirmed','cargo_received','departed','transshipment_arrived','arrived','customs_cleared','delivered','exception','other')),
  event_name text NOT NULL,
  location text NOT NULL DEFAULT '',
  event_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '',
  customer_visible boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.forwarding_job_leg_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forwarding_job_leg_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forwarding_job_leg_events TO service_role;
CREATE INDEX IF NOT EXISTS forwarding_job_leg_events_leg_time_idx
  ON public.forwarding_job_leg_events (leg_id, event_at DESC);
CREATE INDEX IF NOT EXISTS forwarding_job_leg_events_job_time_idx
  ON public.forwarding_job_leg_events (job_id, event_at DESC);
