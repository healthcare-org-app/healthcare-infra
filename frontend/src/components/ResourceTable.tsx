import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import type { Row } from "@/api";
import { api } from "@/api";
import {
  FK_TARGETS,
  formatRefLabel,
  serviceByName,
  type ServiceDef,
} from "@/services";
import { Inbox, Trash2 } from "lucide-react";

const IGNORED = new Set(["id", "status", "created_at", "updated_at"]);

function pickColumns(rows: Row[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (IGNORED.has(k)) continue;
      if (typeof r[k] === "object" && r[k] !== null) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

function fkTargetForColumn(col: string): string | undefined {
  return FK_TARGETS[col];
}

// Collect unique FK target service names that appear in the visible columns.
function fkTargetsInColumns(cols: string[]): string[] {
  const set = new Set<string>();
  for (const c of cols) {
    const t = fkTargetForColumn(c);
    if (t && serviceByName(t)) set.add(t);
  }
  return [...set];
}

export function ResourceTable({
  rows,
  linkBase,
  onDelete,
  loading,
}: {
  rows: Row[];
  linkBase: string;
  onDelete?: (id: number) => void;
  loading?: boolean;
}) {
  const cols = pickColumns(rows);
  const fkTargets = fkTargetsInColumns(cols);

  // Fetch each referenced service's rows once and build an id → label map.
  const refQueries = useQueries({
    queries: fkTargets.map((target) => ({
      queryKey: ["fk-lookup", target],
      queryFn: () =>
        api.list((serviceByName(target) as ServiceDef).prefix, { limit: "200" }),
      staleTime: 60_000,
    })),
  });

  const refMap: Record<string, Record<string | number, Row>> = {};
  fkTargets.forEach((target, i) => {
    const items = (refQueries[i].data?.items ?? []) as Row[];
    refMap[target] = Object.fromEntries(items.map((r) => [r.id, r]));
  });

  if (loading) {
    return (
      <div className="card overflow-hidden">
        <div className="p-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton h-4 w-8" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-4 w-20" />
              <div className="skeleton h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0)
    return (
      <div className="card p-10 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-full bg-ink-100 text-ink-500 flex items-center justify-center">
          <Inbox className="w-6 h-6" />
        </div>
        <div className="mt-3 text-sm font-medium text-ink-900">No records yet</div>
        <div className="text-xs text-ink-500 mt-1 max-w-sm">
          Use the <span className="font-medium text-ink-700">New record</span>{" "}
          button above to create the first one.
        </div>
      </div>
    );

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="hc-table">
          <thead>
            <tr>
              <th className="w-16">ID</th>
              {cols.map((c) => (
                <th key={c}>{humanColumn(c)}</th>
              ))}
              <th>Status</th>
              <th>Updated</th>
              {onDelete && <th className="w-16 text-right"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    className="text-brand-700 hover:underline font-mono text-xs"
                    to={`${linkBase}/${r.id}`}
                  >
                    #{r.id}
                  </Link>
                </td>
                {cols.map((c) => (
                  <td key={c} className="text-ink-800">
                    {renderCell(c, r[c], refMap)}
                  </td>
                ))}
                <td>
                  <span
                    className={`chip ${
                      r.status === "active"
                        ? "chip-ok"
                        : r.status === "inactive" || r.status === "deactivated"
                          ? "chip-err"
                          : "chip-neutral"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        r.status === "active"
                          ? "bg-ok-500"
                          : r.status === "inactive" || r.status === "deactivated"
                            ? "bg-danger-500"
                            : "bg-ink-400"
                      }`}
                    />
                    {r.status ?? "—"}
                  </span>
                </td>
                <td className="text-xs text-ink-500 whitespace-nowrap">
                  {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                </td>
                {onDelete && (
                  <td className="text-right">
                    <button
                      onClick={() => onDelete(r.id)}
                      className="btn btn-danger-outline !px-2 !py-1 text-xs"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function humanColumn(col: string): string {
  // If it's an FK column, show the humanized noun ("Patient" not "Patient_id").
  if (FK_TARGETS[col]) {
    return col
      .replace(/_id$/, "")
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());
  }
  return col;
}

function renderCell(
  col: string,
  v: unknown,
  refMap: Record<string, Record<string | number, Row>>,
): React.ReactNode {
  const target = FK_TARGETS[col];
  if (target && v != null && refMap[target]?.[v as string | number]) {
    const row = refMap[target][v as string | number];
    const label = formatRefLabel(target, row);
    const serviceName = target;
    return (
      <Link
        className="text-brand-700 hover:underline"
        to={`/service/${serviceName}/${row.id}`}
      >
        {label}
      </Link>
    );
  }
  if (v == null) return <span className="text-ink-400">—</span>;
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return <span className="font-mono text-xs">{JSON.stringify(v)}</span>;
}
