import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serviceByName, isServiceEnabled, ENABLED_STACKS } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { api } from "@/api";
import { ResourceTable } from "@/components/ResourceTable";
import { ResourceForm } from "@/components/ResourceForm";
import { Plus, RefreshCw, X, Play, Search, Server, Radio, } from "lucide-react";
export function ServicePage() {
    const { name } = useParams();
    const service = name ? serviceByName(name) : undefined;
    const qc = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [filter, setFilter] = useState("");
    const [bulkResult, setBulkResult] = useState(null);
    const stackEnabled = service ? isServiceEnabled(service) : false;
    const list = useQuery({
        queryKey: ["list", name],
        queryFn: () => api.list(service.prefix),
        enabled: !!service?.hasCrud && stackEnabled,
    });
    const create = useMutation({
        mutationFn: (body) => api.create(service.prefix, body),
        onSuccess: () => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["list", name] });
        },
    });
    const remove = useMutation({
        mutationFn: (id) => api.remove(service.prefix, id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["list", name] }),
    });
    const bulkAction = useMutation({
        mutationFn: async (a) => api.action(service.prefix, null, a.path, a.method),
        onSuccess: (data) => setBulkResult({ ok: true, body: JSON.stringify(data, null, 2) }),
        onError: (err) => setBulkResult({ ok: false, body: err.message }),
    });
    const items = list.data?.items ?? [];
    const filteredItems = useMemo(() => {
        if (!filter)
            return items;
        const needle = filter.toLowerCase();
        return items.filter((row) => Object.entries(row).some(([k, v]) => {
            if (["created_at", "updated_at"].includes(k))
                return false;
            const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
            return s.toLowerCase().includes(needle);
        }));
    }, [items, filter]);
    if (!service)
        return _jsxs("div", { className: "p-8", children: ["Unknown service: ", name] });
    if (service.hasCrud && !stackEnabled) {
        const Icon = DOMAIN_ICON[service.domain];
        const tint = DOMAIN_TINT[service.domain];
        return (_jsxs("div", { className: "max-w-4xl mx-auto px-8 py-8", children: [_jsx(Header, { service: service }), _jsxs("div", { className: "card p-8 mt-6 flex items-start gap-4", children: [_jsx("div", { className: `w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text}`, children: _jsx(Icon, { className: "w-6 h-6" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-sm font-semibold text-ink-900", children: "Stack not running" }), _jsxs("p", { className: "text-sm text-ink-600 mt-1 leading-relaxed", children: ["This service is in the", " ", _jsx("span", { className: "chip chip-brand mx-0.5", children: service.stack }), " ", "stack, which isn't currently enabled. Bring it up locally to talk to it."] }), _jsxs("div", { className: "mt-4", children: [_jsx("div", { className: "text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-1", children: "Terminal" }), _jsx("pre", { className: "font-mono text-xs bg-ink-900 text-ink-100 rounded px-3 py-2 overflow-x-auto", children: `cd ~/Postman/healthcare-org/infra
./run.sh ${service.stack}` })] }), _jsxs("div", { className: "mt-3 text-[11px] text-ink-500", children: ["Then update", " ", _jsx("code", { className: "font-mono text-ink-700", children: "ENABLED_STACKS" }), " in", " ", _jsx("code", { className: "font-mono text-ink-700", children: "frontend/src/services.ts" }), " ", "to include", " ", _jsxs("code", { className: "font-mono text-ink-700", children: ["\"", service.stack, "\""] }), " ", "(currently:", " ", ENABLED_STACKS.map((s, i) => (_jsxs("span", { children: [i > 0 && ", ", _jsxs("code", { className: "font-mono text-ink-700", children: ["\"", s, "\""] })] }, s))), ")."] })] })] })] }));
    }
    if (!service.hasCrud) {
        const Icon = DOMAIN_ICON[service.domain];
        const tint = DOMAIN_TINT[service.domain];
        return (_jsxs("div", { className: "max-w-4xl mx-auto px-8 py-8", children: [_jsx(Header, { service: service }), _jsxs("div", { className: "card p-8 mt-6 flex items-start gap-4", children: [_jsx("div", { className: `w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text}`, children: _jsx(Icon, { className: "w-6 h-6" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "text-sm font-semibold text-ink-900", children: "No generic CRUD surface" }), _jsxs("p", { className: "text-sm text-ink-600 mt-1 leading-relaxed", children: ["This service (", _jsx("code", { className: "font-mono", children: service.name }), ") doesn't expose the uniform ", _jsx("code", { className: "font-mono", children: "/api/<resource>" }), " ", "CRUD template.", service.name === "api-gateway" && (_jsx(_Fragment, { children: " It's a health-check-only Go stub in this repo." })), service.name === "service-registry" && (_jsx(_Fragment, { children: " It's the Consul service-registry proxy." })), (service.name === "patient-portal-api" ||
                                            service.name === "provider-portal-api") && (_jsx(_Fragment, { children: " It's a BFF-style aggregator for a portal client, not a CRUD service." }))] }), _jsxs("div", { className: "mt-4 grid grid-cols-2 gap-2 text-xs", children: [_jsxs("div", { className: "rounded border border-ink-200 bg-ink-50 px-3 py-2", children: [_jsx("div", { className: "text-ink-500", children: "Port" }), _jsx("div", { className: "font-mono text-ink-900 mt-0.5", children: service.port })] }), _jsxs("div", { className: "rounded border border-ink-200 bg-ink-50 px-3 py-2", children: [_jsx("div", { className: "text-ink-500", children: "Language" }), _jsx("div", { className: "text-ink-900 mt-0.5 capitalize", children: service.language })] })] })] })] })] }));
    }
    return (_jsxs("div", { className: "max-w-[1400px] mx-auto px-8 py-8", children: [_jsx(Header, { service: service }), _jsxs("div", { className: "mt-6 flex items-center gap-2 flex-wrap", children: [_jsxs("div", { className: "relative flex-1 max-w-sm", children: [_jsx(Search, { className: "w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" }), _jsx("input", { className: "input pl-9 h-9", placeholder: "Filter records\u2026", value: filter, onChange: (e) => setFilter(e.target.value) })] }), _jsxs("button", { onClick: () => setShowCreate((v) => !v), className: "btn btn-primary", children: [showCreate ? _jsx(X, { className: "w-4 h-4" }) : _jsx(Plus, { className: "w-4 h-4" }), showCreate ? "Close" : "New record"] }), _jsxs("button", { onClick: () => qc.invalidateQueries({ queryKey: ["list", name] }), className: "btn btn-secondary", children: [_jsx(RefreshCw, { className: "w-4 h-4" }), "Refresh"] }), service.bulkActions?.map((a) => (_jsxs("button", { onClick: () => bulkAction.mutate({ path: a.path, method: a.method }), className: "btn btn-secondary", children: [_jsx(Play, { className: "w-4 h-4" }), a.label] }, a.label))), _jsx("div", { className: "ml-auto text-sm text-ink-500", children: list.isPending
                            ? "Loading…"
                            : list.isError
                                ? _jsxs("span", { className: "text-danger-700", children: ["Error: ", list.error?.message] })
                                : `${filteredItems.length}${filter ? ` / ${list.data?.count ?? 0}` : ` of ${list.data?.count ?? 0}`} records` })] }), showCreate && (_jsxs("div", { className: "card p-5 mt-4", children: [_jsxs("h3", { className: "text-sm font-semibold text-ink-900 mb-3", children: ["Create ", service.displayName] }), _jsx(ResourceForm, { fields: service.createFields, submitting: create.isPending, onSubmit: async (body) => {
                            await create.mutateAsync(body);
                        } }), create.isError && (_jsx("div", { className: "mt-3 text-sm text-danger-700 bg-danger-50 border border-danger-100 rounded px-3 py-2", children: create.error?.message }))] })), bulkResult && (_jsx("pre", { className: `mt-4 text-xs whitespace-pre-wrap p-3 rounded-md border ${bulkResult.ok
                    ? "bg-ok-50 border-ok-100 text-ok-700"
                    : "bg-danger-50 border-danger-100 text-danger-700"}`, children: bulkResult.body })), _jsxs("div", { className: "mt-6", children: [list.isError && (_jsxs("div", { className: "card p-4 mb-4 text-sm text-danger-700 bg-danger-50 border-danger-100", children: ["Failed to load: ", list.error?.message] })), _jsx(ResourceTable, { loading: list.isPending, rows: filteredItems, linkBase: `/service/${service.name}`, onDelete: (id) => {
                            if (window.confirm(`Delete #${id}?`))
                                remove.mutate(id);
                        } })] })] }));
}
function Header({ service }) {
    const Icon = DOMAIN_ICON[service.domain];
    const tint = DOMAIN_TINT[service.domain];
    return (_jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: `w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`, children: _jsx(Icon, { className: "w-6 h-6" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: _jsx(Link, { to: `/domain/${encodeURIComponent(service.domain)}`, className: "hover:text-brand-700", children: service.domain }) }), _jsx("h1", { className: "text-2xl font-semibold text-ink-900 mt-0.5", children: service.displayName }), _jsxs("div", { className: "flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-ink-500", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5 font-mono", children: [_jsx(Radio, { className: "w-3.5 h-3.5" }), service.prefix, "/"] }), _jsxs("span", { className: "inline-flex items-center gap-1.5", children: [_jsx(Server, { className: "w-3.5 h-3.5" }), "localhost:", service.port] }), _jsx("span", { className: "chip chip-neutral", children: service.language }), service.actions?.map((a) => (_jsxs("span", { className: "chip chip-brand", children: ["+", a.label] }, a.label)))] })] })] }));
}
