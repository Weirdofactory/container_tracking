create policy vendor_accounts_staff_only on public.vendor_accounts
  for all to anon,authenticated using (false) with check (false);
create policy vendor_bills_staff_only on public.vendor_bills
  for all to anon,authenticated using (false) with check (false);
create policy vendor_bill_lines_staff_only on public.vendor_bill_lines
  for all to anon,authenticated using (false) with check (false);
create policy vendor_bill_payments_staff_only on public.vendor_bill_payments
  for all to anon,authenticated using (false) with check (false);
