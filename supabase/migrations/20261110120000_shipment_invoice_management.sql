CREATE TABLE IF NOT EXISTS public.shipment_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  invoice_type text NOT NULL CHECK (invoice_type IN ('tax_invoice','bill_of_supply','commercial_invoice')),
  invoice_date date NOT NULL,
  due_date date,
  job_id uuid REFERENCES public.forwarding_jobs(id) ON DELETE SET NULL,
  hbl_id uuid REFERENCES public.forwarding_job_hbls(id) ON DELETE SET NULL,
  container_no text,
  seller jsonb NOT NULL DEFAULT '{}'::jsonb,
  buyer jsonb NOT NULL DEFAULT '{}'::jsonb,
  supply_type text NOT NULL CHECK (supply_type IN ('intra_state','inter_state','export_lut','export_igst','not_applicable')),
  place_of_supply text NOT NULL DEFAULT '',
  place_of_supply_state_code text NOT NULL DEFAULT '',
  reverse_charge boolean NOT NULL DEFAULT false,
  po_number text NOT NULL DEFAULT '',
  payment_terms text NOT NULL DEFAULT '',
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(20,8) NOT NULL CHECK (exchange_rate_to_inr > 0),
  fx_date date,
  fx_source text NOT NULL DEFAULT '',
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  subtotal numeric(20,2) NOT NULL DEFAULT 0,
  discount_total numeric(20,2) NOT NULL DEFAULT 0,
  taxable_value numeric(20,2) NOT NULL DEFAULT 0,
  cgst_total numeric(20,2) NOT NULL DEFAULT 0,
  sgst_total numeric(20,2) NOT NULL DEFAULT 0,
  igst_total numeric(20,2) NOT NULL DEFAULT 0,
  total_tax numeric(20,2) NOT NULL DEFAULT 0,
  adjustment numeric(20,2) NOT NULL DEFAULT 0,
  total numeric(20,2) NOT NULL DEFAULT 0,
  total_inr numeric(20,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  issued_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_invoices_issue_state_check CHECK (
    (status = 'draft' AND invoice_number IS NULL AND issued_at IS NULL)
    OR (status = 'issued' AND invoice_number IS NOT NULL AND issued_at IS NOT NULL)
  )
);
ALTER TABLE public.shipment_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoices TO service_role;
CREATE INDEX IF NOT EXISTS shipment_invoices_created_at_idx ON public.shipment_invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS shipment_invoices_job_id_idx ON public.shipment_invoices (job_id) WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shipment_invoice_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shipment_invoice_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoice_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoice_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.shipment_invoice_sequences (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);
ALTER TABLE public.shipment_invoice_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoice_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoice_sequences TO service_role;

CREATE OR REPLACE FUNCTION public.issue_shipment_invoice(p_invoice_id uuid, p_user_id uuid)
RETURNS public.shipment_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invoice_row public.shipment_invoices;
  start_year integer;
  fy text;
  next_number integer;
BEGIN
  SELECT * INTO invoice_row
  FROM public.shipment_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;
  IF invoice_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be issued.';
  END IF;

  start_year := EXTRACT(YEAR FROM invoice_row.invoice_date)::integer
    - CASE WHEN EXTRACT(MONTH FROM invoice_row.invoice_date)::integer < 4 THEN 1 ELSE 0 END;
  fy := RIGHT(start_year::text, 2) || '-' || RIGHT((start_year + 1)::text, 2);

  INSERT INTO public.shipment_invoice_sequences(financial_year, last_number)
  VALUES (fy, 1)
  ON CONFLICT (financial_year)
  DO UPDATE SET last_number = public.shipment_invoice_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  IF next_number > 999999 THEN
    RAISE EXCEPTION 'Invoice sequence limit reached for this financial year.';
  END IF;

  UPDATE public.shipment_invoices
  SET invoice_number = 'INV/' || fy || '/' || LPAD(next_number::text, 6, '0'),
      status = 'issued',
      issued_at = now(),
      updated_by = p_user_id,
      updated_at = now()
  WHERE id = p_invoice_id
  RETURNING * INTO invoice_row;

  RETURN invoice_row;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_shipment_invoice(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_shipment_invoice(uuid, uuid) TO service_role;