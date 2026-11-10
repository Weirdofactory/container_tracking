CREATE TABLE IF NOT EXISTS public.customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  gstin text NOT NULL DEFAULT '',
  billing_address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  state_code text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  default_currency text NOT NULL DEFAULT 'INR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  payment_terms text NOT NULL DEFAULT 'Due within 30 days',
  credit_limit_inr numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit_limit_inr >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_accounts TO service_role;
CREATE INDEX IF NOT EXISTS customer_accounts_legal_name_idx ON public.customer_accounts (lower(legal_name));

ALTER TABLE public.forwarding_jobs
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customer_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.shipment_invoices
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customer_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS forwarding_jobs_customer_id_idx ON public.forwarding_jobs (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipment_invoices_customer_id_idx ON public.shipment_invoices (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shipment_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.shipment_invoices(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  credit_date date NOT NULL,
  reason text NOT NULL DEFAULT '',
  invoice_number_snapshot text NOT NULL DEFAULT '',
  seller jsonb NOT NULL DEFAULT '{}'::jsonb,
  buyer jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(20,8) NOT NULL CHECK (exchange_rate_to_inr > 0),
  fx_date date,
  fx_source text NOT NULL DEFAULT '',
  supply_type text NOT NULL CHECK (supply_type IN ('intra_state','inter_state','export_lut','export_igst','not_applicable')),
  place_of_supply text NOT NULL DEFAULT '',
  place_of_supply_state_code text NOT NULL DEFAULT '',
  reverse_charge boolean NOT NULL DEFAULT false,
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
  issued_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_credit_notes_issue_state_check CHECK (
    (status = 'draft' AND credit_note_number IS NULL AND issued_at IS NULL)
    OR (status = 'issued' AND credit_note_number IS NOT NULL AND issued_at IS NOT NULL)
  )
);
ALTER TABLE public.shipment_credit_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_credit_notes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_credit_notes TO service_role;
CREATE INDEX IF NOT EXISTS shipment_credit_notes_invoice_id_idx ON public.shipment_credit_notes (invoice_id, credit_date);

CREATE TABLE IF NOT EXISTS public.shipment_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.shipment_invoices(id) ON DELETE RESTRICT,
  received_at date NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(20,8) NOT NULL CHECK (exchange_rate_to_inr > 0),
  amount_inr numeric(20,2) NOT NULL CHECK (amount_inr > 0),
  fx_date date,
  fx_source text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shipment_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoice_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoice_payments TO service_role;
CREATE INDEX IF NOT EXISTS shipment_invoice_payments_invoice_id_idx ON public.shipment_invoice_payments (invoice_id, received_at);

CREATE TABLE IF NOT EXISTS public.shipment_credit_note_sequences (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);
ALTER TABLE public.shipment_credit_note_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_credit_note_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_credit_note_sequences TO service_role;

CREATE TABLE IF NOT EXISTS public.shipment_payment_sequences (
  period text PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);
ALTER TABLE public.shipment_payment_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_payment_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_payment_sequences TO service_role;

CREATE OR REPLACE FUNCTION public.issue_shipment_credit_note(p_credit_note_id uuid, p_user_id uuid)
RETURNS public.shipment_credit_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  note_row public.shipment_credit_notes;
  invoice_row public.shipment_invoices;
  already_credited numeric(20,2);
  credit_line jsonb;
  original_line_index integer;
  credit_quantity numeric(20,6);
  previously_credited_quantity numeric(20,6);
  original_quantity numeric(20,6);
  start_year integer;
  fy text;
  next_number integer;
BEGIN
  SELECT * INTO note_row
  FROM public.shipment_credit_notes
  WHERE id = p_credit_note_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit note not found.'; END IF;
  IF note_row.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft credit note can be issued.'; END IF;

  SELECT * INTO invoice_row
  FROM public.shipment_invoices
  WHERE id = note_row.invoice_id
  FOR UPDATE;
  IF NOT FOUND OR invoice_row.status <> 'issued' THEN
    RAISE EXCEPTION 'A credit note must reference an issued invoice.';
  END IF;
  IF note_row.currency <> invoice_row.currency THEN
    RAISE EXCEPTION 'Credit note currency must match the invoice currency.';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO already_credited
  FROM public.shipment_credit_notes
  WHERE invoice_id = invoice_row.id AND status = 'issued';
  IF already_credited + note_row.total > invoice_row.total THEN
    RAISE EXCEPTION 'This credit note exceeds the remaining creditable invoice amount.';
  END IF;

  FOR credit_line IN SELECT item.value FROM pg_catalog.jsonb_array_elements(note_row.lines) AS item(value) LOOP
    original_line_index := (credit_line ->> 'original_line_index')::integer;
    credit_quantity := (credit_line ->> 'quantity')::numeric;
    IF original_line_index IS NULL OR credit_quantity IS NULL OR original_line_index < 0 OR original_line_index >= pg_catalog.jsonb_array_length(invoice_row.lines) OR credit_quantity <= 0 THEN
      RAISE EXCEPTION 'Credit line reference or quantity is invalid.';
    END IF;
    original_quantity := ((invoice_row.lines -> original_line_index) ->> 'quantity')::numeric;
    SELECT COALESCE(SUM((line.value ->> 'quantity')::numeric), 0) INTO previously_credited_quantity
    FROM public.shipment_credit_notes AS existing
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(existing.lines) AS line(value)
    WHERE existing.invoice_id = invoice_row.id
      AND existing.status = 'issued'
      AND (line.value ->> 'original_line_index')::integer = original_line_index;
    IF previously_credited_quantity + credit_quantity > original_quantity + 0.000001 THEN
      RAISE EXCEPTION 'This credit note exceeds the uncredited quantity for invoice line %.', original_line_index + 1;
    END IF;
  END LOOP;

  start_year := EXTRACT(YEAR FROM note_row.credit_date)::integer
    - CASE WHEN EXTRACT(MONTH FROM note_row.credit_date)::integer < 4 THEN 1 ELSE 0 END;
  fy := RIGHT(start_year::text, 2) || '-' || RIGHT((start_year + 1)::text, 2);
  INSERT INTO public.shipment_credit_note_sequences(financial_year, last_number)
  VALUES (fy, 1)
  ON CONFLICT (financial_year)
  DO UPDATE SET last_number = public.shipment_credit_note_sequences.last_number + 1
  RETURNING last_number INTO next_number;
  IF next_number > 999999 THEN RAISE EXCEPTION 'Credit-note sequence limit reached for this financial year.'; END IF;

  UPDATE public.shipment_credit_notes
  SET credit_note_number = 'CN/' || fy || '/' || LPAD(next_number::text, 6, '0'),
      status = 'issued', issued_at = now(), updated_by = p_user_id, updated_at = now()
  WHERE id = p_credit_note_id
  RETURNING * INTO note_row;
  RETURN note_row;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_shipment_credit_note(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_shipment_credit_note(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_shipment_invoice_payment(
  p_invoice_id uuid, p_received_at date, p_amount numeric, p_currency text,
  p_exchange_rate_to_inr numeric, p_fx_date date, p_fx_source text,
  p_payment_method text, p_reference text, p_notes text, p_user_id uuid
)
RETURNS public.shipment_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invoice_row public.shipment_invoices;
  payment_row public.shipment_invoice_payments;
  credited numeric(20,2);
  received numeric(20,2);
  remaining numeric(20,2);
  period_value text;
  next_number integer;
BEGIN
  SELECT * INTO invoice_row
  FROM public.shipment_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND OR invoice_row.status <> 'issued' THEN
    RAISE EXCEPTION 'A receipt can only be recorded against an issued invoice.';
  END IF;
  IF p_received_at IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_exchange_rate_to_inr IS NULL OR p_exchange_rate_to_inr <= 0 THEN
    RAISE EXCEPTION 'Enter a valid receipt date, amount and exchange rate.';
  END IF;
  IF upper(p_currency) <> invoice_row.currency THEN
    RAISE EXCEPTION 'Receipt currency must match the invoice currency.';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO credited
  FROM public.shipment_credit_notes
  WHERE invoice_id = p_invoice_id AND status = 'issued';
  SELECT COALESCE(SUM(amount), 0) INTO received
  FROM public.shipment_invoice_payments
  WHERE invoice_id = p_invoice_id;
  remaining := invoice_row.total - credited - received;
  IF p_amount > remaining THEN
    RAISE EXCEPTION 'Receipt exceeds the open invoice balance of % %.', invoice_row.currency, GREATEST(remaining, 0);
  END IF;

  period_value := to_char(p_received_at, 'YYYYMM');
  INSERT INTO public.shipment_payment_sequences(period, last_number)
  VALUES (period_value, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_number = public.shipment_payment_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  INSERT INTO public.shipment_invoice_payments(
    receipt_number, invoice_id, received_at, amount, currency, exchange_rate_to_inr,
    amount_inr, fx_date, fx_source, payment_method, reference, notes, received_by
  ) VALUES (
    'RCT/' || period_value || '/' || LPAD(next_number::text, 6, '0'),
    p_invoice_id, p_received_at, p_amount, upper(p_currency), p_exchange_rate_to_inr,
    round(p_amount * p_exchange_rate_to_inr, 2), p_fx_date, COALESCE(p_fx_source, ''),
    COALESCE(p_payment_method, 'bank_transfer'), COALESCE(p_reference, ''),
    COALESCE(p_notes, ''), p_user_id
  )
  RETURNING * INTO payment_row;
  RETURN payment_row;
END;
$$;
REVOKE ALL ON FUNCTION public.record_shipment_invoice_payment(uuid, date, numeric, text, numeric, date, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shipment_invoice_payment(uuid, date, numeric, text, numeric, date, text, text, text, text, uuid) TO service_role;
