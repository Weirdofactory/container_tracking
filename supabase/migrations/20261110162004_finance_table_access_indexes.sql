CREATE INDEX IF NOT EXISTS customer_accounts_created_by_idx ON public.customer_accounts (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_accounts_updated_by_idx ON public.customer_accounts (updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipment_credit_notes_created_by_idx ON public.shipment_credit_notes (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipment_credit_notes_updated_by_idx ON public.shipment_credit_notes (updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipment_invoice_payments_received_by_idx ON public.shipment_invoice_payments (received_by) WHERE received_by IS NOT NULL;

DROP POLICY IF EXISTS customer_accounts_staff_only ON public.customer_accounts;
CREATE POLICY customer_accounts_staff_only ON public.customer_accounts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS shipment_credit_notes_staff_only ON public.shipment_credit_notes;
CREATE POLICY shipment_credit_notes_staff_only ON public.shipment_credit_notes
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS shipment_invoice_payments_staff_only ON public.shipment_invoice_payments;
CREATE POLICY shipment_invoice_payments_staff_only ON public.shipment_invoice_payments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS shipment_credit_note_sequences_staff_only ON public.shipment_credit_note_sequences;
CREATE POLICY shipment_credit_note_sequences_staff_only ON public.shipment_credit_note_sequences
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS shipment_payment_sequences_staff_only ON public.shipment_payment_sequences;
CREATE POLICY shipment_payment_sequences_staff_only ON public.shipment_payment_sequences
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);