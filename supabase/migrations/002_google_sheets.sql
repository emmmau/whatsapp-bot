-- Per-company Google Sheets configuration

alter table if exists public.companies
add column if not exists google_spreadsheet_id text,
add column if not exists google_sheet_name text;

