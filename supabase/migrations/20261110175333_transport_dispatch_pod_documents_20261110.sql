alter table public.transport_dispatches
  add column if not exists pod_object_path text,
  add column if not exists pod_document_name text,
  add column if not exists pod_content_type text,
  add column if not exists pod_file_size bigint;
