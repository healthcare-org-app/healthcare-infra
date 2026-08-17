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
  public.imaging_orders,
  public.imaging_results,
  public.invoicing,
  public.payer_directory,
  public.facilities,
  public.claims_submission,
  public.claims_status,
  public.problem_list,
  public.allergies,
  public.immunizations,
  public.charge_capture
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
  ('{"patient_id":1,"encounter_id":1,"amount":250.00,"description":"Annual physical - 2026","status":"pending"}'),
  ('{"patient_id":1,"encounter_id":2,"amount":85.50,"description":"Cardiology consult","status":"pending"}'),
  ('{"patient_id":2,"encounter_id":3,"amount":150.00,"description":"BP check + labs","status":"paid"}'),
  ('{"patient_id":5,"encounter_id":5,"amount":320.00,"description":"Diabetes management + labs","status":"pending"}');

-- 3) Cross-reference catalog + FK chain tables added 2026-08-17 ──────────
-- Payers, facilities, imaging orders/results, claims, statuses, problems,
-- allergies, immunizations, charges. Enough to demonstrate the full
-- clinical → billing graph across every FK dropdown.

insert into public.payer_directory (data) values
  ('{"name":"Aetna","phone":"1-800-872-3862","address":"151 Farmington Ave, Hartford, CT"}'),
  ('{"name":"Blue Cross Blue Shield","phone":"1-888-630-2583","address":"225 N Michigan Ave, Chicago, IL"}'),
  ('{"name":"UnitedHealthcare","phone":"1-866-414-1959","address":"9700 Health Care Ln, Minnetonka, MN"}'),
  ('{"name":"Cigna","phone":"1-800-244-6224","address":"900 Cottage Grove Rd, Bloomfield, CT"}'),
  ('{"name":"Medicare","phone":"1-800-633-4227","address":"7500 Security Blvd, Baltimore, MD"}');

insert into public.facilities (data) values
  ('{"name":"Main Clinic","address":"123 Main St, Springfield, IL","phone":"+1-555-1000"}'),
  ('{"name":"Cardiology Center","address":"456 Heart Way, Springfield, IL","phone":"+1-555-2000"}'),
  ('{"name":"Downtown Urgent Care","address":"789 Central Ave, Springfield, IL","phone":"+1-555-3000"}'),
  ('{"name":"Pediatric Wing","address":"321 Children Blvd, Springfield, IL","phone":"+1-555-4000"}');

insert into public.imaging_orders (data) values
  ('{"patient_id":1,"ordered_by":2,"encounter_id":2,"modality":"echo","body_part":"Heart","priority":"routine"}'),
  ('{"patient_id":2,"ordered_by":1,"encounter_id":3,"modality":"xray","body_part":"Chest","priority":"routine"}'),
  ('{"patient_id":5,"ordered_by":4,"encounter_id":5,"modality":"mri","body_part":"Abdomen","priority":"stat"}');

insert into public.imaging_results (data) values
  ('{"patient_id":1,"imaging_order_id":1,"author_id":2,"findings":"Normal LV function, EF 55%"}'),
  ('{"patient_id":2,"imaging_order_id":2,"author_id":1,"findings":"Clear lung fields, no infiltrates"}');

insert into public.claims_submission (status, data) values
  ('submitted', '{"patient_id":1,"provider_id":1,"encounter_id":1,"payer_id":1,"prescription_id":1,"diagnosis_codes":"Z00.00","amount":250.00}'),
  ('submitted', '{"patient_id":1,"provider_id":2,"encounter_id":2,"payer_id":1,"imaging_order_id":1,"diagnosis_codes":"I10","amount":450.00}'),
  ('paid',      '{"patient_id":2,"provider_id":1,"encounter_id":3,"payer_id":2,"lab_order_id":3,"diagnosis_codes":"I10","amount":150.00}'),
  ('submitted', '{"patient_id":5,"provider_id":4,"encounter_id":5,"payer_id":5,"prescription_id":4,"lab_order_id":4,"diagnosis_codes":"E11.9","amount":320.00}');

insert into public.claims_status (data) values
  ('{"claim_id":1,"status_code":"pending_review","checked_at":"2026-08-15T10:00:00Z"}'),
  ('{"claim_id":2,"status_code":"in_adjudication","checked_at":"2026-08-16T10:00:00Z"}'),
  ('{"claim_id":3,"status_code":"paid","checked_at":"2026-08-14T10:00:00Z"}'),
  ('{"claim_id":4,"status_code":"pending_review","checked_at":"2026-08-17T10:00:00Z"}');

insert into public.problem_list (data) values
  ('{"patient_id":1,"encounter_id":1,"condition":"Essential hypertension","icd10":"I10","onset_at":"2020-05-14"}'),
  ('{"patient_id":1,"encounter_id":2,"condition":"Hyperlipidemia","icd10":"E78.5","onset_at":"2022-11-01"}'),
  ('{"patient_id":2,"encounter_id":3,"condition":"Prehypertension","icd10":"R03.0","onset_at":"2024-01-15"}'),
  ('{"patient_id":5,"encounter_id":5,"condition":"Type 2 diabetes mellitus","icd10":"E11.9","onset_at":"2015-03-22"}');

insert into public.allergies (data) values
  ('{"patient_id":1,"allergen":"Penicillin","reaction":"Hives","severity":"moderate"}'),
  ('{"patient_id":2,"allergen":"Peanuts","reaction":"Anaphylaxis","severity":"critical"}'),
  ('{"patient_id":3,"allergen":"Latex","reaction":"Contact dermatitis","severity":"low"}');

insert into public.immunizations (data) values
  ('{"patient_id":1,"administered_by":1,"vaccine":"Influenza","administered_at":"2025-10-01","lot_number":"FLU-2025-A"}'),
  ('{"patient_id":3,"administered_by":3,"vaccine":"MMR","administered_at":"2024-02-15","lot_number":"MMR-2024-B"}'),
  ('{"patient_id":6,"administered_by":3,"vaccine":"HPV","administered_at":"2025-06-20","lot_number":"HPV-2025-A"}');

insert into public.charge_capture (data) values
  ('{"patient_id":1,"encounter_id":1,"provider_id":1,"cpt_code":"99213","amount":150.00}'),
  ('{"patient_id":1,"encounter_id":2,"provider_id":2,"cpt_code":"93000","amount":85.50}'),
  ('{"patient_id":2,"encounter_id":3,"provider_id":1,"cpt_code":"99214","amount":200.00}'),
  ('{"patient_id":5,"encounter_id":5,"provider_id":4,"cpt_code":"99215","amount":250.00}');
