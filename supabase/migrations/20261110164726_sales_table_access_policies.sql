create policy sales_enquiries_staff_only on public.sales_enquiries
  for all to anon,authenticated using (false) with check (false);
create policy freight_quotes_staff_only on public.freight_quotes
  for all to anon,authenticated using (false) with check (false);
create policy freight_quote_lines_staff_only on public.freight_quote_lines
  for all to anon,authenticated using (false) with check (false);
create policy document_number_counters_staff_only on public.document_number_counters
  for all to anon,authenticated using (false) with check (false);
