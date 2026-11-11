CREATE TABLE IF NOT EXISTS public.customer_account_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  department text NOT NULL DEFAULT '',
  contact_type text NOT NULL DEFAULT 'operations'
    CHECK (contact_type IN ('accounts','operations','sales','customs','management','other')),
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_account_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_account_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_account_contacts TO service_role;
CREATE INDEX IF NOT EXISTS customer_account_contacts_customer_idx
  ON public.customer_account_contacts (customer_id, is_active, lower(contact_name));

CREATE TABLE IF NOT EXISTS public.customer_account_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  address_type text NOT NULL DEFAULT 'other'
    CHECK (address_type IN ('registered','billing','pickup','delivery','branch','other')),
  label text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  gstin text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_account_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_account_addresses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_account_addresses TO service_role;
CREATE INDEX IF NOT EXISTS customer_account_addresses_customer_idx
  ON public.customer_account_addresses (customer_id, address_type, is_active);
