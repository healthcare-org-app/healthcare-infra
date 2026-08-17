import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/api";
import { serviceByName, isServiceEnabled } from "@/services";
import { ArrowLeft, Phone, Mail, Cake, IdCard, Heart, User, ClipboardList, CalendarDays, Pill, FlaskConical, Image as ImageIcon, Receipt, ArrowRight, Circle, } from "lucide-react";
const ALL_RELATED = [
    { key: "encounters", label: "Encounters", Icon: ClipboardList, serviceRoute: "encounters-service", tint: { bg: "bg-brand-50", text: "text-brand-700" } },
    { key: "appointments", label: "Appointments", Icon: CalendarDays, serviceRoute: "appointments-service", tint: { bg: "bg-sea-50", text: "text-sea-700" } },
    { key: "prescriptions", label: "Prescriptions", Icon: Pill, serviceRoute: "prescriptions-service", tint: { bg: "bg-emerald-50", text: "text-emerald-700" } },
    { key: "lab_orders", label: "Lab orders", Icon: FlaskConical, serviceRoute: "lab-orders-service", tint: { bg: "bg-purple-50", text: "text-purple-700" } },
    { key: "lab_results", label: "Lab results", Icon: FlaskConical, serviceRoute: "lab-results-service", tint: { bg: "bg-purple-50", text: "text-purple-700" } },
    { key: "imaging_orders", label: "Imaging orders", Icon: ImageIcon, serviceRoute: "imaging-orders-service", tint: { bg: "bg-indigo-50", text: "text-indigo-700" } },
    { key: "imaging_results", label: "Imaging results", Icon: ImageIcon, serviceRoute: "imaging-results-service", tint: { bg: "bg-indigo-50", text: "text-indigo-700" } },
    { key: "invoicing", label: "Invoices", Icon: Receipt, serviceRoute: "invoicing-service", tint: { bg: "bg-warn-50", text: "text-warn-700" } },
];
// Only fan out to services that are in an enabled stack.
const RELATED = ALL_RELATED.filter((r) => {
    const s = serviceByName(r.serviceRoute);
    return s ? isServiceEnabled(s) : false;
});
export function PatientDetail({ patient }) {
    const queries = useQueries({
        queries: RELATED.map((r) => {
            const svc = serviceByName(r.serviceRoute);
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
    return (_jsxs("div", { className: "max-w-[1400px] mx-auto", children: [_jsx("div", { className: "bg-gradient-to-br from-brand-600 to-brand-800 text-white", children: _jsxs("div", { className: "px-8 pt-6 pb-8", children: [_jsxs(Link, { to: "/service/patients-service", className: "text-sm text-brand-100 hover:text-white inline-flex items-center gap-1", children: [_jsx(ArrowLeft, { className: "w-3.5 h-3.5" }), " All patients"] }), _jsxs("div", { className: "mt-4 flex items-center gap-5", children: [_jsx("div", { className: "w-20 h-20 rounded-full bg-white/15 ring-4 ring-white/20 flex items-center justify-center text-2xl font-semibold backdrop-blur-sm", children: initials(first, last) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h1", { className: "text-3xl font-semibold", children: fullName }), _jsxs("span", { className: `chip ${patient.status === "active"
                                                        ? "!bg-white/15 !text-white"
                                                        : "!bg-danger-500/20 !text-white"}`, children: [_jsx(Circle, { className: "w-1.5 h-1.5 fill-current" }), String(patient.status ?? "unknown")] })] }), _jsxs("div", { className: "flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-brand-100", children: [!!patient.mrn && (_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(IdCard, { className: "w-4 h-4" }), " MRN ", String(patient.mrn)] })), !!dob && (_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(Cake, { className: "w-4 h-4" }), " DOB ", dob, age !== undefined ? ` · ${age}y` : ""] })), !!patient.phone && (_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(Phone, { className: "w-4 h-4" }), " ", String(patient.phone)] })), !!patient.email && (_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(Mail, { className: "w-4 h-4" }), " ", String(patient.email)] })), !!patient.blood_type && (_jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(Heart, { className: "w-4 h-4" }), " Type ", String(patient.blood_type)] }))] })] })] })] }) }), _jsx("div", { className: "px-8 py-6", children: _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-6", children: [_jsxs("section", { className: "card p-5", children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider mb-3", children: "Demographics" }), _jsxs("dl", { className: "text-sm divide-y divide-ink-100", children: [_jsx(FieldRow, { label: "First name", value: patient.first_name }), _jsx(FieldRow, { label: "Last name", value: patient.last_name }), _jsx(FieldRow, { label: "Date of birth", value: patient.dob }), _jsx(FieldRow, { label: "MRN", value: patient.mrn, mono: true }), _jsx(FieldRow, { label: "Email", value: patient.email }), _jsx(FieldRow, { label: "Phone", value: patient.phone }), _jsx(FieldRow, { label: "Blood type", value: patient.blood_type }), _jsx(FieldRow, { label: "Identity sub", value: patient.identity_sub, mono: true })] }), _jsxs("div", { className: "mt-4 pt-4 border-t border-ink-100 text-xs text-ink-500", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { children: "Created" }), _jsx("span", { className: "font-mono", children: patient.created_at ? new Date(String(patient.created_at)).toLocaleString() : "—" })] }), _jsxs("div", { className: "flex items-center justify-between mt-1", children: [_jsx("span", { children: "Updated" }), _jsx("span", { className: "font-mono", children: patient.updated_at ? new Date(String(patient.updated_at)).toLocaleString() : "—" })] })] })] }), _jsxs("section", { className: "lg:col-span-2", children: [_jsx("div", { className: "flex items-center justify-between mb-3", children: _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: "Longitudinal record" }), _jsxs("div", { className: "text-sm text-ink-500 mt-0.5", children: ["Related records across the fleet, filtered by ", _jsxs("code", { className: "font-mono", children: ["patient_id=", patient.id] }), "."] })] }) }), RELATED.length === 0 && (_jsxs("div", { className: "card p-5 text-sm text-ink-600", children: ["No related services are in an enabled stack. Bring up", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "clinical" }), " ", "and", " ", _jsx("code", { className: "font-mono text-ink-800 bg-ink-100 px-1 py-0.5 rounded text-[11px]", children: "billing" }), " ", "to see encounters, prescriptions, results, and invoices for this patient."] })), _jsx("ul", { className: "grid grid-cols-1 md:grid-cols-2 gap-3", children: RELATED.map((r, i) => {
                                        const res = queries[i];
                                        const items = (res.data?.items ?? []);
                                        return (_jsx("li", { children: _jsxs("div", { className: "card p-4", children: [_jsxs("div", { className: "flex items-center gap-3 mb-3", children: [_jsx("div", { className: `w-8 h-8 rounded flex items-center justify-center ${r.tint.bg} ${r.tint.text}`, children: _jsx(r.Icon, { className: "w-4 h-4" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-sm font-semibold text-ink-900", children: r.label }), _jsx("div", { className: "text-[11px] text-ink-500", children: res.isPending
                                                                            ? "Loading…"
                                                                            : res.isError
                                                                                ? "unreachable"
                                                                                : `${items.length} record${items.length === 1 ? "" : "s"}` })] }), _jsxs(Link, { to: `/service/${r.serviceRoute}`, className: "text-[11px] text-ink-500 hover:text-brand-700 inline-flex items-center gap-1", children: ["Open ", _jsx(ArrowRight, { className: "w-3 h-3" })] })] }), res.isPending && (_jsx("div", { className: "space-y-1.5", children: [0, 1].map((i) => (_jsx("div", { className: "skeleton h-3 w-full" }, i))) })), res.isError && (_jsx("div", { className: "text-[11px] text-danger-700 bg-danger-50 border border-danger-100 rounded px-2 py-1.5", children: res.error?.message })), res.data && items.length === 0 && (_jsx("div", { className: "text-[11px] text-ink-500 italic", children: "No records" })), res.data && items.length > 0 && (_jsxs("ul", { className: "space-y-1", children: [items.slice(0, 4).map((it) => (_jsx("li", { children: _jsxs(Link, { to: `/service/${r.serviceRoute}/${it.id}`, className: "flex items-center gap-2 px-1 py-1 rounded hover:bg-ink-50 text-xs", children: [_jsxs("span", { className: "font-mono text-ink-500 shrink-0", children: ["#", it.id] }), _jsx("span", { className: "flex-1 text-ink-700 truncate", children: summarize(it) }), _jsx("span", { className: `chip ${it.status === "active"
                                                                                ? "chip-ok"
                                                                                : "chip-neutral"}`, children: String(it.status ?? "—") })] }) }, it.id))), items.length > 4 && (_jsxs("li", { className: "text-[11px] text-ink-500 pl-1", children: ["+ ", items.length - 4, " more"] }))] }))] }) }, r.key));
                                    }) })] })] }) })] }));
}
function FieldRow({ label, value, mono, }) {
    return (_jsxs("div", { className: "flex items-center py-2", children: [_jsx("dt", { className: "w-32 text-ink-500 text-[13px]", children: label }), _jsx("dd", { className: `text-ink-900 text-[13px] flex-1 ${mono ? "font-mono" : ""}`, children: value == null || value === "" ? (_jsx("span", { className: "text-ink-400", children: "\u2014" })) : (String(value)) })] }));
}
function initials(first, last) {
    const a = first.charAt(0);
    const b = last.charAt(0);
    return `${a || "?"}${b}`.toUpperCase();
}
function ageFrom(dob) {
    const t = Date.parse(dob);
    if (isNaN(t))
        return undefined;
    const d = new Date(t);
    const now = new Date(2026, 7, 11);
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate()))
        a--;
    return a;
}
function summarize(row) {
    const keys = Object.keys(row).filter((k) => !["id", "status", "created_at", "updated_at", "patient_id"].includes(k));
    const first = keys.slice(0, 2);
    const parts = first
        .map((k) => {
        const v = row[k];
        if (v == null)
            return null;
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}: ${s.length > 24 ? s.slice(0, 24) + "…" : s}`;
    })
        .filter(Boolean);
    return parts.length ? parts.join(" · ") : `Record #${row.id}`;
}
// Silence unused import warning
void User;
