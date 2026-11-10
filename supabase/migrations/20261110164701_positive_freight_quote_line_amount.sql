alter table public.freight_quote_lines
  add constraint freight_quote_lines_positive_subtotal_check check (line_subtotal > 0);
