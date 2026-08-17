// Service registry — derived from infra/registry.yaml and tools/scaffold.py's
// naming convention (RESOURCE = service name minus "-service", "-" → "_").
// Every service exposes /api/<resource>/ with the uniform CRUD envelope
// { id, status, created_at, updated_at, ...data }. patients-service adds
// /search and /<id>/summary. Custom action endpoints declared per-service.

export type Stack =
  | "core"
  | "clinical"
  | "billing"
  | "insurance"
  | "devices"
  | "comms"
  | "erp-bridge"
  | "other"; // catch-all for services not wired into any stack in run.sh

export type Domain =
  | "PLATFORM"
  | "PATIENTS"
  | "PROVIDERS"
  | "CLINICAL/EHR"
  | "DIAGNOSTICS"
  | "PHARMACY"
  | "SCHEDULING"
  | "BILLING/RCM"
  | "INSURANCE"
  | "DEVICES/IOT"
  | "COMMUNICATIONS"
  | "AI/ANALYTICS"
  | "FACILITY/OPS"
  | "INTEGRATION";

export interface CustomAction {
  label: string;
  method: "POST" | "GET";
  path: string; // relative to /api/<resource>/<id>, e.g. "/cancel"
}

export interface FieldHint {
  key: string;
  label?: string;
  required?: boolean;
  kind?: "text" | "date" | "datetime" | "number" | "textarea" | "select" | "ref";
  placeholder?: string;
  // For kind "select": static options
  options?: Array<{ value: string; label: string }>;
  // For kind "ref": override the auto-detected target service by name
  refTo?: string;
}

// FK field names → target service name. When ResourceForm sees one of these
// keys, it renders a dropdown of records from that service instead of a
// free-text input. Extend as new FK fields appear in the data model.
export const FK_TARGETS: Record<string, string> = {
  patient_id: "patients-service",
  provider_id: "providers-service",
  ordered_by: "providers-service",
  author_id: "providers-service",
  referring_provider_id: "providers-service",
  referred_to_provider_id: "providers-service",
  encounter_id: "encounters-service",
  appointment_id: "appointments-service",
  prescription_id: "prescriptions-service",
  lab_order_id: "lab-orders-service",
  imaging_order_id: "imaging-orders-service",
  invoice_id: "invoicing-service",
  claim_id: "claims-submission-service",
  payer_id: "payer-directory",
  facility_id: "facilities-service",
  device_id: "device-registry-service",
  equipment_id: "equipment-service",
  source_patient_id: "patients-service",
  target_patient_id: "patients-service",
  related_to: "patients-service",
};

// Turn a Row from a given service into a human-readable label for dropdowns
// and FK columns in tables.
export function formatRefLabel(
  serviceName: string,
  row: Record<string, unknown> & { id: number },
): string {
  const s = (k: string) => (row[k] == null ? "" : String(row[k]));
  const idFallback = `#${row.id}`;

  if (serviceName === "patients-service") {
    const name = [s("first_name"), s("last_name")].filter(Boolean).join(" ");
    const mrn = s("mrn");
    if (!name) return mrn || idFallback;
    return mrn ? `${name} (${mrn})` : name;
  }
  if (serviceName === "providers-service") {
    const name = [s("first_name"), s("last_name")].filter(Boolean).join(" ");
    const specialty = s("specialty");
    if (!name) return idFallback;
    return specialty ? `${name} — ${specialty}` : name;
  }
  if (serviceName === "encounters-service") {
    return [idFallback, s("reason")].filter(Boolean).join(" · ");
  }
  if (serviceName === "appointments-service") {
    const when = row.starts_at
      ? new Date(String(row.starts_at)).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
    return [idFallback, when, s("reason")].filter(Boolean).join(" · ");
  }
  if (serviceName === "prescriptions-service") {
    return [idFallback, s("drug"), s("dose")].filter(Boolean).join(" · ");
  }
  if (serviceName === "lab-orders-service") {
    return [idFallback, s("test_code")].filter(Boolean).join(" · ");
  }
  if (serviceName === "invoicing-service") {
    const amount = row.amount != null ? `$${row.amount}` : "";
    return [idFallback, s("description"), amount].filter(Boolean).join(" · ");
  }
  if (serviceName === "facilities-service" || serviceName === "payer-directory") {
    return s("name") || idFallback;
  }
  // Generic fallback — grab a short label from typical name-ish fields.
  const guess =
    s("name") || s("title") || s("code") || s("test_code") || s("drug") || s("description");
  return guess ? `${idFallback} — ${guess.slice(0, 40)}` : idFallback;
}

// Turn a snake_case key into a human label. patient_id → "Patient", ordered_by → "Ordered by".
export function humanizeKey(key: string): string {
  const noId = key.replace(/_id$/, "");
  return noId
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export interface ServiceDef {
  name: string;
  port: number;
  language: "python" | "go" | "node";
  domain: Domain;
  stack: Stack;
  resource: string; // path segment, e.g. "patients", "lab_orders"
  prefix: string; // full public prefix, e.g. "/api/patients"
  renderUrl: string; // deployed origin, e.g. "https://hc-patients.onrender.com"
  displayName: string;
  hasCrud: boolean; // false for api-gateway, service-registry, patient-portal-api, provider-portal-api, secrets-vault, etc.
  createFields?: FieldHint[]; // hint for the generic form
  actions?: CustomAction[]; // per-record buttons
  bulkActions?: CustomAction[]; // top-of-page actions (no id)
}

// Which docker-compose stacks are currently up. The frontend uses this to
// avoid calling services it knows aren't running. Update this (or make it
// runtime-configurable) after bringing up more stacks with infra/run.sh.
export const ENABLED_STACKS: Stack[] = [
  "core",
  "clinical",
  "billing",
  "insurance",
  "devices",
  "comms",
  "erp-bridge",
  "other",
];
export const isServiceEnabled = (s: ServiceDef): boolean =>
  ENABLED_STACKS.includes(s.stack);

// Stack membership derived from infra/run.sh definitions.
const STACK_MEMBERSHIP: Record<string, Stack> = {
  // core
  "identity-service": "core",
  "auth-service": "core",
  "authorization-service": "core",
  "audit-log-service": "core",
  "patients-service": "core",
  "providers-service": "core",
  "notifications-service": "core",
  // clinical
  "ehr-service": "clinical",
  "encounters-service": "clinical",
  "cpoe-service": "clinical",
  "appointments-service": "clinical",
  "lab-orders-service": "clinical",
  "lab-results-service": "clinical",
  "imaging-orders-service": "clinical",
  "imaging-results-service": "clinical",
  "prescriptions-service": "clinical",
  "pharmacy-service": "clinical",
  // billing
  "billing-service": "billing",
  "charge-capture-service": "billing",
  "claims-submission-service": "billing",
  "claims-adjudication-service": "billing",
  "denials-service": "billing",
  "invoicing-service": "billing",
  "payments-service": "billing",
  "statements-service": "billing",
  "collections-service": "billing",
  // insurance
  "eligibility-service": "insurance",
  "prior-auth-service": "insurance",
  "coverage-verification-service": "insurance",
  "payer-directory": "insurance",
  "payer-edi-connect": "insurance",
  "claims-status-service": "insurance",
  // devices
  "device-registry-service": "devices",
  "device-telemetry-service": "devices",
  "device-alerts-service": "devices",
  "device-fleet-service": "devices",
  "remote-monitoring-service": "devices",
  "vitals-service": "devices",
  // comms
  "sms-gateway-service": "comms",
  "email-gateway-service": "comms",
  "push-gateway-service": "comms",
  "patient-communications-service": "comms",
  "secure-messaging-service": "comms",
  // erp-bridge
  "erp-bridge-service": "erp-bridge",
};

// Overrides for services where the URL prefix doesn't follow the standard
// `<name>.replace('-service','').replace('-','_')` convention.
// Verified against each service's routes.py at 2026-08-11.
const PREFIX_OVERRIDES: Record<string, string> = {
  "authorization-service": "/api/authorization_records",
  "erp-bridge-service": "/api/erp-bridge",
};

const svc = (
  name: string,
  port: number,
  language: ServiceDef["language"],
  domain: Domain,
  extra: Partial<ServiceDef> = {},
): ServiceDef => {
  const resource = name.replace(/-service$/, "").replace(/-/g, "_");
  const prefix = PREFIX_OVERRIDES[name] ?? `/api/${resource}`;
  const renderName = `hc-${name.replace(/-service$/, "")}`;
  return {
    name,
    port,
    language,
    domain,
    stack: STACK_MEMBERSHIP[name] ?? "other",
    resource,
    prefix,
    renderUrl: `https://${renderName}.onrender.com`,
    displayName: name
      .replace(/-service$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase()),
    hasCrud: true,
    ...extra,
  };
};

// Common select-option groups reused across services.
const SEVERITY: FieldHint["options"] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];
const PRIORITY: FieldHint["options"] = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "stat", label: "STAT" },
];
const YES_NO: FieldHint["options"] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const CHANNEL: FieldHint["options"] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "push", label: "Push" },
  { value: "portal", label: "Portal" },
];
const IMAGING_MODALITY: FieldHint["options"] = [
  { value: "xray", label: "X-ray" },
  { value: "ct", label: "CT" },
  { value: "mri", label: "MRI" },
  { value: "ultrasound", label: "Ultrasound" },
  { value: "pet", label: "PET" },
];
const DAY_OF_WEEK: FieldHint["options"] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];
const INVOICE_STATUS: FieldHint["options"] = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
];
const PAYMENT_METHOD: FieldHint["options"] = [
  { value: "card", label: "Card" },
  { value: "ach", label: "ACH" },
  { value: "cash", label: "Cash" },
  { value: "insurance", label: "Insurance" },
];
const RELATIONSHIP: FieldHint["options"] = [
  { value: "spouse", label: "Spouse" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "guardian", label: "Guardian" },
  { value: "emergency_contact", label: "Emergency contact" },
];

export const SERVICES: ServiceDef[] = [
  // PLATFORM
  svc("api-gateway", 8000, "go", "PLATFORM", { hasCrud: false }),
  svc("identity-service", 8001, "python", "PLATFORM", {
    createFields: [
      { key: "email", required: true },
      { key: "name" },
      { key: "role", kind: "select", options: [
        { value: "patient", label: "Patient" },
        { value: "provider", label: "Provider" },
        { value: "clinician", label: "Clinician" },
        { value: "nurse", label: "Nurse" },
        { value: "staff", label: "Staff" },
        { value: "admin", label: "Admin" },
      ]},
    ],
  }),
  svc("auth-service", 8002, "python", "PLATFORM", {
    createFields: [
      { key: "email", required: true },
      { key: "session_type", kind: "select", options: [
        { value: "web", label: "Web" }, { value: "mobile", label: "Mobile" }, { value: "api", label: "API" },
      ]},
    ],
  }),
  svc("authorization-service", 8003, "python", "PLATFORM", {
    createFields: [
      { key: "principal", label: "Principal (user or role)" },
      { key: "scope" },
      { key: "grant_type", kind: "select", options: [
        { value: "read", label: "Read" }, { value: "write", label: "Write" }, { value: "admin", label: "Admin" },
      ]},
    ],
  }),
  svc("service-registry", 8004, "go", "PLATFORM", { hasCrud: false }),
  svc("config-service", 8005, "python", "PLATFORM", {
    createFields: [{ key: "key", required: true }, { key: "value" }, { key: "description" }],
  }),
  svc("secrets-vault", 8006, "python", "PLATFORM", {
    createFields: [{ key: "name", required: true }, { key: "value", kind: "textarea" }],
  }),
  svc("audit-log-service", 8007, "python", "PLATFORM", {
    createFields: [
      { key: "actor" }, { key: "action" }, { key: "target" }, { key: "notes", kind: "textarea" },
    ],
  }),
  svc("feature-flags-service", 8008, "python", "PLATFORM", {
    createFields: [
      { key: "name", required: true },
      { key: "enabled", kind: "select", options: YES_NO, required: true },
      { key: "description" },
    ],
  }),
  svc("tenancy-service", 8009, "python", "PLATFORM", {
    createFields: [{ key: "name", required: true }, { key: "tier", kind: "select", options: [
      { value: "trial", label: "Trial" }, { value: "standard", label: "Standard" }, { value: "enterprise", label: "Enterprise" },
    ]}],
  }),

  // PATIENTS
  svc("patients-service", 8100, "python", "PATIENTS", {
    createFields: [
      { key: "first_name", required: true },
      { key: "last_name", required: true },
      { key: "dob", required: true, kind: "date" },
      { key: "mrn", label: "MRN" },
      { key: "email" },
      { key: "phone" },
    ],
    bulkActions: [{ label: "Search", method: "GET", path: "/search" }],
  }),
  svc("demographics-service", 8101, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "address" }, { key: "city" }, { key: "state" }, { key: "zip", label: "ZIP" },
    ],
  }),
  svc("patient-consent-service", 8102, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "consent_type", kind: "select", options: [
        { value: "hipaa", label: "HIPAA" },
        { value: "treatment", label: "Treatment" },
        { value: "billing", label: "Billing" },
        { value: "research", label: "Research" },
      ], required: true },
      { key: "granted", kind: "select", options: YES_NO, required: true },
      { key: "notes", kind: "textarea" },
    ],
  }),
  svc("patient-preferences-service", 8103, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "key", label: "Preference", required: true },
      { key: "value" },
    ],
  }),
  svc("patient-portal-api", 8104, "node", "PATIENTS", { hasCrud: false }),
  svc("patient-relationships-service", 8105, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "related_to", required: true },
      { key: "relationship", kind: "select", options: RELATIONSHIP, required: true },
    ],
  }),
  svc("patient-timeline-service", 8106, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "event_type", required: true },
      { key: "description", kind: "textarea" },
    ],
  }),
  svc("patient-search-service", 8107, "python", "PATIENTS", {
    createFields: [{ key: "query", required: true, placeholder: "name or MRN…" }],
  }),
  svc("patient-merge-service", 8108, "python", "PATIENTS", {
    createFields: [
      { key: "source_patient_id", label: "Merge from", required: true },
      { key: "target_patient_id", label: "Merge into", required: true },
      { key: "reason", kind: "textarea" },
    ],
  }),
  svc("patient-communications-service", 8109, "python", "PATIENTS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "channel", kind: "select", options: CHANNEL, required: true },
      { key: "message", kind: "textarea", required: true },
    ],
  }),

  // PROVIDERS
  svc("providers-service", 8200, "python", "PROVIDERS", {
    createFields: [
      { key: "first_name", required: true },
      { key: "last_name", required: true },
      { key: "npi", label: "NPI" },
      { key: "employee_id" },
      { key: "specialty" },
    ],
  }),
  svc("credentialing-service", 8201, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "credential_type", kind: "select", options: [
        { value: "board_cert", label: "Board Certification" },
        { value: "hospital_privilege", label: "Hospital Privilege" },
        { value: "malpractice", label: "Malpractice Insurance" },
      ] },
      { key: "granted_at", kind: "date" },
      { key: "expires_at", kind: "date" },
    ],
  }),
  svc("licensing-service", 8202, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "license_number", required: true },
      { key: "state", label: "State (2-letter)", required: true },
      { key: "expires_at", kind: "date" },
    ],
  }),
  svc("specialties-service", 8203, "python", "PROVIDERS", {
    createFields: [{ key: "name", required: true }, { key: "description" }],
  }),
  svc("provider-schedule-service", 8204, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "day_of_week", kind: "select", options: DAY_OF_WEEK, required: true },
      { key: "start_time", placeholder: "09:00" },
      { key: "end_time", placeholder: "17:00" },
    ],
  }),
  svc("on-call-service", 8205, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "starts_at", kind: "datetime", required: true },
      { key: "ends_at", kind: "datetime", required: true },
    ],
  }),
  svc("provider-directory", 8206, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "location" },
      { key: "phone" },
    ],
  }),
  svc("provider-portal-api", 8207, "node", "PROVIDERS", { hasCrud: false }),
  svc("provider-performance-service", 8208, "python", "PROVIDERS", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "metric" }, { key: "value", kind: "number" },
    ],
  }),

  // CLINICAL / EHR
  svc("ehr-service", 8300, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "record_type" },
      { key: "content", kind: "textarea" },
    ],
  }),
  svc("encounters-service", 8301, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id", required: true },
      { key: "encounter_type", kind: "select", options: [
        { value: "visit", label: "Office visit" }, { value: "telemed", label: "Telemedicine" },
        { value: "inpatient", label: "Inpatient" }, { value: "er", label: "ER" },
      ] },
      { key: "reason" }, { key: "location" },
    ],
  }),
  svc("clinical-notes-service", 8302, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "encounter_id", required: true },
      { key: "author_id", label: "Author (provider)", required: true },
      { key: "body", kind: "textarea", required: true },
    ],
  }),
  svc("problem-list-service", 8303, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "condition", required: true },
      { key: "icd10", label: "ICD-10 code" },
      { key: "onset_at", kind: "date" },
    ],
  }),
  svc("med-reconciliation-service", 8304, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "encounter_id" },
      { key: "notes", kind: "textarea" },
    ],
  }),
  svc("allergies-service", 8305, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "allergen", required: true },
      { key: "reaction" },
      { key: "severity", kind: "select", options: SEVERITY },
    ],
  }),
  svc("immunizations-service", 8306, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "vaccine", required: true },
      { key: "administered_at", kind: "date" },
      { key: "lot_number" },
    ],
  }),
  svc("vitals-service", 8307, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "encounter_id" },
      { key: "heart_rate", label: "Heart rate (bpm)", kind: "number" },
      { key: "bp", label: "BP (systolic/diastolic)", placeholder: "120/80" },
      { key: "temperature", label: "Temp (°F)", kind: "number" },
      { key: "spo2", label: "SpO₂ (%)", kind: "number" },
    ],
  }),
  svc("cpoe-service", 8308, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id", required: true },
      { key: "order_type", kind: "select", options: [
        { value: "med", label: "Medication" }, { value: "lab", label: "Lab" },
        { value: "imaging", label: "Imaging" }, { value: "procedure", label: "Procedure" },
      ], required: true },
      { key: "details", kind: "textarea" },
    ],
  }),
  svc("care-plan-service", 8309, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id" },
      { key: "goals", kind: "textarea" },
    ],
  }),
  svc("referrals-service", 8310, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "referring_provider_id", required: true },
      { key: "referred_to_provider_id", required: true },
      { key: "reason" },
    ],
  }),
  svc("discharge-summary-service", 8311, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "encounter_id", required: true },
      { key: "patient_id", required: true },
      { key: "summary", kind: "textarea", required: true },
    ],
  }),
  svc("clinical-decision-support", 8312, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "alert_type" }, { key: "recommendation", kind: "textarea" },
    ],
  }),
  svc("diagnosis-codes-service", 8313, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "code", label: "ICD-10 code", required: true },
      { key: "description" },
    ],
  }),
  svc("care-teams-service", 8314, "python", "CLINICAL/EHR", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id", required: true },
      { key: "role" },
    ],
  }),

  // DIAGNOSTICS
  svc("lab-orders-service", 8400, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "ordered_by", label: "Ordered by (provider)", required: true },
      { key: "test_code", kind: "select", options: [
        { value: "CBC", label: "CBC — Complete Blood Count" },
        { value: "CMP", label: "CMP — Comprehensive Metabolic Panel" },
        { value: "LIPID", label: "Lipid panel" },
        { value: "HbA1c", label: "HbA1c" },
        { value: "TSH", label: "TSH" },
        { value: "UA", label: "UA — Urinalysis" },
      ], required: true },
      { key: "priority", kind: "select", options: PRIORITY },
    ],
  }),
  svc("lab-results-service", 8401, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "lab_order_id", required: true },
      { key: "test_code" },
      { key: "result" },
    ],
  }),
  svc("imaging-orders-service", 8402, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "ordered_by", required: true },
      { key: "modality", kind: "select", options: IMAGING_MODALITY, required: true },
      { key: "body_part" },
      { key: "priority", kind: "select", options: PRIORITY },
    ],
  }),
  svc("imaging-results-service", 8403, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "imaging_order_id", required: true },
      { key: "findings", kind: "textarea" },
    ],
  }),
  svc("pathology-service", 8404, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "specimen_id" },
      { key: "findings", kind: "textarea" },
    ],
  }),
  svc("radiology-worklist", 8405, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "modality", kind: "select", options: IMAGING_MODALITY },
      { key: "priority", kind: "select", options: PRIORITY },
    ],
  }),
  svc("specimen-tracking-service", 8406, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "specimen_type" },
      { key: "collected_at", kind: "datetime" },
    ],
  }),
  svc("reference-ranges-service", 8407, "python", "DIAGNOSTICS", {
    createFields: [
      { key: "test_code", required: true },
      { key: "low", kind: "number" }, { key: "high", kind: "number" },
      { key: "unit" },
    ],
  }),

  // PHARMACY
  svc("pharmacy-service", 8500, "python", "PHARMACY", {
    createFields: [
      { key: "prescription_id", required: true },
      { key: "filled_at", kind: "datetime" },
    ],
  }),
  svc("prescriptions-service", 8501, "python", "PHARMACY", {
    createFields: [
      { key: "patient_id", label: "Patient", required: true },
      { key: "provider_id", label: "Prescribing doctor", required: true },
      { key: "drug", label: "Drug name", required: true },
      { key: "dose", placeholder: "10mg" },
      { key: "sig", label: "Instructions for use", placeholder: "1 tab daily", required: true },
    ],
    actions: [{ label: "Refill", method: "POST", path: "/refill" }],
  }),
  svc("refills-service", 8502, "python", "PHARMACY", {
    createFields: [
      { key: "prescription_id", required: true },
      { key: "requested_at", kind: "datetime" },
    ],
  }),
  svc("drug-interactions-service", 8503, "python", "PHARMACY", {
    createFields: [
      { key: "drug_a", label: "Drug A", required: true },
      { key: "drug_b", label: "Drug B", required: true },
      { key: "severity", kind: "select", options: SEVERITY },
    ],
  }),
  svc("formulary-service", 8504, "python", "PHARMACY", {
    createFields: [
      { key: "drug", required: true },
      { key: "tier", kind: "select", options: [
        { value: "1", label: "Tier 1 (generic)" }, { value: "2", label: "Tier 2" },
        { value: "3", label: "Tier 3" }, { value: "4", label: "Tier 4 (specialty)" },
      ] },
    ],
  }),
  svc("pharmacy-inventory-service", 8505, "python", "PHARMACY", {
    createFields: [
      { key: "drug", required: true },
      { key: "quantity", kind: "number", required: true },
      { key: "lot_number" },
    ],
  }),
  svc("dispensing-service", 8506, "python", "PHARMACY", {
    createFields: [
      { key: "prescription_id", required: true },
      { key: "dispensed_at", kind: "datetime" },
      { key: "dispensed_by" },
    ],
  }),

  // SCHEDULING
  svc("appointments-service", 8600, "python", "SCHEDULING", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id", required: true },
      { key: "starts_at", kind: "datetime", required: true },
      { key: "duration_min", label: "Duration (min)", kind: "number", placeholder: "30" },
      { key: "reason" },
    ],
    actions: [
      { label: "Cancel", method: "POST", path: "/cancel" },
      { label: "Check-in", method: "POST", path: "/check-in" },
    ],
  }),
  svc("appointment-slots-service", 8601, "python", "SCHEDULING", {
    createFields: [
      { key: "provider_id", required: true },
      { key: "starts_at", kind: "datetime", required: true },
      { key: "ends_at", kind: "datetime", required: true },
    ],
  }),
  svc("reminders-service", 8602, "python", "SCHEDULING", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "appointment_id" },
      { key: "channel", kind: "select", options: CHANNEL },
    ],
  }),
  svc("waitlist-service", 8603, "python", "SCHEDULING", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "appointment_id" },
    ],
  }),
  svc("room-booking-service", 8604, "python", "SCHEDULING", {
    createFields: [
      { key: "facility_id" },
      { key: "room_name", required: true },
      { key: "starts_at", kind: "datetime", required: true },
      { key: "ends_at", kind: "datetime", required: true },
    ],
  }),

  // BILLING / RCM
  svc("billing-service", 8700, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "amount", kind: "number", required: true },
      { key: "description" },
    ],
  }),
  svc("charge-capture-service", 8701, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "encounter_id" },
      { key: "cpt_code", label: "CPT code" },
      { key: "amount", kind: "number" },
    ],
  }),
  svc("coding-service", 8702, "python", "BILLING/RCM", {
    createFields: [
      { key: "encounter_id", required: true },
      { key: "icd10", label: "ICD-10" }, { key: "cpt", label: "CPT" },
    ],
  }),
  svc("claims-submission-service", 8703, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "encounter_id" },
      { key: "payer_id", label: "Payer" },
      { key: "amount", kind: "number" },
    ],
  }),
  svc("claims-adjudication-service", 8704, "python", "BILLING/RCM", {
    createFields: [
      { key: "claim_id", required: true },
      { key: "decision", kind: "select", options: [
        { value: "approved", label: "Approved" }, { value: "denied", label: "Denied" },
        { value: "partial", label: "Partial" },
      ] },
    ],
  }),
  svc("denials-service", 8705, "python", "BILLING/RCM", {
    createFields: [
      { key: "claim_id", required: true },
      { key: "reason" }, { key: "reason_code" },
    ],
  }),
  svc("invoicing-service", 8706, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "amount", kind: "number", required: true },
      { key: "description" },
      { key: "status", kind: "select", options: INVOICE_STATUS },
    ],
  }),
  svc("payments-service", 8707, "python", "BILLING/RCM", {
    createFields: [
      { key: "invoice_id", required: true },
      { key: "amount", kind: "number", required: true },
      { key: "method", kind: "select", options: PAYMENT_METHOD },
    ],
  }),
  svc("statements-service", 8708, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "invoice_id" },
    ],
  }),
  svc("collections-service", 8709, "python", "BILLING/RCM", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "amount", kind: "number", required: true },
    ],
  }),

  // INSURANCE
  svc("eligibility-service", 8800, "python", "INSURANCE", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "payer_id", label: "Payer" },
    ],
    actions: [{ label: "Check", method: "GET", path: "/check" }],
  }),
  svc("prior-auth-service", 8801, "python", "INSURANCE", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "provider_id" },
      { key: "service_code" },
    ],
  }),
  svc("coverage-verification-service", 8802, "python", "INSURANCE", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "payer_id", label: "Payer" },
    ],
  }),
  svc("payer-directory", 8803, "python", "INSURANCE", {
    createFields: [
      { key: "name", required: true },
      { key: "phone" }, { key: "address" },
    ],
  }),
  svc("payer-edi-connect", 8804, "python", "INSURANCE", {
    createFields: [
      { key: "payer_id", label: "Payer", required: true },
      { key: "endpoint" },
    ],
  }),
  svc("claims-status-service", 8805, "python", "INSURANCE", {
    createFields: [{ key: "claim_id", required: true }],
  }),

  // DEVICES / IOT
  svc("device-registry-service", 8900, "python", "DEVICES/IOT", {
    createFields: [
      { key: "patient_id" },
      { key: "device_type" },
      { key: "serial_number" },
    ],
  }),
  svc("device-telemetry-service", 8901, "go", "DEVICES/IOT", { hasCrud: false }),
  svc("device-alerts-service", 8902, "python", "DEVICES/IOT", {
    createFields: [
      { key: "device_id", required: true },
      { key: "alert_type" },
      { key: "severity", kind: "select", options: SEVERITY },
    ],
  }),
  svc("device-fleet-service", 8903, "python", "DEVICES/IOT", {
    createFields: [
      { key: "device_id" }, { key: "fleet_name" },
    ],
  }),
  svc("remote-monitoring-service", 8904, "python", "DEVICES/IOT", {
    createFields: [
      { key: "patient_id", required: true },
      { key: "device_id" },
    ],
  }),

  // COMMUNICATIONS
  svc("notifications-service", 9000, "python", "COMMUNICATIONS", {
    createFields: [
      { key: "patient_id" },
      { key: "channel", kind: "select", options: CHANNEL },
      { key: "subject" },
      { key: "body", kind: "textarea" },
    ],
    bulkActions: [{ label: "Send", method: "POST", path: "/send" }],
  }),
  svc("sms-gateway-service", 9001, "go", "COMMUNICATIONS", { hasCrud: false }),
  svc("email-gateway-service", 9002, "python", "COMMUNICATIONS", {
    createFields: [
      { key: "to", required: true },
      { key: "subject" },
      { key: "body", kind: "textarea" },
    ],
  }),
  svc("push-gateway-service", 9003, "python", "COMMUNICATIONS", {
    createFields: [
      { key: "to", required: true },
      { key: "body", kind: "textarea" },
    ],
  }),
  svc("secure-messaging-service", 9004, "node", "COMMUNICATIONS", { hasCrud: false }),

  // AI / ANALYTICS
  svc("ai-agents-service", 9100, "python", "AI/ANALYTICS", {
    createFields: [
      { key: "name", required: true },
      { key: "model", kind: "select", options: [
        { value: "claude-opus", label: "Claude Opus" },
        { value: "claude-sonnet", label: "Claude Sonnet" },
        { value: "gpt-4", label: "GPT-4" },
      ] },
      { key: "description", kind: "textarea" },
    ],
  }),
  svc("ai-invocations-service", 9101, "python", "AI/ANALYTICS", {
    createFields: [
      { key: "agent_id" },
      { key: "patient_id" },
      { key: "input", kind: "textarea" },
    ],
  }),
  svc("analytics-events-service", 9102, "python", "AI/ANALYTICS", {
    createFields: [
      { key: "event_type", required: true },
      { key: "entity_id" },
      { key: "properties", kind: "textarea", placeholder: '{"key":"value"}' },
    ],
  }),
  svc("reporting-service", 9103, "python", "AI/ANALYTICS", {
    createFields: [
      { key: "report_type", required: true },
      { key: "parameters", kind: "textarea" },
    ],
  }),
  svc("ml-models-service", 9104, "python", "AI/ANALYTICS", {
    createFields: [
      { key: "name", required: true },
      { key: "version" },
    ],
  }),

  // FACILITY / OPS
  svc("facilities-service", 9200, "python", "FACILITY/OPS", {
    createFields: [
      { key: "name", required: true },
      { key: "address" }, { key: "phone" },
    ],
  }),
  svc("wards-beds-service", 9201, "python", "FACILITY/OPS", {
    createFields: [
      { key: "facility_id", required: true },
      { key: "ward_name", required: true },
      { key: "bed_count", kind: "number" },
    ],
  }),
  svc("equipment-service", 9202, "python", "FACILITY/OPS", {
    createFields: [
      { key: "name", required: true },
      { key: "sku", label: "SKU" },
      { key: "facility_id" },
    ],
  }),
  svc("sterile-supply-service", 9203, "python", "FACILITY/OPS", {
    createFields: [
      { key: "item", required: true },
      { key: "vendor_id" },
      { key: "quantity", kind: "number" },
    ],
  }),
  svc("maintenance-service", 9204, "python", "FACILITY/OPS", {
    createFields: [
      { key: "equipment_id", required: true },
      { key: "scheduled_at", kind: "date" },
      { key: "description" },
    ],
  }),

  // INTEGRATION
  svc("erp-bridge-service", 9300, "python", "INTEGRATION", {
    createFields: [
      { key: "event_type" }, { key: "payload", kind: "textarea" },
    ],
  }),
];

export const DOMAIN_ORDER: Domain[] = [
  "PLATFORM",
  "PATIENTS",
  "PROVIDERS",
  "CLINICAL/EHR",
  "DIAGNOSTICS",
  "PHARMACY",
  "SCHEDULING",
  "BILLING/RCM",
  "INSURANCE",
  "DEVICES/IOT",
  "COMMUNICATIONS",
  "AI/ANALYTICS",
  "FACILITY/OPS",
  "INTEGRATION",
];

export const servicesByDomain = (): Record<Domain, ServiceDef[]> => {
  const out = {} as Record<Domain, ServiceDef[]>;
  for (const d of DOMAIN_ORDER) out[d] = [];
  for (const s of SERVICES) out[s.domain].push(s);
  return out;
};

export const serviceByName = (name: string): ServiceDef | undefined =>
  SERVICES.find((s) => s.name === name);
