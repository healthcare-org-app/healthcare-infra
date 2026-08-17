import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  DOMAIN_ORDER,
  SERVICES,
  serviceByName,
  servicesByDomain,
  isServiceEnabled,
  ENABLED_STACKS,
  type Domain,
} from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { api } from "@/api";
import { KpiTile } from "@/components/KpiTile";
import {
  Users,
  Stethoscope,
  CalendarDays,
  Pill,
  FlaskConical,
  Receipt,
  ArrowRight,
  Activity,
  ClipboardList,
} from "lucide-react";

interface KpiSpec {
  serviceName: string; // service this KPI reflects — used to check if it's enabled
  label: string;
  hint: string;
  Icon: typeof Users;
  tint: { bg: string; text: string; ring: string };
}

const ALL_KPIS: KpiSpec[] = [
  {
    serviceName: "patients-service",
    label: "Patients",
    hint: "Active records",
    Icon: Users,
    tint: { bg: "bg-brand-100", text: "text-brand-700", ring: "ring-brand-200" },
  },
  {
    serviceName: "providers-service",
    label: "Providers",
    hint: "On staff",
    Icon: Stethoscope,
    tint: { bg: "bg-sea-100", text: "text-sea-700", ring: "ring-sea-200" },
  },
  {
    serviceName: "appointments-service",
    label: "Appointments",
    hint: "In queue",
    Icon: CalendarDays,
    tint: { bg: "bg-indigo-100", text: "text-indigo-700", ring: "ring-indigo-200" },
  },
  {
    serviceName: "encounters-service",
    label: "Encounters",
    hint: "All time",
    Icon: ClipboardList,
    tint: { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200" },
  },
  {
    serviceName: "prescriptions-service",
    label: "Prescriptions",
    hint: "Total issued",
    Icon: Pill,
    tint: { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200" },
  },
  {
    serviceName: "lab-results-service",
    label: "Lab results",
    hint: "In record",
    Icon: FlaskConical,
    tint: { bg: "bg-purple-100", text: "text-purple-700", ring: "ring-purple-200" },
  },
  {
    serviceName: "invoicing-service",
    label: "Invoices",
    hint: "Outstanding",
    Icon: Receipt,
    tint: { bg: "bg-warn-100", text: "text-warn-700", ring: "ring-warn-200" },
  },
  {
    serviceName: "audit-log-service",
    label: "Audit events",
    hint: "Total",
    Icon: Activity,
    tint: { bg: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200" },
  },
];

// Only show KPIs whose backing service is in an enabled stack — anything else
// would just 500 through the Vite proxy.
const KPIS = ALL_KPIS.filter((k) => {
  const svc = serviceByName(k.serviceName);
  return svc ? isServiceEnabled(svc) : false;
});

export function Dashboard() {
  const grouped = servicesByDomain();

  const queries = useQueries({
    queries: KPIS.map((k) => ({
      queryKey: ["kpi", k.serviceName],
      queryFn: () => {
        const s = serviceByName(k.serviceName)!;
        return api.list(s.prefix, { limit: "1" });
      },
      retry: 0,
      staleTime: 30_000,
    })),
  });

  const recentPatients = useQueries({
    queries: [
      {
        queryKey: ["recent", "patients"],
        queryFn: () => api.list("/api/patients", { limit: "6" }),
        retry: 0,
      },
    ],
  })[0];

  return (
    <div className="px-8 py-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
            Overview
          </div>
          <h1 className="text-2xl font-semibold text-ink-900 mt-0.5">
            Good afternoon, TK
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {SERVICES.length} services · {DOMAIN_ORDER.length} domains. Live from
            the healthcare-org platform.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <Link to="/service/patients-service" className="btn btn-secondary">
            <Users className="w-4 h-4" />
            Browse patients
          </Link>
          <Link to="/service/appointments-service" className="btn btn-primary">
            <CalendarDays className="w-4 h-4" />
            Today's schedule
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {KPIS.map((k, i) => {
          const r = queries[i];
          const value = r.data?.count;
          return (
            <KpiTile
              key={k.serviceName}
              label={k.label}
              hint={k.hint}
              Icon={k.Icon}
              tint={k.tint}
              value={value !== undefined ? value.toLocaleString() : ""}
              loading={r.isPending}
              error={r.isError ? String(r.error?.message ?? "") : undefined}
            />
          );
        })}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        {/* Recent patients */}
        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
                Recent patients
              </div>
              <div className="text-sm text-ink-700 mt-0.5">
                Latest records added to the platform
              </div>
            </div>
            <Link
              to="/service/patients-service"
              className="text-sm text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentPatients.isPending && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="skeleton w-9 h-9 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <div className="skeleton h-3 w-32" />
                    <div className="skeleton h-2.5 w-48" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {recentPatients.isError && (
            <div className="text-sm text-danger-700">
              Couldn't load: {recentPatients.error?.message}
            </div>
          )}

          {recentPatients.data && (
            <ul className="divide-y divide-ink-100 -mx-2">
              {recentPatients.data.items.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/service/patients-service/${p.id}`}
                    className="flex items-center gap-3 px-2 py-2.5 rounded hover:bg-ink-50"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center">
                      {initials(String(p.first_name), String(p.last_name))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink-900 truncate">
                        {String(p.first_name ?? "")} {String(p.last_name ?? "")}
                      </div>
                      <div className="text-xs text-ink-500 font-mono">
                        {p.mrn ? `MRN ${p.mrn}` : `#${p.id}`}
                        {p.dob ? ` · DOB ${p.dob} · age ${ageFrom(String(p.dob))}` : ""}
                      </div>
                    </div>
                    <span
                      className={`chip ${
                        p.status === "active" ? "chip-ok" : "chip-err"
                      }`}
                    >
                      {String(p.status ?? "unknown")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Right column: quick launcher */}
        <section className="card p-5">
          <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-4">
            Quick actions
          </div>
          <ul className="space-y-1">
            {[
              { to: "/service/patients-service", label: "New patient", Icon: Users },
              {
                to: "/service/appointments-service",
                label: "Schedule appointment",
                Icon: CalendarDays,
              },
              {
                to: "/service/prescriptions-service",
                label: "Write prescription",
                Icon: Pill,
              },
              {
                to: "/service/lab-orders-service",
                label: "Order lab",
                Icon: FlaskConical,
              },
              {
                to: "/service/encounters-service",
                label: "Start encounter",
                Icon: ClipboardList,
              },
            ].map(({ to, label, Icon }) => (
              <li key={label}>
                <Link
                  to={to}
                  className="flex items-center gap-3 px-2 py-2 rounded hover:bg-ink-50 text-sm text-ink-700"
                >
                  <span className="w-8 h-8 rounded bg-brand-50 text-brand-700 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1">{label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-ink-400" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Enabled stacks banner */}
      <section className="mt-8 card p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
          <Activity className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-900">
            Enabled stacks: {ENABLED_STACKS.map((s) => (
              <span key={s} className="chip chip-brand ml-1">{s}</span>
            ))}
          </div>
          <div className="text-xs text-ink-500 mt-1">
            KPIs and cross-service views only query services in these stacks.
            To unlock <span className="font-medium text-ink-700">clinical</span> /{" "}
            <span className="font-medium text-ink-700">billing</span> /{" "}
            <span className="font-medium text-ink-700">insurance</span> /{" "}
            <span className="font-medium text-ink-700">devices</span> /{" "}
            <span className="font-medium text-ink-700">comms</span>, run{" "}
            <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
              ./run.sh clinical billing
            </code>{" "}
            from{" "}
            <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
              infra/
            </code>
            , then update{" "}
            <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
              ENABLED_STACKS
            </code>{" "}
            in{" "}
            <code className="font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]">
              src/services.ts
            </code>
            .
          </div>
        </div>
      </section>

      {/* Domain grid */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
            Explore by domain
          </div>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {DOMAIN_ORDER.map((d) => (
            <DomainCard key={d} domain={d} count={grouped[d].length} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function DomainCard({ domain, count }: { domain: Domain; count: number }) {
  const Icon = DOMAIN_ICON[domain];
  const tint = DOMAIN_TINT[domain];
  return (
    <li>
      <Link
        to={`/domain/${encodeURIComponent(domain)}`}
        className="card card-hover p-4 flex items-start gap-3"
      >
        <div
          className={`w-9 h-9 rounded flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`}
        >
          <Icon className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-900 truncate">{domain}</div>
          <div className="text-xs text-ink-500 mt-0.5">{count} services</div>
        </div>
        <ArrowRight className="w-4 h-4 text-ink-300" />
      </Link>
    </li>
  );
}

function initials(first?: string, last?: string): string {
  return `${(first ?? "?").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}

function ageFrom(dob: string): number | string {
  const t = Date.parse(dob);
  if (isNaN(t)) return "?";
  const d = new Date(t);
  const now = new Date(2026, 7, 11); // stable "today" for dev
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
