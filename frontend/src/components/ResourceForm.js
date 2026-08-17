import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FK_TARGETS, serviceByName, formatRefLabel, humanizeKey, } from "@/services";
import { api } from "@/api";
const DEFAULT_FIELDS = [
    { key: "name", placeholder: "any JSON field is accepted" },
];
// Decide how to render each field. Priority: explicit hint.kind → auto-detect
// FK by key name → text default.
function effectiveKind(hint) {
    if (hint.kind)
        return hint.kind;
    if (hint.refTo || FK_TARGETS[hint.key])
        return "ref";
    return "text";
}
export function ResourceForm({ fields, onSubmit, submitting, }) {
    const active = fields && fields.length ? fields : DEFAULT_FIELDS;
    const [values, setValues] = useState({});
    const submit = (e) => {
        e.preventDefault();
        const body = {};
        for (const f of active) {
            const v = values[f.key];
            if (v === undefined || v === "")
                continue;
            if (f.kind === "number")
                body[f.key] = Number(v);
            else if (effectiveKind(f) === "ref")
                body[f.key] = Number(v);
            else
                body[f.key] = v;
        }
        void onSubmit(body);
    };
    return (_jsxs("form", { onSubmit: submit, className: "space-y-3", children: [active.map((f) => (_jsx(Field, { hint: f, value: values[f.key] ?? "", onChange: (v) => setValues((s) => ({ ...s, [f.key]: v })) }, f.key))), _jsx("button", { className: "btn btn-primary", type: "submit", disabled: submitting, children: submitting ? "Creating…" : "Create" })] }));
}
function Field({ hint, value, onChange, }) {
    const kind = effectiveKind(hint);
    const label = hint.label ?? humanizeKey(hint.key);
    return (_jsxs("label", { className: "block", children: [_jsxs("span", { className: "text-xs font-medium text-ink-600 uppercase tracking-wide", children: [label, " ", hint.required && _jsx("span", { className: "text-red-600", children: "*" })] }), _jsx("div", { className: "mt-1", children: kind === "ref" ? (_jsx(RefSelect, { hint: hint, value: value, onChange: onChange })) : kind === "select" ? (_jsxs("select", { className: "input", value: value, onChange: (e) => onChange(e.target.value), required: hint.required, children: [_jsx("option", { value: "", children: hint.placeholder ?? `Select ${label.toLowerCase()}…` }), (hint.options ?? []).map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value)))] })) : kind === "textarea" ? (_jsx("textarea", { className: "input", rows: 4, value: value, onChange: (e) => onChange(e.target.value), required: hint.required, placeholder: hint.placeholder })) : (_jsx("input", { className: "input", type: kind === "date"
                        ? "date"
                        : kind === "datetime"
                            ? "datetime-local"
                            : kind === "number"
                                ? "number"
                                : "text", value: value, onChange: (e) => onChange(e.target.value), required: hint.required, placeholder: hint.placeholder })) })] }));
}
function RefSelect({ hint, value, onChange, }) {
    const targetName = hint.refTo ?? FK_TARGETS[hint.key];
    const target = targetName ? serviceByName(targetName) : undefined;
    const q = useQuery({
        queryKey: ["ref-lookup", targetName],
        queryFn: () => api.list(target.prefix, { limit: "200" }),
        enabled: !!target,
        staleTime: 60_000,
    });
    if (!target) {
        // Fallback to plain text if the FK target isn't in the registry.
        return (_jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), placeholder: hint.placeholder }));
    }
    const singular = target.displayName.replace(/s$/i, "").toLowerCase();
    if (q.isError) {
        return (_jsxs("div", { className: "space-y-1", children: [_jsx("input", { className: "input", value: value, onChange: (e) => onChange(e.target.value), placeholder: `${singular} ID` }), _jsxs("div", { className: "text-xs text-danger-700", children: ["Couldn't load ", target.displayName.toLowerCase(), " \u2014 fell back to raw ID."] })] }));
    }
    return (_jsxs("select", { className: "input", value: value, onChange: (e) => onChange(e.target.value), required: hint.required, disabled: q.isPending, children: [_jsx("option", { value: "", children: q.isPending ? "Loading…" : `Select a ${singular}…` }), (q.data?.items ?? []).map((row) => (_jsx("option", { value: String(row.id), children: formatRefLabel(targetName, row) }, row.id)))] }));
}
