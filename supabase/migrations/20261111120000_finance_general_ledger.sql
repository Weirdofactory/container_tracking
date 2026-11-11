CREATE SEQUENCE IF NOT EXISTS public.finance_journal_number_seq AS bigint START 1;

CREATE TABLE IF NOT EXISTS public.finance_ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE CHECK (account_code ~ '^[0-9]{4,8}$'),
  account_name text NOT NULL CHECK (length(btrim(account_name)) BETWEEN 2 AND 120),
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_ledger_accounts_normal_balance_check CHECK (
    (account_type IN ('asset','expense') AND normal_balance='debit')
    OR (account_type IN ('liability','equity','income') AND normal_balance='credit')
  )
);

CREATE TABLE IF NOT EXISTS public.finance_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL UNIQUE,
  entry_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('invoice','credit_note','receipt','refund','vendor_bill','vendor_payment','manual')),
  source_id uuid,
  reference text NOT NULL DEFAULT '',
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 500),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_inr numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_inr > 0),
  total_debit_inr numeric(20,2) NOT NULL CHECK (total_debit_inr > 0),
  total_credit_inr numeric(20,2) NOT NULL CHECK (total_credit_inr > 0),
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_journal_entries_balanced_check CHECK (total_debit_inr = total_credit_inr),
  CONSTRAINT finance_journal_entries_source_shape_check CHECK (
    (source_type='manual' AND source_id IS NULL)
    OR (source_type<>'manual' AND source_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_journal_entries_source_unique
  ON public.finance_journal_entries(source_type, source_id)
  WHERE source_type <> 'manual';

CREATE INDEX IF NOT EXISTS finance_journal_entries_date_idx
  ON public.finance_journal_entries(entry_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.finance_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  account_id uuid NOT NULL REFERENCES public.finance_ledger_accounts(id) ON DELETE RESTRICT,
  account_code_snapshot text NOT NULL,
  account_name_snapshot text NOT NULL,
  description text NOT NULL DEFAULT '',
  debit_inr numeric(20,2) NOT NULL DEFAULT 0 CHECK (debit_inr >= 0),
  credit_inr numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit_inr >= 0),
  job_id uuid REFERENCES public.forwarding_jobs(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customer_accounts(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendor_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entry_id, line_no),
  CONSTRAINT finance_journal_lines_one_side_check CHECK (
    (debit_inr > 0 AND credit_inr = 0)
    OR (credit_inr > 0 AND debit_inr = 0)
  )
);

CREATE INDEX IF NOT EXISTS finance_journal_lines_entry_idx
  ON public.finance_journal_lines(entry_id, line_no);
CREATE INDEX IF NOT EXISTS finance_journal_lines_account_idx
  ON public.finance_journal_lines(account_id, entry_id);

ALTER TABLE public.finance_ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_ledger_accounts_service_role_all ON public.finance_ledger_accounts;
CREATE POLICY finance_ledger_accounts_service_role_all ON public.finance_ledger_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS finance_journal_entries_service_role_all ON public.finance_journal_entries;
CREATE POLICY finance_journal_entries_service_role_all ON public.finance_journal_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS finance_journal_lines_service_role_all ON public.finance_journal_lines;
CREATE POLICY finance_journal_lines_service_role_all ON public.finance_journal_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.finance_ledger_accounts, public.finance_journal_entries, public.finance_journal_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.finance_ledger_accounts, public.finance_journal_entries, public.finance_journal_lines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.finance_journal_number_seq TO service_role;

INSERT INTO public.finance_ledger_accounts(account_code, account_name, account_type, normal_balance, is_system)
VALUES
  ('1000','Cash on hand','asset','debit',true),
  ('1010','Bank clearing','asset','debit',true),
  ('1100','Accounts receivable','asset','debit',true),
  ('1200','Input GST · CGST','asset','debit',true),
  ('1210','Input GST · SGST','asset','debit',true),
  ('1220','Input GST · IGST','asset','debit',true),
  ('2000','Accounts payable','liability','credit',true),
  ('2100','Output GST · CGST','liability','credit',true),
  ('2110','Output GST · SGST','liability','credit',true),
  ('2120','Output GST · IGST','liability','credit',true),
  ('3000','Opening balance equity','equity','credit',true),
  ('4000','Freight revenue','income','credit',true),
  ('4100','Foreign exchange gain','income','credit',true),
  ('5000','Direct forwarding costs','expense','debit',true),
  ('6000','Foreign exchange loss','expense','debit',true)
ON CONFLICT (account_code) DO UPDATE
SET account_name=EXCLUDED.account_name,
    account_type=EXCLUDED.account_type,
    normal_balance=EXCLUDED.normal_balance,
    is_system=true;

CREATE OR REPLACE FUNCTION public.finance_post_journal(
  p_source_type text,
  p_source_id uuid,
  p_entry_date date,
  p_reference text,
  p_description text,
  p_currency text,
  p_exchange_rate_to_inr numeric,
  p_created_by uuid,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_line jsonb;
  v_account_id uuid;
  v_account_code text;
  v_account_name text;
  v_description text;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
  v_line_no integer := 0;
  v_total_debit numeric(20,2) := 0;
  v_total_credit numeric(20,2) := 0;
BEGIN
  IF coalesce(p_source_type,'') NOT IN ('invoice','credit_note','receipt','refund','vendor_bill','vendor_payment','manual') THEN
    RAISE EXCEPTION 'Unsupported journal source.';
  END IF;
  IF p_entry_date IS NULL OR length(btrim(coalesce(p_description,''))) < 2 THEN
    RAISE EXCEPTION 'Enter an entry date and description.';
  END IF;
  IF coalesce(p_currency,'') !~ '^[A-Z]{3}$' OR coalesce(p_exchange_rate_to_inr,0) <= 0 THEN
    RAISE EXCEPTION 'A valid currency and exchange rate are required.';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Journal lines must be an array.';
  END IF;
  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry needs at least two lines.';
  END IF;
  IF (p_source_type='manual' AND p_source_id IS NOT NULL) OR (p_source_type<>'manual' AND p_source_id IS NULL) THEN
    RAISE EXCEPTION 'The journal source reference is invalid.';
  END IF;

  IF p_source_type <> 'manual' THEN
    SELECT id INTO v_entry_id
    FROM public.finance_journal_entries
    WHERE source_type=p_source_type AND source_id=p_source_id;
    IF FOUND THEN RETURN v_entry_id; END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_code := upper(btrim(coalesce(v_line->>'account_code','')));
    SELECT id INTO v_account_id
    FROM public.finance_ledger_accounts
    WHERE account_code=v_account_code AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active ledger account for every journal line.'; END IF;
    BEGIN
      v_debit := round(coalesce(nullif(v_line->>'debit_inr','')::numeric,0),2);
      v_credit := round(coalesce(nullif(v_line->>'credit_inr','')::numeric,0),2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Journal amounts must be valid numbers.';
    END;
    IF v_debit < 0 OR v_credit < 0 OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'Each journal line must contain one non-negative debit or credit amount.';
    END IF;
    IF v_debit=0 AND v_credit=0 THEN CONTINUE; END IF;
    v_line_no := v_line_no + 1;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_line_no < 2 OR v_total_debit <= 0 THEN RAISE EXCEPTION 'A journal entry must include at least two non-zero lines.'; END IF;
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry is out of balance: debits INR %, credits INR %.',v_total_debit,v_total_credit;
  END IF;

  v_entry_number := 'GL-' || to_char(p_entry_date,'YYYY') || '-' ||
    lpad(nextval('public.finance_journal_number_seq')::text,7,'0');

  IF p_source_type='manual' THEN
    INSERT INTO public.finance_journal_entries(
      entry_number,entry_date,source_type,source_id,reference,description,currency,
      exchange_rate_to_inr,total_debit_inr,total_credit_inr,posted_by
    ) VALUES (
      v_entry_number,p_entry_date,p_source_type,p_source_id,
      left(coalesce(p_reference,''),120),left(btrim(p_description),500),
      upper(p_currency),p_exchange_rate_to_inr,v_total_debit,v_total_credit,p_created_by
    )
    RETURNING id INTO v_entry_id;
  ELSE
    INSERT INTO public.finance_journal_entries(
      entry_number,entry_date,source_type,source_id,reference,description,currency,
      exchange_rate_to_inr,total_debit_inr,total_credit_inr,posted_by
    ) VALUES (
      v_entry_number,p_entry_date,p_source_type,p_source_id,
      left(coalesce(p_reference,''),120),left(btrim(p_description),500),
      upper(p_currency),p_exchange_rate_to_inr,v_total_debit,v_total_credit,p_created_by
    )
    ON CONFLICT (source_type,source_id) WHERE source_type <> 'manual' DO NOTHING
    RETURNING id INTO v_entry_id;
    IF v_entry_id IS NULL THEN
      SELECT id INTO v_entry_id FROM public.finance_journal_entries
      WHERE source_type=p_source_type AND source_id=p_source_id;
      RETURN v_entry_id;
    END IF;
  END IF;

  v_line_no := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_account_code := upper(btrim(coalesce(v_line->>'account_code','')));
    SELECT id,account_name INTO v_account_id,v_account_name
    FROM public.finance_ledger_accounts
    WHERE account_code=v_account_code AND is_active=true;
    v_debit := round(coalesce(nullif(v_line->>'debit_inr','')::numeric,0),2);
    v_credit := round(coalesce(nullif(v_line->>'credit_inr','')::numeric,0),2);
    IF v_debit=0 AND v_credit=0 THEN CONTINUE; END IF;
    v_line_no := v_line_no + 1;
    v_description := left(coalesce(v_line->>'description',''),240);
    INSERT INTO public.finance_journal_lines(
      entry_id,line_no,account_id,account_code_snapshot,account_name_snapshot,
      description,debit_inr,credit_inr,job_id,customer_id,vendor_id
    ) VALUES (
      v_entry_id,v_line_no,v_account_id,v_account_code,v_account_name,
      v_description,v_debit,v_credit,
      nullif(v_line->>'job_id','')::uuid,
      nullif(v_line->>'customer_id','')::uuid,
      nullif(v_line->>'vendor_id','')::uuid
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Posted journal records are immutable. Correct them with a reversing journal entry.';
END;
$$;

CREATE TRIGGER finance_journal_entries_immutable
BEFORE UPDATE OR DELETE ON public.finance_journal_entries
FOR EACH ROW EXECUTE FUNCTION public.finance_reject_ledger_mutation();

CREATE TRIGGER finance_journal_lines_immutable
BEFORE UPDATE OR DELETE ON public.finance_journal_lines
FOR EACH ROW EXECUTE FUNCTION public.finance_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION public.finance_post_invoice_ledger(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc public.shipment_invoices%rowtype;
  v_rate numeric(20,8);
  v_total numeric(20,2);
  v_cgst numeric(20,2);
  v_sgst numeric(20,2);
  v_igst numeric(20,2);
  v_tax numeric(20,2);
  v_income numeric(20,2);
  v_lines jsonb;
BEGIN
  SELECT * INTO v_doc FROM public.shipment_invoices WHERE id=p_invoice_id;
  IF NOT FOUND OR v_doc.status<>'issued' THEN RETURN NULL; END IF;
  v_rate := coalesce(v_doc.exchange_rate_to_inr,1);
  v_total := round(v_doc.total_inr,2);
  v_cgst := round(coalesce(v_doc.cgst_total,0)*v_rate,2);
  v_sgst := round(coalesce(v_doc.sgst_total,0)*v_rate,2);
  v_igst := round(coalesce(v_doc.igst_total,0)*v_rate,2);
  v_tax := v_cgst+v_sgst+v_igst;
  v_income := greatest(v_total-v_tax,0);
  IF v_total<=0 THEN RAISE EXCEPTION 'Issued invoice % has no positive INR total.',v_doc.invoice_number; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1100','debit_inr',v_total,'description','Customer receivable','job_id',v_doc.job_id,'customer_id',v_doc.customer_id),
    jsonb_build_object('account_code','4000','credit_inr',v_income,'description','Freight invoice revenue','job_id',v_doc.job_id,'customer_id',v_doc.customer_id),
    jsonb_build_object('account_code','2100','credit_inr',v_cgst,'description','Output CGST','job_id',v_doc.job_id,'customer_id',v_doc.customer_id),
    jsonb_build_object('account_code','2110','credit_inr',v_sgst,'description','Output SGST','job_id',v_doc.job_id,'customer_id',v_doc.customer_id),
    jsonb_build_object('account_code','2120','credit_inr',v_igst,'description','Output IGST','job_id',v_doc.job_id,'customer_id',v_doc.customer_id),
    jsonb_build_object('account_code','6000','debit_inr',greatest(v_tax-v_total,0),'description','GST rounding adjustment','job_id',v_doc.job_id,'customer_id',v_doc.customer_id)
  );
  RETURN public.finance_post_journal('invoice',v_doc.id,v_doc.invoice_date,v_doc.invoice_number,
    'Customer invoice '||coalesce(v_doc.invoice_number,v_doc.id::text),v_doc.currency,v_rate,v_doc.created_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_post_credit_note_ledger(p_credit_note_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc public.shipment_credit_notes%rowtype;
  v_invoice public.shipment_invoices%rowtype;
  v_rate numeric(20,8);
  v_total numeric(20,2);
  v_cgst numeric(20,2);
  v_sgst numeric(20,2);
  v_igst numeric(20,2);
  v_tax numeric(20,2);
  v_income numeric(20,2);
  v_lines jsonb;
BEGIN
  SELECT * INTO v_doc FROM public.shipment_credit_notes WHERE id=p_credit_note_id;
  IF NOT FOUND OR v_doc.status<>'issued' THEN RETURN NULL; END IF;
  SELECT * INTO v_invoice FROM public.shipment_invoices WHERE id=v_doc.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit note % has no invoice.',v_doc.credit_note_number; END IF;
  v_rate := coalesce(v_doc.exchange_rate_to_inr,1);
  v_total := round(v_doc.total_inr,2);
  v_cgst := round(coalesce(v_doc.cgst_total,0)*v_rate,2);
  v_sgst := round(coalesce(v_doc.sgst_total,0)*v_rate,2);
  v_igst := round(coalesce(v_doc.igst_total,0)*v_rate,2);
  v_tax := v_cgst+v_sgst+v_igst;
  v_income := greatest(v_total-v_tax,0);
  IF v_total<=0 THEN RAISE EXCEPTION 'Issued credit note % has no positive INR total.',v_doc.credit_note_number; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','4000','debit_inr',v_income,'description','Credit note revenue reversal','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','2100','debit_inr',v_cgst,'description','Reverse output CGST','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','2110','debit_inr',v_sgst,'description','Reverse output SGST','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','2120','debit_inr',v_igst,'description','Reverse output IGST','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','1100','credit_inr',v_total,'description','Customer credit note','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','4100','credit_inr',greatest(v_tax-v_total,0),'description','GST rounding adjustment','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id)
  );
  RETURN public.finance_post_journal('credit_note',v_doc.id,v_doc.credit_date,v_doc.credit_note_number,
    'Credit note '||coalesce(v_doc.credit_note_number,v_doc.id::text)||' against '||coalesce(v_doc.invoice_number_snapshot,v_invoice.invoice_number),v_doc.currency,v_rate,v_doc.created_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_post_receipt_ledger(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.shipment_invoice_payments%rowtype;
  v_invoice public.shipment_invoices%rowtype;
  v_received numeric(20,2);
  v_carry numeric(20,2);
  v_asset text;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_payment FROM public.shipment_invoice_payments WHERE id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_invoice FROM public.shipment_invoices WHERE id=v_payment.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt % has no invoice.',v_payment.receipt_number; END IF;
  v_received := round(v_payment.amount_inr,2);
  v_carry := round(v_payment.amount*coalesce(v_invoice.exchange_rate_to_inr,1),2);
  v_asset := CASE WHEN v_payment.payment_method='cash' THEN '1000' ELSE '1010' END;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code',v_asset,'debit_inr',v_received,'description','Customer receipt','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','1100','credit_inr',v_carry,'description','Clear customer receivable','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','4100','credit_inr',greatest(v_received-v_carry,0),'description','Realized FX gain','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','6000','debit_inr',greatest(v_carry-v_received,0),'description','Realized FX loss','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id)
  );
  RETURN public.finance_post_journal('receipt',v_payment.id,v_payment.received_at,v_payment.receipt_number,
    'Customer receipt '||v_payment.receipt_number,v_payment.currency,v_payment.exchange_rate_to_inr,v_payment.received_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_post_refund_ledger(p_refund_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.shipment_invoice_refunds%rowtype;
  v_invoice public.shipment_invoices%rowtype;
  v_received numeric(20,2);
  v_carry numeric(20,2);
  v_asset text;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_refund FROM public.shipment_invoice_refunds WHERE id=p_refund_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_invoice FROM public.shipment_invoices WHERE id=v_refund.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund % has no invoice.',v_refund.refund_number; END IF;
  v_received := round(v_refund.amount_inr,2);
  v_carry := round(v_refund.amount*coalesce(v_invoice.exchange_rate_to_inr,1),2);
  v_asset := CASE WHEN v_refund.refund_method='cash' THEN '1000' ELSE '1010' END;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1100','debit_inr',v_carry,'description','Reopen receivable for customer refund','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code',v_asset,'credit_inr',v_received,'description','Customer refund paid','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','6000','debit_inr',greatest(v_received-v_carry,0),'description','Refund FX loss','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id),
    jsonb_build_object('account_code','4100','credit_inr',greatest(v_carry-v_received,0),'description','Refund FX gain','job_id',v_invoice.job_id,'customer_id',v_invoice.customer_id)
  );
  RETURN public.finance_post_journal('refund',v_refund.id,v_refund.refunded_at,v_refund.refund_number,
    'Customer refund '||v_refund.refund_number,v_refund.currency,v_refund.exchange_rate_to_inr,v_refund.refunded_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_post_vendor_bill_ledger(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill public.vendor_bills%rowtype;
  v_tax_cgst numeric(20,2);
  v_tax_sgst numeric(20,2);
  v_tax_igst numeric(20,2);
  v_tax numeric(20,2);
  v_total numeric(20,2);
  v_cost numeric(20,2);
  v_lines jsonb;
BEGIN
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id=p_bill_id;
  IF NOT FOUND OR v_bill.status<>'posted' THEN RETURN NULL; END IF;
  v_tax_cgst := round(coalesce(v_bill.cgst_total,0)*coalesce(v_bill.exchange_rate_to_inr,1),2);
  v_tax_sgst := round(coalesce(v_bill.sgst_total,0)*coalesce(v_bill.exchange_rate_to_inr,1),2);
  v_tax_igst := round(coalesce(v_bill.igst_total,0)*coalesce(v_bill.exchange_rate_to_inr,1),2);
  v_tax := v_tax_cgst+v_tax_sgst+v_tax_igst;
  v_total := round(v_bill.total_inr,2);
  v_cost := greatest(v_total-v_tax,0);
  IF v_total<=0 THEN RAISE EXCEPTION 'Posted supplier bill % has no positive INR total.',v_bill.ap_number; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','5000','debit_inr',v_cost,'description','Direct forwarding costs','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','1200','debit_inr',v_tax_cgst,'description','Input CGST','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','1210','debit_inr',v_tax_sgst,'description','Input SGST','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','1220','debit_inr',v_tax_igst,'description','Input IGST','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','2000','credit_inr',v_total,'description','Supplier accounts payable','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','4100','credit_inr',greatest(v_tax-v_total,0),'description','GST rounding adjustment','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id)
  );
  RETURN public.finance_post_journal('vendor_bill',v_bill.id,v_bill.bill_date,v_bill.ap_number,
    'Supplier bill '||coalesce(v_bill.ap_number,v_bill.supplier_invoice_no),v_bill.currency,v_bill.exchange_rate_to_inr,v_bill.created_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_post_vendor_payment_ledger(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.vendor_bill_payments%rowtype;
  v_bill public.vendor_bills%rowtype;
  v_paid numeric(20,2);
  v_carry numeric(20,2);
  v_asset text;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_payment FROM public.vendor_bill_payments WHERE id=p_payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id=v_payment.bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier payment % has no bill.',v_payment.payment_no; END IF;
  v_paid := round(v_payment.amount_inr,2);
  v_carry := round(v_payment.amount*coalesce(v_bill.exchange_rate_to_inr,1),2);
  v_asset := CASE WHEN v_payment.payment_method='cash' THEN '1000' ELSE '1010' END;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','2000','debit_inr',v_carry,'description','Clear supplier payable','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code',v_asset,'credit_inr',v_paid,'description','Supplier payment','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','6000','debit_inr',greatest(v_paid-v_carry,0),'description','Realized FX loss','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id),
    jsonb_build_object('account_code','4100','credit_inr',greatest(v_carry-v_paid,0),'description','Realized FX gain','job_id',v_bill.job_id,'vendor_id',v_bill.vendor_id)
  );
  RETURN public.finance_post_journal('vendor_payment',v_payment.id,v_payment.paid_at,v_payment.payment_no,
    'Supplier payment '||v_payment.payment_no,v_payment.currency,v_payment.exchange_rate_to_inr,v_payment.created_by,v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_invoice_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status='issued' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.finance_post_invoice_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_credit_note_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status='issued' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.finance_post_credit_note_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_receipt_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.finance_post_receipt_ledger(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_refund_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.finance_post_refund_ledger(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_vendor_bill_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status='posted' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.finance_post_vendor_bill_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_vendor_payment_ledger_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.finance_post_vendor_payment_ledger(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_invoice_ledger_posted
AFTER INSERT OR UPDATE ON public.shipment_invoices
FOR EACH ROW EXECUTE FUNCTION public.finance_invoice_ledger_trigger();

CREATE TRIGGER finance_credit_note_ledger_posted
AFTER INSERT OR UPDATE ON public.shipment_credit_notes
FOR EACH ROW EXECUTE FUNCTION public.finance_credit_note_ledger_trigger();

CREATE TRIGGER finance_receipt_ledger_posted
AFTER INSERT ON public.shipment_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.finance_receipt_ledger_trigger();

CREATE TRIGGER finance_refund_ledger_posted
AFTER INSERT ON public.shipment_invoice_refunds
FOR EACH ROW EXECUTE FUNCTION public.finance_refund_ledger_trigger();

CREATE TRIGGER finance_vendor_bill_ledger_posted
AFTER INSERT OR UPDATE ON public.vendor_bills
FOR EACH ROW EXECUTE FUNCTION public.finance_vendor_bill_ledger_trigger();

CREATE TRIGGER finance_vendor_payment_ledger_posted
AFTER INSERT ON public.vendor_bill_payments
FOR EACH ROW EXECUTE FUNCTION public.finance_vendor_payment_ledger_trigger();

CREATE OR REPLACE FUNCTION public.record_finance_manual_journal(
  p_entry_date date,
  p_reference text,
  p_description text,
  p_lines jsonb,
  p_actor uuid
)
RETURNS public.finance_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry_id uuid;
  v_entry public.finance_journal_entries%rowtype;
BEGIN
  v_entry_id := public.finance_post_journal(
    'manual',NULL,p_entry_date,p_reference,p_description,'INR',1,p_actor,p_lines
  );
  SELECT * INTO v_entry FROM public.finance_journal_entries WHERE id=v_entry_id;
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_general_ledger_summary(
  p_from_date date,
  p_as_of_date date
)
RETURNS TABLE (
  account_code text,
  account_name text,
  account_type text,
  period_debits numeric,
  period_credits numeric,
  closing_debit numeric,
  closing_credit numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    a.account_code,
    a.account_name,
    a.account_type,
    coalesce(sum(l.debit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
        AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    ),0)::numeric AS period_debits,
    coalesce(sum(l.credit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
        AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    ),0)::numeric AS period_credits,
    greatest(coalesce(sum(l.debit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
    ),0)-coalesce(sum(l.credit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
    ),0),0)::numeric AS closing_debit,
    greatest(coalesce(sum(l.credit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
    ),0)-coalesce(sum(l.debit_inr) FILTER (
      WHERE j.entry_date <= coalesce(p_as_of_date, current_date)
    ),0),0)::numeric AS closing_credit
  FROM public.finance_ledger_accounts a
  LEFT JOIN public.finance_journal_lines l ON l.account_id=a.id
  LEFT JOIN public.finance_journal_entries j ON j.id=l.entry_id
    AND j.entry_date <= coalesce(p_as_of_date, current_date)
  GROUP BY a.account_code,a.account_name,a.account_type
  ORDER BY a.account_code
$$;

REVOKE ALL ON FUNCTION public.finance_post_journal(text,uuid,date,text,text,text,numeric,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_invoice_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_credit_note_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_receipt_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_refund_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_vendor_bill_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_post_vendor_payment_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_invoice_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_credit_note_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_receipt_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_refund_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_vendor_bill_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_vendor_payment_ledger_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_reject_ledger_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_finance_manual_journal(date,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_general_ledger_summary(date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_post_journal(text,uuid,date,text,text,text,numeric,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_finance_manual_journal(date,text,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_general_ledger_summary(date,date) TO service_role;

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.shipment_invoices WHERE status='issued' ORDER BY invoice_date,created_at LOOP
    PERFORM public.finance_post_invoice_ledger(v_row.id);
  END LOOP;
  FOR v_row IN SELECT id FROM public.shipment_credit_notes WHERE status='issued' ORDER BY credit_date,created_at LOOP
    PERFORM public.finance_post_credit_note_ledger(v_row.id);
  END LOOP;
  FOR v_row IN SELECT id FROM public.shipment_invoice_payments ORDER BY received_at,created_at LOOP
    PERFORM public.finance_post_receipt_ledger(v_row.id);
  END LOOP;
  FOR v_row IN SELECT id FROM public.shipment_invoice_refunds ORDER BY refunded_at,created_at LOOP
    PERFORM public.finance_post_refund_ledger(v_row.id);
  END LOOP;
  FOR v_row IN SELECT id FROM public.vendor_bills WHERE status='posted' ORDER BY bill_date,created_at LOOP
    PERFORM public.finance_post_vendor_bill_ledger(v_row.id);
  END LOOP;
  FOR v_row IN SELECT id FROM public.vendor_bill_payments ORDER BY paid_at,created_at LOOP
    PERFORM public.finance_post_vendor_payment_ledger(v_row.id);
  END LOOP;
END;
$$;