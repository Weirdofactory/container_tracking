ALTER TABLE public.customer_accounts
  ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.customer_accounts.contact_name
  IS 'Primary customer contact used for operations and accounts correspondence';
