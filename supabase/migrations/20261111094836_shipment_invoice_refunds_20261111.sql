CREATE TABLE IF NOT EXISTS public.shipment_invoice_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.shipment_invoices(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.shipment_invoice_payments(id) ON DELETE RESTRICT,
  refunded_at date NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(20,8) NOT NULL CHECK (exchange_rate_to_inr > 0),
  amount_inr numeric(20,2) NOT NULL CHECK (amount_inr > 0),
  fx_date date NOT NULL,
  fx_source text NOT NULL DEFAULT '',
  refund_method text NOT NULL CHECK (refund_method IN ('bank_transfer','upi','cash','card','cheque','other')),
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  refunded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipment_invoice_refunds_invoice_date_idx
  ON public.shipment_invoice_refunds(invoice_id, refunded_at DESC);
CREATE INDEX IF NOT EXISTS shipment_invoice_refunds_payment_idx
  ON public.shipment_invoice_refunds(payment_id, refunded_at DESC);

CREATE TABLE IF NOT EXISTS public.shipment_invoice_refund_sequences (
  period text PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);

ALTER TABLE public.shipment_invoice_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoice_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoice_refunds TO service_role;
ALTER TABLE public.shipment_invoice_refund_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_invoice_refund_sequences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shipment_invoice_refund_sequences TO service_role;

CREATE OR REPLACE FUNCTION public.record_shipment_invoice_refund(
  p_payment_id uuid,
  p_refunded_at date,
  p_amount numeric,
  p_exchange_rate_to_inr numeric,
  p_fx_date date,
  p_fx_source text,
  p_refund_method text,
  p_reference text,
  p_notes text,
  p_user_id uuid
)
RETURNS public.shipment_invoice_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  payment_row public.shipment_invoice_payments;
  invoice_row public.shipment_invoices;
  refund_row public.shipment_invoice_refunds;
  already_refunded numeric(20,2);
  remaining_refundable numeric(20,2);
  period_value text;
  next_number integer;
BEGIN
  SELECT * INTO payment_row
  FROM public.shipment_invoice_payments
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found.'; END IF;

  SELECT * INTO invoice_row
  FROM public.shipment_invoices
  WHERE id = payment_row.invoice_id
  FOR UPDATE;
  IF NOT FOUND OR invoice_row.status <> 'issued' THEN
    RAISE EXCEPTION 'A refund can only be recorded against an issued invoice.';
  END IF;

  SELECT * INTO payment_row
  FROM public.shipment_invoice_payments
  WHERE id = p_payment_id AND invoice_id = invoice_row.id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found for the linked invoice.'; END IF;

  IF p_refunded_at IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_exchange_rate_to_inr IS NULL OR p_exchange_rate_to_inr <= 0 THEN
    RAISE EXCEPTION 'Enter a valid refund date, amount and exchange rate.';
  END IF;
  IF p_refund_method NOT IN ('bank_transfer','upi','cash','card','cheque','other') THEN
    RAISE EXCEPTION 'Choose a valid refund method.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO already_refunded
  FROM public.shipment_invoice_refunds
  WHERE payment_id = p_payment_id;
  remaining_refundable := payment_row.amount - already_refunded;
  IF p_amount > remaining_refundable + 0.005 THEN
    RAISE EXCEPTION 'Refund exceeds the unrefunded receipt balance of % %.',
      payment_row.currency, GREATEST(remaining_refundable, 0);
  END IF;

  period_value := to_char(p_refunded_at, 'YYYYMM');
  INSERT INTO public.shipment_invoice_refund_sequences(period, last_number)
  VALUES (period_value, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_number = public.shipment_invoice_refund_sequences.last_number + 1
  RETURNING last_number INTO next_number;

  INSERT INTO public.shipment_invoice_refunds(
    refund_number, invoice_id, payment_id, refunded_at, amount, currency,
    exchange_rate_to_inr, amount_inr, fx_date, fx_source, refund_method,
    reference, notes, refunded_by
  ) VALUES (
    'RFN/' || period_value || '/' || LPAD(next_number::text, 6, '0'),
    invoice_row.id, p_payment_id, p_refunded_at, p_amount, payment_row.currency,
    p_exchange_rate_to_inr, round(p_amount * p_exchange_rate_to_inr, 2),
    COALESCE(p_fx_date, p_refunded_at), COALESCE(p_fx_source, ''),
    p_refund_method, COALESCE(p_reference, ''), COALESCE(p_notes, ''), p_user_id
  )
  RETURNING * INTO refund_row;
  RETURN refund_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_shipment_invoice_refund(uuid,date,numeric,numeric,date,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shipment_invoice_refund(uuid,date,numeric,numeric,date,text,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_shipment_invoice_payment(
  p_invoice_id uuid,
  p_received_at date,
  p_amount numeric,
  p_currency text,
  p_exchange_rate_to_inr numeric,
  p_fx_date date,
  p_fx_source text,
  p_payment_method text,
  p_reference text,
  p_notes text,
  p_user_id uuid
)
RETURNS public.shipment_invoice_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  invoice_row public.shipment_invoices;
  payment_row public.shipment_invoice_payments;
  credited numeric(20,2);
  received numeric(20,2);
  refunded numeric(20,2);
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
  SELECT COALESCE(SUM(amount), 0) INTO refunded
  FROM public.shipment_invoice_refunds
  WHERE invoice_id = p_invoice_id;
  remaining := invoice_row.total - credited - received + refunded;
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
$function$;

REVOKE ALL ON FUNCTION public.record_shipment_invoice_payment(uuid,date,numeric,text,numeric,date,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_shipment_invoice_payment(uuid,date,numeric,text,numeric,date,text,text,text,text,uuid) TO service_role;