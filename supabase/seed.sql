-- Demo seed to test ambiguity flow quickly.
-- Replace phone_number with the boss phone you will provide later.

insert into public.companies (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Demo Company')
on conflict do nothing;

insert into public.users (company_id, name, phone_number, role)
values ('00000000-0000-0000-0000-000000000001', 'Jefe Demo', '+0000000000', 'boss')
on conflict do nothing;

insert into public.employees (company_id, name, active)
values
  ('00000000-0000-0000-0000-000000000001', 'Juan Perez', true),
  ('00000000-0000-0000-0000-000000000001', 'Juan Sosa', true)
on conflict do nothing;

