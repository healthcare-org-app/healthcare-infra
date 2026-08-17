import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api, type Row } from "@/api";
import { serviceByName, isServiceEnabled } from "@/services";
import {
  ArrowLeft,
  Phone,
  Mail,
  Cake,
  IdCard,
  Heart,
  User,
  ClipboardList,
  CalendarDays,
  Pill,
  FlaskConical,
  Image as ImageIcon,
  Receipt,
  ArrowRight,
  Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Related {
  key: string;
  label: string;
  Icon: LucideIcon;
  serviceRoute: string; // service name in the registry
  tint: { bg: string; text: string };
}

const ALL_RELATED: Related[] = [
  { key: "encounters",       label: "Encounters",       Icon: ClipboardList, serviceRoute: "encounters-service",       tint: { bg: "bg-brand-50",    text: "text-brand-700" } },
  { key: "appointments",     label: "Appointments",     Icon: CalendarDays,  serviceRoute: "appointments-service",     tint: { bg: "bg-sea-50",      text: "text-sea-700" } },
  { key: "prescriptions",    label: "Prescriptions",    Icon: Pill,          serviceRoute: "prescriptions-service",    tint: { bg: "bg-emerald-50",  text: "text-emerald-700" } },
  { key: "lab_orders",       label: "Lab orders",       Icon: FlaskConical,  serviceRoute: "lab-orders-service",       tint: { bg: "bg-purple-50",   text: "text-purple-700" } },
  { key: "lab_results",      label: "Lab results",      Icon: FlaskConical,  serviceRoute: "lab-results-service",      tint: { bg: "bg-purple-50",   text: "text-purple-700" } },
  { key: "imaging_orders",   label: "Imaging orders",   Icon: ImageIcon,     serviceRoute: "imaging-orders-service",   tint: { bg: "bg-indigo-50",   text: "text-indigo-700" } },
  { key: "imaging_results",  label: "Imaging results",  Icon: ImageIcon,     serviceRoute: "imaging-results-service",  tint: { bg: "bg-indigo-50",   text: "text-indigo-700" } },
  { key: "invoicing",        label: "Invoices",         Icon: Receipt,       serviceRoute: "invoicing-service",        tint: { bg: "bg-warn-50",     text: "text-warn-700" } },
];

// Only fan out to services that are in an enabled stack.
const RELATED = ALL_RELATED.filter((r) => {
  const s = serviceByName(r.serviceRoute);
  return s ? isServiceEnabled(s) : false;
});

export function PatientDetail({ patient }: { patient: Row }) {
  const queries = useQueries({
    queries: RELATED.map((r) => {
      const svc = serviceByName(r.serviceRoute)!;
      return {
        queryKey: ["cross", r.key, patient.id],
        queryFn: () => api.list(svc.prefix, { patient_id: String(patient.id) }),
        retry: 0,
      };
    }),
  });

  const first = String(patient.first_name ?? "");
  const last = String(patient.last_name ?? "");
  const fullName = [first, last].filter(Boolean).join(" ") || `Patient #${patient.id}`;
  const dob = patient.dob ? String(patient.dob) : undefined;
  const age = dob ? ageFrom(dob) : undefined;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Hero */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 text-white">
        <div className="px-8 pt-6 pb-8">
          <Link
            to="/service/patients-service"
            className="text-sm text-brand-100 hover:text-white inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All patients
          </Link>
          <div className="mt-4 flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-white/15 ring-4 ring-white/20 flex items-center justify-center text-2xl font-semibold backdrop-blur-sm">
              {initials(first, last)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-semibold">{fullName}</h1>
                <span
                  className={`chip ${
                    patient.status === "active"
                      ? "!bg-white/15 !text-white"
                      : "!bg-danger-500/20 !text-white"
                  }`}
                >
                  <Circle className="w-1.5 h-1.5 fill-current" />
                  {String(patient.status ?? "unknown")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-brand-100">
                {!!patient.mrn && (
                  <span className="inline-flex items-center gap-1.5">
                    <IdCard className="w-4 h-4" /> MRN {String(patient.mrn)}
                  </span>
                )}
                {!!dob && (
                  <span className="inline-flex items-center gap-1.5">
                    <Cake className="w-4 h-4" /> DOB {dob}
                    {age !== undefined ? ` · ${age}y` : ""}
                  </span>
                )}
                {!!patient.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-4 h-4" /> {String(patient.phone)}
                  </span>
                )}
                {!!patient.email && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="w-4 h-4" /> {String(patient.email)}
                  </span>
                )}
                {!!patient.blood_type && (
                  <span className="inline-flex items-center gap-1.5">
                    <Heart className="w-4 h-4" /> Type {String(patient.blood_type)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: demographics + summary */}
          <section className="card p-5">
            <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-3">
              Demographics
            </div>
            <dl className="text-sm divide-y divide-ink-100">
              <FieldRow label="First name" value={patient.first_name as string | undefined} />
              <FieldRow label="Last name" value={patient.last_name as string | undefined} />
              <FieldRow label="Date of birth" value={patient.dob as string | undefined} />
              <FieldRow label="MRN" value={patient.mrn as string | undefined} mono />
              <FieldRow label="Email" value={patient.email as string | undefined} />
              <FieldRow label="Phone" value={patient.phone as string | undefined} />
              <FieldRow label="Blood type" value={patient.blood_type as string | undefined} />
              <FieldRow label="Identity sub" value={patient.identity_sub as string | undefined} mono />
            </dl>
            <div className="mt-4 pt-4 border-t border-ink-100 text-xs text-ink-500">
              <div className="flex items-center justify-between">
                <span>Created</span>
                <span className="font-mono">
                  {patient.created_at ? new Date(String(patient.created_at)).toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span>Updated</span>
                <span className="font-mono">
                  {patient.updated_at ? new Date(String(patient.updated_at)).toLocaleString() : "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Right column: cross-service snapshots */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
                  Longitudinal record
                </div>
                <div className="text-sm text-ink-500 mt-0.5">
                  Related records across the fleet, filtered by <code className="font-mono">patient_id={patient.id}</code>.
                </div>
              </div>
            </div>
            {RELATED.length === 0 && (
              <div className="card p-5 text-sm text-ink-600">
                No related services are in an enabled stack. Bring up{" "}
                <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
                  clinical
                </code>{" "}
                and{" "}
                <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
                  billing
                </code>{" "}
                to see encounters, prescriptions, results, and invoices for this patient.
              </div>
            )}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {RELATED.map((r, i) => {
                const res = queries[i];
                const items = (res.data?.items ?? []) as Row[];
                return (
                  <li key={r.key}>
                    <div className="card p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className={`w-8 h-8 rounded flex items-center justify-center ${r.tint.bg} ${r.tint.text}`}
                        >
                          <r.Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-ink-900">
                            {r.label}
                          </div>
                          <div className="text-[11px] text-ink-500">
                            {res.isPending
                              ? "Loading…"
                              : res.isError
                                ? "unreachable"
                                : `${items.length} record${items.length === 1 ? "" : "s"}`}
                          </div>
                        </div>
                        <Link
                          to={`/service/${r.serviceRoute}`}
                          className="text-[11px] text-ink-500 hover:text-brand-700 inline-flex items-center gap-1"
                        >
                          Open <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                      {res.isPending && (
                        <div className="space-y-1.5">
                          {[0, 1].map((i) => (
                            <div key={i} className="skeleton h-3 w-full" />
                          ))}
                        </div>
                      )}
                      {res.isError && (
                        <div className="text-[11px] text-danger-700 bg-danger-50 border border-danger-100 rounded px-2 py-1.5">
                          {res.error?.message}
                        </div>
                      )}
                      {res.data && items.length === 0 && (
                        <div className="text-[11px] text-ink-500 italic">
                          No records
                        </div>
                      )}
                      {res.data && items.length > 0 && (
                        <ul className="space-y-1">
                          {items.slice(0, 4).map((it) => (
                            <li key={it.id}>
                              <Link
                                to={`/service/${r.serviceRoute}/${it.id}`}
                                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-ink-50 text-xs"
                              >
                                <span className="font-mono text-ink-500 shrink-0">
                                  #{it.id}
                                </span>
                                <span className="flex-1 text-ink-700 truncate">
                                  {summarize(it)}
                                </span>
                                <span
                                  className={`chip ${
                                    it.status === "active"
                                      ? "chip-ok"
                                      : "chip-neutral"
                                  }`}
                                >
                                  {String(it.status ?? "—")}
                                </span>
                              </Link>
                            </li>
                          ))}
                          {items.length > 4 && (
                            <li className="text-[11px] text-ink-500 pl-1">
                              + {items.length - 4} more
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | undefined | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center py-2">
      <dt className="w-32 text-ink-500 text-[13px]">{label}</dt>
      <dd
        className={`text-ink-900 text-[13px] flex-1 ${mono ? "font-mono" : ""}`}
      >
        {value == null || value === "" ? (
          <span className="text-ink-400">—</span>
        ) : (
          String(value)
        )}
      </dd>
    </div>
  );
}

function initials(first: string, last: string): string {
  const a = first.charAt(0);
  const b = last.charAt(0);
  return `${a || "?"}${b}`.toUpperCase();
}

function ageFrom(dob: string): number | undefined {
  const t = Date.parse(dob);
  if (isNaN(t)) return undefined;
  const d = new Date(t);
  const now = new Date(2026, 7, 11);
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

function summarize(row: Row): string {
  const keys = Object.keys(row).filter(
    (k) => !["id", "status", "created_at", "updated_at", "patient_id"].includes(k),
  );
  const first = keys.slice(0, 2);
  const parts = first
    .map((k) => {
      const v = row[k];
      if (v == null) return null;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${s.length > 24 ? s.slice(0, 24) + "…" : s}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : `Record #${row.id}`;
}

// Silence unused import warning
void User;
