CREATE TABLE IF NOT EXISTS public.customer_portal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_portal_access_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_portal_access_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.customer_portal_access_tokens TO service_role;

CREATE INDEX IF NOT EXISTS customer_portal_access_customer_created_idx
  ON public.customer_portal_access_tokens (customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.customer_portal_quote_decision(
  p_quote_id uuid,
  p_customer_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.freight_quotes%rowtype;
  v_enquiry public.sales_enquiries%rowtype;
  v_customer public.customer_accounts%rowtype;
  v_before jsonb;
  v_result jsonb;
  v_actor_email text;
BEGIN
  IF p_outcome NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION 'Invalid quote decision.';
  END IF;

  SELECT * INTO v_quote
  FROM public.freight_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found.';
  END IF;

  SELECT * INTO v_enquiry
  FROM public.sales_enquiries
  WHERE id = v_quote.enquiry_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The linked enquiry could not be found.';
  END IF;

  IF coalesce(v_quote.customer_id, v_enquiry.customer_id) IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'This quote does not belong to the linked customer account.';
  END IF;

  SELECT * INTO v_customer
  FROM public.customer_accounts
  WHERE id = p_customer_id AND is_active = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer account is inactive or unavailable.';
  END IF;

  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'Only open quotes can be accepted or declined.';
  END IF;
  IF p_outcome = 'accepted' AND v_quote.valid_until IS NOT NULL AND v_quote.valid_until < current_date THEN
    RAISE EXCEPTION 'This quote has expired.';
  END IF;

  v_before := to_jsonb(v_quote);
  v_actor_email := coalesce(nullif(v_customer.email, ''), 'customer portal');

  IF p_outcome = 'rejected' THEN
    UPDATE public.freight_quotes
    SET status = 'rejected', responded_at = now(), updated_at = now()
    WHERE id = p_quote_id
    RETURNING * INTO v_quote;

    INSERT INTO public.logistics_module_audit(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
    VALUES (NULL, v_actor_email, 'customer_rejected', 'freight_quote', p_quote_id::text, v_before, to_jsonb(v_quote));

    RETURN jsonb_build_object('quote', to_jsonb(v_quote), 'job', NULL);
  END IF;

  UPDATE public.freight_quotes
  SET status = 'accepted', responded_at = now(), updated_at = now()
  WHERE id = p_quote_id
  RETURNING * INTO v_quote;

  v_result := public.convert_accepted_quote_to_job(p_quote_id, NULL);

  INSERT INTO public.logistics_module_audit(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
  VALUES (NULL, v_actor_email, 'customer_accepted_and_booked', 'freight_quote', p_quote_id::text, v_before, v_result);

  IF nullif(v_result #>> '{job,id}', '') IS NOT NULL THEN
    INSERT INTO public.logistics_module_audit(actor_id, actor_email, action, entity_type, entity_id, before_data, after_data)
    VALUES (NULL, v_actor_email, 'customer_quote_booking_created', 'forwarding_job',
      v_result #>> '{job,id}', NULL, v_result->'job');
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.customer_portal_quote_decision(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_quote_decision(uuid, uuid, text) TO service_role;
