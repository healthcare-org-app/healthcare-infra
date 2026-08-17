import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/api";
import { FK_TARGETS, formatRefLabel, serviceByName, } from "@/services";
import { Inbox, Trash2 } from "lucide-react";
const IGNORED = new Set(["id", "status", "created_at", "updated_at"]);
function pickColumns(rows) {
    const seen = new Map();
    for (const r of rows) {
        for (const k of Object.keys(r)) {
            if (IGNORED.has(k))
                continue;
            if (typeof r[k] === "object" && r[k] !== null)
                continue;
            seen.set(k, (seen.get(k) ?? 0) + 1);
        }
    }
    return [...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
}
function fkTargetForColumn(col) {
    return FK_TARGETS[col];
}
// Collect unique FK target service names that appear in the visible columns.
function fkTargetsInColumns(cols) {
    const set = new Set();
    for (const c of cols) {
        const t = fkTargetForColumn(c);
        if (t && serviceByName(t))
            set.add(t);
    }
    return [...set];
}
export function ResourceTable({ rows, linkBase, onDelete, loading, }) {
    const cols = pickColumns(rows);
    const fkTargets = fkTargetsInColumns(cols);
    // Fetch each referenced service's rows once and build an id → label map.
    const refQueries = useQueries({
        queries: fkTargets.map((target) => ({
            queryKey: ["fk-lookup", target],
            queryFn: () => api.list(serviceByName(target).prefix, { limit: "200" }),
            staleTime: 60_000,
        })),
    });
    const refMap = {};
    fkTargets.forEach((target, i) => {
        const items = (refQueries[i].data?.items ?? []);
        refMap[target] = Object.fromEntries(items.map((r) => [r.id, r]));
    });
    if (loading) {
        return (_jsx("div", { className: "card overflow-hidden", children: _jsx("div", { className: "p-4 space-y-3", children: [0, 1, 2, 3, 4].map((i) => (_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "skeleton h-4 w-8" }), _jsx("div", { className: "skeleton h-4 flex-1" }), _jsx("div", { className: "skeleton h-4 w-20" }), _jsx("div", { className: "skeleton h-4 w-24" })] }, i))) }) }));
    }
    if (rows.length === 0)
        return (_jsxs("div", { className: "card p-10 flex flex-col items-center text-center", children: [_jsx("div", { className: "w-12 h-12 rounded-full bg-ink-100 text-ink-500 flex items-center justify-center", children: _jsx(Inbox, { className: "w-6 h-6" }) }), _jsx("div", { className: "mt-3 text-sm font-medium text-ink-900", children: "No records yet" }), _jsxs("div", { className: "text-xs text-ink-500 mt-1 max-w-sm", children: ["Use the ", _jsx("span", { className: "font-medium text-ink-700", children: "New record" }), " ", "button above to create the first one."] })] }));
    return (_jsx("div", { className: "card overflow-hidden", children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "hc-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "w-16", children: "ID" }), cols.map((c) => (_jsx("th", { children: humanColumn(c) }, c))), _jsx("th", { children: "Status" }), _jsx("th", { children: "Updated" }), onDelete && _jsx("th", { className: "w-16 text-right" })] }) }), _jsx("tbody", { children: rows.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs(Link, { className: "text-brand-700 hover:underline font-mono text-xs", to: `${linkBase}/${r.id}`, children: ["#", r.id] }) }), cols.map((c) => (_jsx("td", { className: "text-ink-800", children: renderCell(c, r[c], refMap) }, c))), _jsx("td", { children: _jsxs("span", { className: `chip ${r.status === "active"
                                            ? "chip-ok"
                                            : r.status === "inactive" || r.status === "deactivated"
                                                ? "chip-err"
                                                : "chip-neutral"}`, children: [_jsx("span", { className: `w-1.5 h-1.5 rounded-full ${r.status === "active"
                                                    ? "bg-ok-500"
                                                    : r.status === "inactive" || r.status === "deactivated"
                                                        ? "bg-danger-500"
                                                        : "bg-ink-400"}` }), r.status ?? "—"] }) }), _jsx("td", { className: "text-xs text-ink-500 whitespace-nowrap", children: r.updated_at ? new Date(r.updated_at).toLocaleString() : "—" }), onDelete && (_jsx("td", { className: "text-right", children: _jsx("button", { onClick: () => onDelete(r.id), className: "btn btn-danger-outline !px-2 !py-1 text-xs", children: _jsx(Trash2, { className: "w-3 h-3" }) }) }))] }, r.id))) })] }) }) }));
}
function humanColumn(col) {
    // If it's an FK column, show the humanized noun ("Patient" not "Patient_id").
    if (FK_TARGETS[col]) {
        return col
            .replace(/_id$/, "")
            .replace(/_/g, " ")
            .replace(/^./, (c) => c.toUpperCase());
    }
    return col;
}
function renderCell(col, v, refMap) {
    const target = FK_TARGETS[col];
    if (target && v != null && refMap[target]?.[v]) {
        const row = refMap[target][v];
        const label = formatRefLabel(target, row);
        const serviceName = target;
        return (_jsx(Link, { className: "text-brand-700 hover:underline", to: `/service/${serviceName}/${row.id}`, children: label }));
    }
    if (v == null)
        return _jsx("span", { className: "text-ink-400", children: "\u2014" });
    if (typeof v === "string")
        return v.length > 60 ? v.slice(0, 60) + "…" : v;
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    return _jsx("span", { className: "font-mono text-xs", children: JSON.stringify(v) });
}
