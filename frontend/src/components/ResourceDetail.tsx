import type { Row } from "@/api";

export function ResourceDetail({ record }: { record: Row }) {
  const meta = ["id", "status", "created_at", "updated_at"] as const;
  const data = Object.entries(record).filter(([k]) => !meta.includes(k as any));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section>
        <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
          Metadata
        </h3>
        <dl className="text-sm divide-y divide-ink-100 border border-ink-200 rounded-md bg-white">
          {meta.map((k) => (
            <div key={k} className="flex px-3 py-2">
              <dt className="w-32 text-ink-500">{k}</dt>
              <dd className="text-ink-900 font-mono text-xs">
                {formatVal((record as any)[k])}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
          Data
        </h3>
        <dl className="text-sm divide-y divide-ink-100 border border-ink-200 rounded-md bg-white">
          {data.length === 0 && (
            <div className="px-3 py-2 text-ink-500 italic">(no data fields)</div>
          )}
          {data.map(([k, v]) => (
            <div key={k} className="flex px-3 py-2">
              <dt className="w-32 text-ink-500 break-all">{k}</dt>
              <dd className="text-ink-900 flex-1 break-all">{formatVal(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  return JSON.stringify(v, null, 2);
}
