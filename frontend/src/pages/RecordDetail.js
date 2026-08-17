import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serviceByName, isServiceEnabled } from "@/services";
import { api } from "@/api";
import { ResourceDetail } from "@/components/ResourceDetail";
import { PatientDetail } from "./PatientDetail";
import { useState } from "react";
import { ArrowLeft, Trash2, Play } from "lucide-react";
export function RecordDetail() {
    const { name, id } = useParams();
    const service = name ? serviceByName(name) : undefined;
    const qc = useQueryClient();
    const nav = useNavigate();
    const [actionResult, setActionResult] = useState(null);
    const q = useQuery({
        queryKey: ["record", name, id],
        queryFn: () => api.get(service.prefix, id),
        enabled: !!service && !!id && !!service && isServiceEnabled(service),
    });
    const doAction = useMutation({
        mutationFn: (a) => api.action(service.prefix, id, a.path, a.method),
        onSuccess: (data) => {
            setActionResult({ ok: true, body: JSON.stringify(data, null, 2) });
            qc.invalidateQueries({ queryKey: ["record", name, id] });
            qc.invalidateQueries({ queryKey: ["list", name] });
        },
        onError: (err) => setActionResult({ ok: false, body: err.message }),
    });
    const remove = useMutation({
        mutationFn: () => api.remove(service.prefix, id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["list", name] });
            nav(`/service/${name}`);
        },
    });
    if (!service)
        return _jsxs("div", { className: "p-8", children: ["Unknown service: ", name] });
    // Cross-service view for patients
    if (service.name === "patients-service" && id && q.data) {
        return _jsx(PatientDetail, { patient: q.data });
    }
    return (_jsxs("div", { className: "p-8 max-w-6xl", children: [_jsxs(Link, { to: `/service/${service.name}`, className: "text-sm text-ink-500 hover:text-accent inline-flex items-center gap-1", children: [_jsx(ArrowLeft, { className: "w-3.5 h-3.5" }), " ", service.displayName] }), _jsxs("div", { className: "flex items-center gap-3 mt-2", children: [_jsxs("h1", { className: "text-2xl font-semibold", children: [service.displayName, " #", id] }), q.data?.status && (_jsx("span", { className: `chip ${q.data.status === "active" ? "chip-ok" : "chip-err"}`, children: q.data.status }))] }), _jsxs("div", { className: "mt-4 flex items-center gap-2", children: [service.actions?.map((a) => (_jsxs("button", { onClick: () => doAction.mutate({ path: a.path, method: a.method }), className: "btn btn-ghost", children: [_jsx(Play, { className: "w-3.5 h-3.5" }), " ", a.label] }, a.label))), _jsxs("button", { onClick: () => {
                            if (window.confirm(`Delete #${id}?`))
                                remove.mutate();
                        }, className: "btn btn-danger", children: [_jsx(Trash2, { className: "w-3.5 h-3.5" }), " Delete"] })] }), actionResult && (_jsx("pre", { className: `mt-4 text-xs whitespace-pre-wrap p-3 rounded border ${actionResult.ok
                    ? "bg-green-50 border-green-200 text-green-900"
                    : "bg-red-50 border-red-200 text-red-900"}`, children: actionResult.body })), _jsxs("div", { className: "mt-6", children: [q.isPending && _jsx("div", { className: "text-ink-500 text-sm", children: "Loading\u2026" }), q.isError && (_jsxs("div", { className: "text-red-700 text-sm", children: ["Error: ", q.error?.message] })), q.data && _jsx(ResourceDetail, { record: q.data })] })] }));
}
