export type ResourceDef = {
  url: string;
  table: string;
  domain: string;
};

// URL segment → Postgres table. 94 entries (101 services in frontend/src/services.ts
// minus 7 with hasCrud:false: api-gateway, service-registry, patient-portal-api,
// provider-portal-api, device-telemetry-service, sms-gateway-service,
// secure-messaging-service). Two URL/table quirks match services.ts PREFIX_OVERRIDES:
//   authorization-service → URL "authorization_records" (not "authorization")
//   erp-bridge-service    → URL "erp-bridge" (keeps hyphen; table "erp_bridge")
export const RESOURCES: ResourceDef[] = [
  // Platform
  { url: "identity", table: "identity", domain: "PLATFORM" },
  { url: "auth", table: "auth", domain: "PLATFORM" },
  { url: "authorization_records", table: "authorization_records", domain: "PLATFORM" },
  { url: "config", table: "config", domain: "PLATFORM" },
  { url: "secrets_vault", table: "secrets_vault", domain: "PLATFORM" },
  { url: "audit_log", table: "audit_log", domain: "PLATFORM" },
  { url: "feature_flags", table: "feature_flags", domain: "PLATFORM" },
  { url: "tenancy", table: "tenancy", domain: "PLATFORM" },
  // Patients
  { url: "patients", table: "patients", domain: "PATIENTS" },
  { url: "demographics", table: "demographics", domain: "PATIENTS" },
  { url: "patient_consent", table: "patient_consent", domain: "PATIENTS" },
  { url: "patient_preferences", table: "patient_preferences", domain: "PATIENTS" },
  { url: "patient_relationships", table: "patient_relationships", domain: "PATIENTS" },
  { url: "patient_timeline", table: "patient_timeline", domain: "PATIENTS" },
  { url: "patient_search", table: "patient_search", domain: "PATIENTS" },
  { url: "patient_merge", table: "patient_merge", domain: "PATIENTS" },
  { url: "patient_communications", table: "patient_communications", domain: "PATIENTS" },
  // Providers
  { url: "providers", table: "providers", domain: "PROVIDERS" },
  { url: "credentialing", table: "credentialing", domain: "PROVIDERS" },
  { url: "licensing", table: "licensing", domain: "PROVIDERS" },
  { url: "specialties", table: "specialties", domain: "PROVIDERS" },
  { url: "provider_schedule", table: "provider_schedule", domain: "PROVIDERS" },
  { url: "on_call", table: "on_call", domain: "PROVIDERS" },
  { url: "provider_directory", table: "provider_directory", domain: "PROVIDERS" },
  { url: "provider_performance", table: "provider_performance", domain: "PROVIDERS" },
  // Clinical/EHR
  { url: "ehr", table: "ehr", domain: "CLINICAL/EHR" },
  { url: "encounters", table: "encounters", domain: "CLINICAL/EHR" },
  { url: "clinical_notes", table: "clinical_notes", domain: "CLINICAL/EHR" },
  { url: "problem_list", table: "problem_list", domain: "CLINICAL/EHR" },
  { url: "med_reconciliation", table: "med_reconciliation", domain: "CLINICAL/EHR" },
  { url: "allergies", table: "allergies", domain: "CLINICAL/EHR" },
  { url: "immunizations", table: "immunizations", domain: "CLINICAL/EHR" },
  { url: "vitals", table: "vitals", domain: "CLINICAL/EHR" },
  { url: "cpoe", table: "cpoe", domain: "CLINICAL/EHR" },
  { url: "care_plan", table: "care_plan", domain: "CLINICAL/EHR" },
  { url: "referrals", table: "referrals", domain: "CLINICAL/EHR" },
  { url: "discharge_summary", table: "discharge_summary", domain: "CLINICAL/EHR" },
  { url: "clinical_decision_support", table: "clinical_decision_support", domain: "CLINICAL/EHR" },
  { url: "diagnosis_codes", table: "diagnosis_codes", domain: "CLINICAL/EHR" },
  { url: "care_teams", table: "care_teams", domain: "CLINICAL/EHR" },
  // Diagnostics
  { url: "lab_orders", table: "lab_orders", domain: "DIAGNOSTICS" },
  { url: "lab_results", table: "lab_results", domain: "DIAGNOSTICS" },
  { url: "imaging_orders", table: "imaging_orders", domain: "DIAGNOSTICS" },
  { url: "imaging_results", table: "imaging_results", domain: "DIAGNOSTICS" },
  { url: "pathology", table: "pathology", domain: "DIAGNOSTICS" },
  { url: "radiology_worklist", table: "radiology_worklist", domain: "DIAGNOSTICS" },
  { url: "specimen_tracking", table: "specimen_tracking", domain: "DIAGNOSTICS" },
  { url: "reference_ranges", table: "reference_ranges", domain: "DIAGNOSTICS" },
  // Pharmacy
  { url: "pharmacy", table: "pharmacy", domain: "PHARMACY" },
  { url: "prescriptions", table: "prescriptions", domain: "PHARMACY" },
  { url: "refills", table: "refills", domain: "PHARMACY" },
  { url: "drug_interactions", table: "drug_interactions", domain: "PHARMACY" },
  { url: "formulary", table: "formulary", domain: "PHARMACY" },
  { url: "pharmacy_inventory", table: "pharmacy_inventory", domain: "PHARMACY" },
  { url: "dispensing", table: "dispensing", domain: "PHARMACY" },
  // Scheduling
  { url: "appointments", table: "appointments", domain: "SCHEDULING" },
  { url: "appointment_slots", table: "appointment_slots", domain: "SCHEDULING" },
  { url: "reminders", table: "reminders", domain: "SCHEDULING" },
  { url: "waitlist", table: "waitlist", domain: "SCHEDULING" },
  { url: "room_booking", table: "room_booking", domain: "SCHEDULING" },
  // Billing/RCM
  { url: "billing", table: "billing", domain: "BILLING/RCM" },
  { url: "charge_capture", table: "charge_capture", domain: "BILLING/RCM" },
  { url: "coding", table: "coding", domain: "BILLING/RCM" },
  { url: "claims_submission", table: "claims_submission", domain: "BILLING/RCM" },
  { url: "claims_adjudication", table: "claims_adjudication", domain: "BILLING/RCM" },
  { url: "denials", table: "denials", domain: "BILLING/RCM" },
  { url: "invoicing", table: "invoicing", domain: "BILLING/RCM" },
  { url: "payments", table: "payments", domain: "BILLING/RCM" },
  { url: "statements", table: "statements", domain: "BILLING/RCM" },
  { url: "collections", table: "collections", domain: "BILLING/RCM" },
  // Insurance
  { url: "eligibility", table: "eligibility", domain: "INSURANCE" },
  { url: "prior_auth", table: "prior_auth", domain: "INSURANCE" },
  { url: "coverage_verification", table: "coverage_verification", domain: "INSURANCE" },
  { url: "payer_directory", table: "payer_directory", domain: "INSURANCE" },
  { url: "payer_edi_connect", table: "payer_edi_connect", domain: "INSURANCE" },
  { url: "claims_status", table: "claims_status", domain: "INSURANCE" },
  // Devices/IoT
  { url: "device_registry", table: "device_registry", domain: "DEVICES/IOT" },
  { url: "device_alerts", table: "device_alerts", domain: "DEVICES/IOT" },
  { url: "device_fleet", table: "device_fleet", domain: "DEVICES/IOT" },
  { url: "remote_monitoring", table: "remote_monitoring", domain: "DEVICES/IOT" },
  // Communications
  { url: "notifications", table: "notifications", domain: "COMMUNICATIONS" },
  { url: "email_gateway", table: "email_gateway", domain: "COMMUNICATIONS" },
  { url: "push_gateway", table: "push_gateway", domain: "COMMUNICATIONS" },
  // AI/Analytics
  { url: "ai_agents", table: "ai_agents", domain: "AI/ANALYTICS" },
  { url: "ai_invocations", table: "ai_invocations", domain: "AI/ANALYTICS" },
  { url: "analytics_events", table: "analytics_events", domain: "AI/ANALYTICS" },
  { url: "reporting", table: "reporting", domain: "AI/ANALYTICS" },
  { url: "ml_models", table: "ml_models", domain: "AI/ANALYTICS" },
  // Facility/Ops
  { url: "facilities", table: "facilities", domain: "FACILITY/OPS" },
  { url: "wards_beds", table: "wards_beds", domain: "FACILITY/OPS" },
  { url: "equipment", table: "equipment", domain: "FACILITY/OPS" },
  { url: "sterile_supply", table: "sterile_supply", domain: "FACILITY/OPS" },
  { url: "maintenance", table: "maintenance", domain: "FACILITY/OPS" },
  // Integration
  { url: "erp-bridge", table: "erp_bridge", domain: "INTEGRATION" },
];

const BY_URL: Map<string, ResourceDef> = new Map(RESOURCES.map((r) => [r.url, r]));

export function resolveResource(urlSegment: string): ResourceDef | null {
  return BY_URL.get(urlSegment) ?? null;
}
