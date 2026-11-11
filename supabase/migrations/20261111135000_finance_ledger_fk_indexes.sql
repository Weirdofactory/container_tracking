CREATE INDEX IF NOT EXISTS finance_journal_entries_posted_by_idx ON public.finance_journal_entries(posted_by);
CREATE INDEX IF NOT EXISTS finance_journal_lines_customer_idx ON public.finance_journal_lines(customer_id);
CREATE INDEX IF NOT EXISTS finance_journal_lines_job_idx ON public.finance_journal_lines(job_id);
CREATE INDEX IF NOT EXISTS finance_journal_lines_vendor_idx ON public.finance_journal_lines(vendor_id);
