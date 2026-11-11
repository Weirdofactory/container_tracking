ALTER TABLE public.finance_bank_transactions
  ADD COLUMN matched_refund_id uuid REFERENCES public.shipment_invoice_refunds(id) ON DELETE RESTRICT;

ALTER TABLE public.finance_bank_transactions
  DROP CONSTRAINT finance_bank_transactions_match_shape;

ALTER TABLE public.finance_bank_transactions
  ADD CONSTRAINT finance_bank_transactions_match_shape CHECK (
    (
      status = 'matched'
      AND num_nonnulls(matched_receipt_id, matched_vendor_payment_id, matched_refund_id) = 1
      AND matched_at IS NOT NULL
    )
    OR
    (
      status IN ('unmatched', 'ignored')
      AND matched_receipt_id IS NULL
      AND matched_vendor_payment_id IS NULL
      AND matched_refund_id IS NULL
      AND matched_at IS NULL
      AND matched_by IS NULL
    )
  );

CREATE UNIQUE INDEX finance_bank_transactions_refund_match_unique
  ON public.finance_bank_transactions(matched_refund_id)
  WHERE matched_refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_finance_bank_transaction(
  p_transaction_id uuid,
  p_match_type text,
  p_payment_id uuid,
  p_user_id uuid
)
RETURNS public.finance_bank_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tx public.finance_bank_transactions%ROWTYPE;
  receipt public.shipment_invoice_payments%ROWTYPE;
  vendor_payment public.vendor_bill_payments%ROWTYPE;
  refund public.shipment_invoice_refunds%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.finance_bank_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank statement transaction not found.'; END IF;

  IF p_match_type = 'ignore' THEN
    IF tx.status = 'matched' THEN RAISE EXCEPTION 'Unmatch the linked payment before ignoring this bank line.'; END IF;
    UPDATE public.finance_bank_transactions
      SET status='ignored',matched_receipt_id=NULL,matched_vendor_payment_id=NULL,matched_refund_id=NULL,matched_at=NULL,matched_by=NULL
      WHERE id=tx.id RETURNING * INTO tx;
    RETURN tx;
  ELSIF p_match_type = 'unmatch' THEN
    IF tx.status <> 'matched' THEN RAISE EXCEPTION 'This bank line is not currently matched.'; END IF;
    UPDATE public.finance_bank_transactions
      SET status='unmatched',matched_receipt_id=NULL,matched_vendor_payment_id=NULL,matched_refund_id=NULL,matched_at=NULL,matched_by=NULL
      WHERE id=tx.id RETURNING * INTO tx;
    RETURN tx;
  ELSIF p_match_type = 'receipt' THEN
    IF tx.status <> 'unmatched' THEN RAISE EXCEPTION 'Only unmatched bank lines can be reconciled.'; END IF;
    IF tx.direction <> 'credit' THEN RAISE EXCEPTION 'A customer receipt must match a bank credit.'; END IF;
    IF p_payment_id IS NULL THEN RAISE EXCEPTION 'Select a customer receipt.'; END IF;
    SELECT * INTO receipt FROM public.shipment_invoice_payments WHERE id=p_payment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer receipt not found.'; END IF;
    IF receipt.currency <> tx.currency OR abs(receipt.amount-tx.amount)>0.0001 THEN RAISE EXCEPTION 'Receipt currency and amount must exactly match the bank transaction.'; END IF;
    UPDATE public.finance_bank_transactions
      SET status='matched',matched_receipt_id=receipt.id,matched_vendor_payment_id=NULL,matched_refund_id=NULL,matched_at=now(),matched_by=p_user_id
      WHERE id=tx.id RETURNING * INTO tx;
    RETURN tx;
  ELSIF p_match_type = 'vendor_payment' THEN
    IF tx.status <> 'unmatched' THEN RAISE EXCEPTION 'Only unmatched bank lines can be reconciled.'; END IF;
    IF tx.direction <> 'debit' THEN RAISE EXCEPTION 'A supplier payment must match a bank debit.'; END IF;
    IF p_payment_id IS NULL THEN RAISE EXCEPTION 'Select a supplier payment.'; END IF;
    SELECT * INTO vendor_payment FROM public.vendor_bill_payments WHERE id=p_payment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier payment not found.'; END IF;
    IF vendor_payment.currency <> tx.currency OR abs(vendor_payment.amount-tx.amount)>0.0001 THEN RAISE EXCEPTION 'Supplier-payment currency and amount must exactly match the bank transaction.'; END IF;
    UPDATE public.finance_bank_transactions
      SET status='matched',matched_receipt_id=NULL,matched_vendor_payment_id=vendor_payment.id,matched_refund_id=NULL,matched_at=now(),matched_by=p_user_id
      WHERE id=tx.id RETURNING * INTO tx;
    RETURN tx;
  ELSIF p_match_type = 'invoice_refund' THEN
    IF tx.status <> 'unmatched' THEN RAISE EXCEPTION 'Only unmatched bank lines can be reconciled.'; END IF;
    IF tx.direction <> 'debit' THEN RAISE EXCEPTION 'A customer refund must match a bank debit.'; END IF;
    IF p_payment_id IS NULL THEN RAISE EXCEPTION 'Select a customer refund.'; END IF;
    SELECT * INTO refund FROM public.shipment_invoice_refunds WHERE id=p_payment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer refund not found.'; END IF;
    IF refund.currency <> tx.currency OR abs(refund.amount-tx.amount)>0.0001 THEN RAISE EXCEPTION 'Refund currency and amount must exactly match the bank transaction.'; END IF;
    UPDATE public.finance_bank_transactions
      SET status='matched',matched_receipt_id=NULL,matched_vendor_payment_id=NULL,matched_refund_id=refund.id,matched_at=now(),matched_by=p_user_id
      WHERE id=tx.id RETURNING * INTO tx;
    RETURN tx;
  ELSE
    RAISE EXCEPTION 'Invalid bank reconciliation action.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_finance_bank_transaction(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_finance_bank_transaction(uuid, text, uuid, uuid) TO service_role;
