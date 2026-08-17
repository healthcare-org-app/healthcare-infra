import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { DOMAIN_ORDER, SERVICES, serviceByName, servicesByDomain, isServiceEnabled, ENABLED_STACKS, } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { api } from "@/api";
import { KpiTile } from "@/components/KpiTile";
import { Users, Stethoscope, CalendarDays, Pill, FlaskConical, Receipt, ArrowRight, Activity, ClipboardList, } from "lucide-react";
const ALL_KPIS = [
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
                const s = serviceByName(k.serviceName);
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
    return (_jsxs("div", { className: "px-8 py-8 max-w-[1400px] mx-auto", children: [_jsxs("div", { className: "flex items-end justify-between mb-6", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: "Overview" }), _jsx("h1", { className: "text-2xl font-semibold text-ink-900 mt-0.5", children: "Good afternoon, TK" }), _jsxs("p", { className: "text-sm text-ink-500 mt-1", children: [SERVICES.length, " services \u00B7 ", DOMAIN_ORDER.length, " domains. Live from the healthcare-org platform."] })] }), _jsxs("div", { className: "hidden md:flex items-center gap-2", children: [_jsxs(Link, { to: "/service/patients-service", className: "btn btn-secondary", children: [_jsx(Users, { className: "w-4 h-4" }), "Browse patients"] }), _jsxs(Link, { to: "/service/appointments-service", className: "btn btn-primary", children: [_jsx(CalendarDays, { className: "w-4 h-4" }), "Today's schedule"] })] })] }), _jsx("section", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: KPIS.map((k, i) => {
                    const r = queries[i];
                    const value = r.data?.count;
                    return (_jsx(KpiTile, { label: k.label, hint: k.hint, Icon: k.Icon, tint: k.tint, value: value !== undefined ? value.toLocaleString() : "", loading: r.isPending, error: r.isError ? String(r.error?.message ?? "") : undefined }, k.serviceName));
                }) }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8", children: [_jsxs("section", { className: "card p-5 lg:col-span-2", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: "Recent patients" }), _jsx("div", { className: "text-sm text-ink-700 mt-0.5", children: "Latest records added to the platform" })] }), _jsxs(Link, { to: "/service/patients-service", className: "text-sm text-brand-700 hover:text-brand-800 inline-flex items-center gap-1", children: ["View all ", _jsx(ArrowRight, { className: "w-3.5 h-3.5" })] })] }), recentPatients.isPending && (_jsx("div", { className: "space-y-2", children: [0, 1, 2, 3].map((i) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "skeleton w-9 h-9 rounded-full" }), _jsxs("div", { className: "flex-1 space-y-1", children: [_jsx("div", { className: "skeleton h-3 w-32" }), _jsx("div", { className: "skeleton h-2.5 w-48" })] })] }, i))) })), recentPatients.isError && (_jsxs("div", { className: "text-sm text-danger-700", children: ["Couldn't load: ", recentPatients.error?.message] })), recentPatients.data && (_jsx("ul", { className: "divide-y divide-ink-100 -mx-2", children: recentPatients.data.items.map((p) => (_jsx("li", { children: _jsxs(Link, { to: `/service/patients-service/${p.id}`, className: "flex items-center gap-3 px-2 py-2.5 rounded hover:bg-ink-50", children: [_jsx("div", { className: "w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center", children: initials(String(p.first_name), String(p.last_name)) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "text-sm font-medium text-ink-900 truncate", children: [String(p.first_name ?? ""), " ", String(p.last_name ?? "")] }), _jsxs("div", { className: "text-xs text-ink-500 font-mono", children: [p.mrn ? `MRN ${p.mrn}` : `#${p.id}`, p.dob ? ` · DOB ${p.dob} · age ${ageFrom(String(p.dob))}` : ""] })] }), _jsx("span", { className: `chip ${p.status === "active" ? "chip-ok" : "chip-err"}`, children: String(p.status ?? "unknown") })] }) }, p.id))) }))] }), _jsxs("section", { className: "card p-5", children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider mb-4", children: "Quick actions" }), _jsx("ul", { className: "space-y-1", children: [
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
                                ].map(({ to, label, Icon }) => (_jsx("li", { children: _jsxs(Link, { to: to, className: "flex items-center gap-3 px-2 py-2 rounded hover:bg-ink-50 text-sm text-ink-700", children: [_jsx("span", { className: "w-8 h-8 rounded bg-brand-50 text-brand-700 flex items-center justify-center", children: _jsx(Icon, { className: "w-4 h-4" }) }), _jsx("span", { className: "flex-1", children: label }), _jsx(ArrowRight, { className: "w-3.5 h-3.5 text-ink-400" })] }) }, label))) })] })] }), _jsxs("section", { className: "mt-8 card p-4 flex items-start gap-3", children: [_jsx("div", { className: "w-8 h-8 rounded bg-brand-50 text-brand-700 flex items-center justify-center shrink-0", children: _jsx(Activity, { className: "w-4 h-4" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "text-sm font-semibold text-ink-900", children: ["Enabled stacks: ", ENABLED_STACKS.map((s) => (_jsx("span", { className: "chip chip-brand ml-1", children: s }, s)))] }), _jsxs("div", { className: "text-xs text-ink-500 mt-1", children: ["KPIs and cross-service views only query services in these stacks. To unlock ", _jsx("span", { className: "font-medium text-ink-700", children: "clinical" }), " /", " ", _jsx("span", { className: "font-medium text-ink-700", children: "billing" }), " /", " ", _jsx("span", { className: "font-medium text-ink-700", children: "insurance" }), " /", " ", _jsx("span", { className: "font-medium text-ink-700", children: "devices" }), " /", " ", _jsx("span", { className: "font-medium text-ink-700", children: "comms" }), ", run", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "./run.sh clinical billing" }), " ", "from", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "infra/" }), ", then update", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "ENABLED_STACKS" }), " ", "in", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "src/services.ts" }), "."] })] })] }), _jsxs("section", { className: "mt-10", children: [_jsx("div", { className: "flex items-center justify-between mb-3", children: _jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: "Explore by domain" }) }), _jsx("ul", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3", children: DOMAIN_ORDER.map((d) => (_jsx(DomainCard, { domain: d, count: grouped[d].length }, d))) })] })] }));
}
function DomainCard({ domain, count }) {
    const Icon = DOMAIN_ICON[domain];
    const tint = DOMAIN_TINT[domain];
    return (_jsx("li", { children: _jsxs(Link, { to: `/domain/${encodeURIComponent(domain)}`, className: "card card-hover p-4 flex items-start gap-3", children: [_jsx("div", { className: `w-9 h-9 rounded flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`, children: _jsx(Icon, { className: "w-4.5 h-4.5" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-sm font-semibold text-ink-900 truncate", children: domain }), _jsxs("div", { className: "text-xs text-ink-500 mt-0.5", children: [count, " services"] })] }), _jsx(ArrowRight, { className: "w-4 h-4 text-ink-300" })] }) }));
}
function initials(first, last) {
    return `${(first ?? "?").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}
function ageFrom(dob) {
    const t = Date.parse(dob);
    if (isNaN(t))
        return "?";
    const d = new Date(t);
    const now = new Date(2026, 7, 11); // stable "today" for dev
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate()))
        a--;
    return a;
}
