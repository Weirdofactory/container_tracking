alter table public.shipment_milestones
  add column if not exists photo_path text;
