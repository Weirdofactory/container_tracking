create table public.forwarding_shipment_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique default ('OPS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  job_id uuid not null references public.forwarding_jobs(id) on delete restrict,
  hbl_id uuid references public.forwarding_job_hbls(id) on delete restrict,
  document_type text not null check (document_type in ('shipping_instructions','pre_alert','arrival_notice','delivery_order')),
  status text not null default 'draft' check (status in ('draft','issued')),
  document_date date not null,
  recipient_name text not null default '' check (length(recipient_name)<=160),
  recipient_email text not null default '' check (length(recipient_email)<=254),
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields)='object'),
  snapshot jsonb check (snapshot is null or jsonb_typeof(snapshot)='object'),
  issued_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forwarding_shipment_documents_issue_state check (
    (status='draft' and issued_at is null and snapshot is null)
    or (status='issued' and issued_at is not null and snapshot is not null)
  )
);

create index forwarding_shipment_documents_job_date_idx
  on public.forwarding_shipment_documents(job_id,document_date desc);
create index forwarding_shipment_documents_hbl_idx
  on public.forwarding_shipment_documents(hbl_id) where hbl_id is not null;
create index forwarding_shipment_documents_type_status_idx
  on public.forwarding_shipment_documents(document_type,status,document_date desc);

alter table public.forwarding_shipment_documents enable row level security;
revoke all on public.forwarding_shipment_documents from anon,authenticated;
grant all on public.forwarding_shipment_documents to service_role;
create policy forwarding_shipment_documents_deny_anon
  on public.forwarding_shipment_documents for all to anon using (false) with check (false);
create policy forwarding_shipment_documents_deny_authenticated
  on public.forwarding_shipment_documents for all to authenticated using (false) with check (false);

create or replace function public.issue_forwarding_shipment_document(
  p_document_id uuid,
  p_snapshot jsonb,
  p_user_id uuid
) returns public.forwarding_shipment_documents
language plpgsql
security definer
set search_path=public
as $$
declare
  d public.forwarding_shipment_documents%rowtype;
begin
  select * into d from public.forwarding_shipment_documents where id=p_document_id for update;
  if not found then raise exception 'Shipment document not found.'; end if;
  if d.status <> 'draft' then raise exception 'Issued shipment documents are locked.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'A document snapshot is required.'; end if;
  update public.forwarding_shipment_documents
    set status='issued',snapshot=p_snapshot,issued_at=now(),updated_by=p_user_id,updated_at=now()
    where id=d.id returning * into d;
  return d;
end;
$$;

revoke all on function public.issue_forwarding_shipment_document(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.issue_forwarding_shipment_document(uuid,jsonb,uuid) to service_role;
