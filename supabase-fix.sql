-- Corrective migration. Paste this into the Supabase SQL Editor and Run.
--
-- Two fixes:
--   1. Grant the anon role full CRUD on public tables (Supabase's default is
--      that anon can only SELECT even when RLS is disabled). Without this,
--      the frontend's INSERT/PATCH/DELETE requests get "42501 RLS policy"
--      errors.
--   2. Re-insert the seed rows. The bulk migration reported success but the
--      rows didn't land; running a plain INSERT (no ON CONFLICT trickery)
--      here guarantees they exist.

-- 1) Anon-role grants ─────────────────────────────────────────────────────
grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon;

-- Also grant to future tables in case we add more later.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to anon;

-- 2) Seed rows ────────────────────────────────────────────────────────────
-- Wipe first so this migration is deterministic when re-run.
truncate table
  public.patients,
  public.providers,
  public.encounters,
  public.appointments,
  public.prescriptions,
  public.lab_orders,
  public.lab_results,
  public.invoicing
restart identity;

insert into public.patients (first_name, last_name, dob, mrn, data) values
  ('Ava',    'Reyes',    '1988-03-14', 'MRN-001', '{"email":"ava.reyes@example.com","phone":"+1-555-0110","blood_type":"O+"}'),
  ('Julian', 'Okafor',   '1975-11-02', 'MRN-002', '{"email":"julian.okafor@example.com","phone":"+1-555-0211","blood_type":"A-"}'),
  ('Priya',  'Shah',     '1992-06-21', 'MRN-003', '{"email":"priya.shah@example.com","phone":"+1-555-0322","blood_type":"B+"}'),
  ('Ada',    'Lovelace', '1815-12-10', 'MRN-004', '{"email":"ada@analytical.engine","phone":"+1-555-0433","blood_type":"AB+"}'),
  ('Marcus', 'Johnson',  '1965-07-19', 'MRN-005', '{"email":"marcus.j@example.com","phone":"+1-555-0544","blood_type":"O-"}'),
  ('Sofia',  'Kim',      '2001-02-28', 'MRN-006', '{"email":"sofia.kim@example.com","phone":"+1-555-0655","blood_type":"A+"}');

insert into public.providers (data) values
  ('{"first_name":"Sarah","last_name":"Chen","npi":"1234567890","specialty":"Family Medicine","employee_id":"EMP-101"}'),
  ('{"first_name":"Marcus","last_name":"Rodriguez","npi":"1234567891","specialty":"Cardiology","employee_id":"EMP-102"}'),
  ('{"first_name":"Aisha","last_name":"Patel","npi":"1234567892","specialty":"Pediatrics","employee_id":"EMP-103"}'),
  ('{"first_name":"David","last_name":"Nguyen","npi":"1234567893","specialty":"Endocrinology","employee_id":"EMP-104"}');

insert into public.encounters (data) values
  ('{"patient_id":1,"provider_id":1,"reason":"Annual physical","location":"Clinic A","status":"completed"}'),
  ('{"patient_id":1,"provider_id":2,"reason":"Cardiology follow-up","location":"Clinic B"}'),
  ('{"patient_id":2,"provider_id":1,"reason":"Blood pressure check"}'),
  ('{"patient_id":3,"provider_id":3,"reason":"Pediatric wellness"}'),
  ('{"patient_id":5,"provider_id":4,"reason":"Diabetes management"}'),
  ('{"patient_id":6,"provider_id":3,"reason":"Sports physical"}');

insert into public.appointments (data) values
  ('{"patient_id":1,"provider_id":1,"starts_at":"2026-08-20T10:00:00Z","duration_min":30,"reason":"Annual physical"}'),
  ('{"patient_id":2,"provider_id":2,"starts_at":"2026-08-20T14:00:00Z","duration_min":45,"reason":"Follow-up"}'),
  ('{"patient_id":1,"provider_id":2,"starts_at":"2026-08-22T09:00:00Z","duration_min":30,"reason":"Cardiology"}'),
  ('{"patient_id":3,"provider_id":3,"starts_at":"2026-08-19T11:00:00Z","duration_min":30,"reason":"Wellness"}'),
  ('{"patient_id":5,"provider_id":4,"starts_at":"2026-08-21T15:00:00Z","duration_min":45,"reason":"Diabetes review"}');

insert into public.prescriptions (data) values
  ('{"patient_id":1,"provider_id":1,"drug":"Lisinopril","dose":"10mg","sig":"1 tab daily"}'),
  ('{"patient_id":1,"provider_id":2,"drug":"Metoprolol","dose":"25mg","sig":"1 tab twice daily"}'),
  ('{"patient_id":2,"provider_id":1,"drug":"Amlodipine","dose":"5mg","sig":"1 tab daily"}'),
  ('{"patient_id":5,"provider_id":4,"drug":"Metformin","dose":"500mg","sig":"1 tab twice daily with meals"}');

insert into public.lab_orders (data) values
  ('{"patient_id":1,"ordered_by":1,"test_code":"CBC","priority":"routine"}'),
  ('{"patient_id":1,"ordered_by":2,"test_code":"LIPID","priority":"routine"}'),
  ('{"patient_id":2,"ordered_by":1,"test_code":"CMP","priority":"stat"}'),
  ('{"patient_id":5,"ordered_by":4,"test_code":"HbA1c","priority":"routine"}');

insert into public.lab_results (data) values
  ('{"patient_id":1,"lab_order_id":1,"test_code":"CBC","result":"Normal","hemoglobin":14.2}'),
  ('{"patient_id":1,"lab_order_id":2,"test_code":"LIPID","result":"Elevated LDL","ldl":145}'),
  ('{"patient_id":5,"lab_order_id":4,"test_code":"HbA1c","result":"7.2% - target 7.0%"}');

insert into public.invoicing (data) values
  ('{"patient_id":1,"amount":250.00,"description":"Annual physical - 2026","status":"pending"}'),
  ('{"patient_id":1,"amount":85.50,"description":"Cardiology consult","status":"pending"}'),
  ('{"patient_id":2,"amount":150.00,"description":"BP check + labs","status":"paid"}'),
  ('{"patient_id":5,"amount":320.00,"description":"Diabetes management + labs","status":"pending"}');
