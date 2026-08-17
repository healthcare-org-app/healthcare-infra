import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ResourceDetail({ record }) {
    const meta = ["id", "status", "created_at", "updated_at"];
    const data = Object.entries(record).filter(([k]) => !meta.includes(k));
    return (_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("section", { children: [_jsx("h3", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2", children: "Metadata" }), _jsx("dl", { className: "text-sm divide-y divide-ink-100 border border-ink-200 rounded-md bg-white", children: meta.map((k) => (_jsxs("div", { className: "flex px-3 py-2", children: [_jsx("dt", { className: "w-32 text-ink-500", children: k }), _jsx("dd", { className: "text-ink-900 font-mono text-xs", children: formatVal(record[k]) })] }, k))) })] }), _jsxs("section", { children: [_jsx("h3", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2", children: "Data" }), _jsxs("dl", { className: "text-sm divide-y divide-ink-100 border border-ink-200 rounded-md bg-white", children: [data.length === 0 && (_jsx("div", { className: "px-3 py-2 text-ink-500 italic", children: "(no data fields)" })), data.map(([k, v]) => (_jsxs("div", { className: "flex px-3 py-2", children: [_jsx("dt", { className: "w-32 text-ink-500 break-all", children: k }), _jsx("dd", { className: "text-ink-900 flex-1 break-all", children: formatVal(v) })] }, k)))] })] })] }));
}
function formatVal(v) {
    if (v == null)
        return "—";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        return String(v);
    return JSON.stringify(v, null, 2);
}
