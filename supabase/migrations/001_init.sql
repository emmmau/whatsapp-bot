-- Core schema for WhatsApp hour logging MVP

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone_number text not null,
  role text not null default 'boss',
  created_at timestamptz not null default now(),
  unique (company_id, phone_number)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  date date not null,
  start_time time,
  end_time time,
  worked_hours numeric(6,2) not null,
  boss_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Conversation state for resolving ambiguous employee names
create table if not exists public.pending_employee_resolution (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  boss_id uuid not null references public.users(id) on delete cascade,
  boss_phone text not null,
  raw_message text not null,
  parsed_payload jsonb not null,
  candidate_employee_ids uuid[] not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_phone on public.users (phone_number);
create index if not exists idx_employees_company_active on public.employees (company_id, active);
create index if not exists idx_work_logs_company_date on public.work_logs (company_id, date);
create index if not exists idx_pending_boss_phone on public.pending_employee_resolution (boss_phone);

