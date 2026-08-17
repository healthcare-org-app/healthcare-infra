import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FK_TARGETS,
  serviceByName,
  formatRefLabel,
  humanizeKey,
  type FieldHint,
} from "@/services";
import { api } from "@/api";

const DEFAULT_FIELDS: FieldHint[] = [
  { key: "name", placeholder: "any JSON field is accepted" },
];

// Decide how to render each field. Priority: explicit hint.kind → auto-detect
// FK by key name → text default.
function effectiveKind(hint: FieldHint): FieldHint["kind"] {
  if (hint.kind) return hint.kind;
  if (hint.refTo || FK_TARGETS[hint.key]) return "ref";
  return "text";
}

export function ResourceForm({
  fields,
  onSubmit,
  submitting,
}: {
  fields?: FieldHint[];
  onSubmit: (body: Record<string, unknown>) => void | Promise<void>;
  submitting: boolean;
}) {
  const active = fields && fields.length ? fields : DEFAULT_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of active) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      if (f.kind === "number") body[f.key] = Number(v);
      else if (effectiveKind(f) === "ref") body[f.key] = Number(v);
      else body[f.key] = v;
    }
    void onSubmit(body);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {active.map((f) => (
        <Field
          key={f.key}
          hint={f}
          value={values[f.key] ?? ""}
          onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
        />
      ))}
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  );
}

function Field({
  hint,
  value,
  onChange,
}: {
  hint: FieldHint;
  value: string;
  onChange: (v: string) => void;
}) {
  const kind = effectiveKind(hint);
  const label = hint.label ?? humanizeKey(hint.key);

  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-600 uppercase tracking-wide">
        {label} {hint.required && <span className="text-red-600">*</span>}
      </span>
      <div className="mt-1">
        {kind === "ref" ? (
          <RefSelect hint={hint} value={value} onChange={onChange} />
        ) : kind === "select" ? (
          <select
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={hint.required}
          >
            <option value="">{hint.placeholder ?? `Select ${label.toLowerCase()}…`}</option>
            {(hint.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : kind === "textarea" ? (
          <textarea
            className="input"
            rows={4}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={hint.required}
            placeholder={hint.placeholder}
          />
        ) : (
          <input
            className="input"
            type={
              kind === "date"
                ? "date"
                : kind === "datetime"
                  ? "datetime-local"
                  : kind === "number"
                    ? "number"
                    : "text"
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={hint.required}
            placeholder={hint.placeholder}
          />
        )}
      </div>
    </label>
  );
}

function RefSelect({
  hint,
  value,
  onChange,
}: {
  hint: FieldHint;
  value: string;
  onChange: (v: string) => void;
}) {
  const targetName = hint.refTo ?? FK_TARGETS[hint.key];
  const target = targetName ? serviceByName(targetName) : undefined;

  const q = useQuery({
    queryKey: ["ref-lookup", targetName],
    queryFn: () => api.list(target!.prefix, { limit: "200" }),
    enabled: !!target,
    staleTime: 60_000,
  });

  if (!target) {
    // Fallback to plain text if the FK target isn't in the registry.
    return (
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint.placeholder}
      />
    );
  }

  const singular = target.displayName.replace(/s$/i, "").toLowerCase();

  if (q.isError) {
    return (
      <div className="space-y-1">
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${singular} ID`}
        />
        <div className="text-xs text-danger-700">
          Couldn't load {target.displayName.toLowerCase()} — fell back to raw ID.
        </div>
      </div>
    );
  }

  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={hint.required}
      disabled={q.isPending}
    >
      <option value="">
        {q.isPending ? "Loading…" : `Select a ${singular}…`}
      </option>
      {(q.data?.items ?? []).map((row) => (
        <option key={row.id} value={String(row.id)}>
          {formatRefLabel(targetName!, row)}
        </option>
      ))}
    </select>
  );
}
