import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serviceByName, isServiceEnabled } from "@/services";
import { api, type Row } from "@/api";
import { ResourceDetail } from "@/components/ResourceDetail";
import { PatientDetail } from "./PatientDetail";
import { useState } from "react";
import { ArrowLeft, Trash2, Play } from "lucide-react";

export function RecordDetail() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const service = name ? serviceByName(name) : undefined;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [actionResult, setActionResult] = useState<{ ok: boolean; body: string } | null>(null);

  const q = useQuery({
    queryKey: ["record", name, id],
    queryFn: () => api.get<Row>(service!.prefix, id!),
    enabled: !!service && !!id && !!service && isServiceEnabled(service),
  });

  const doAction = useMutation({
    mutationFn: (a: { path: string; method: "POST" | "GET" }) =>
      api.action(service!.prefix, id!, a.path, a.method),
    onSuccess: (data) => {
      setActionResult({ ok: true, body: JSON.stringify(data, null, 2) });
      qc.invalidateQueries({ queryKey: ["record", name, id] });
      qc.invalidateQueries({ queryKey: ["list", name] });
    },
    onError: (err: Error) => setActionResult({ ok: false, body: err.message }),
  });

  const remove = useMutation({
    mutationFn: () => api.remove(service!.prefix, id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list", name] });
      nav(`/service/${name}`);
    },
  });

  if (!service) return <div className="p-8">Unknown service: {name}</div>;

  // Cross-service view for patients
  if (service.name === "patients-service" && id && q.data) {
    return <PatientDetail patient={q.data} />;
  }

  return (
    <div className="p-8 max-w-6xl">
      <Link
        to={`/service/${service.name}`}
        className="text-sm text-ink-500 hover:text-accent inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {service.displayName}
      </Link>

      <div className="flex items-center gap-3 mt-2">
        <h1 className="text-2xl font-semibold">
          {service.displayName} #{id}
        </h1>
        {q.data?.status && (
          <span
            className={`chip ${
              q.data.status === "active" ? "chip-ok" : "chip-err"
            }`}
          >
            {q.data.status}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {service.actions?.map((a) => (
          <button
            key={a.label}
            onClick={() => doAction.mutate({ path: a.path, method: a.method })}
            className="btn btn-ghost"
          >
            <Play className="w-3.5 h-3.5" /> {a.label}
          </button>
        ))}
        <button
          onClick={() => {
            if (window.confirm(`Delete #${id}?`)) remove.mutate();
          }}
          className="btn btn-danger"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>

      {actionResult && (
        <pre
          className={`mt-4 text-xs whitespace-pre-wrap p-3 rounded border ${
            actionResult.ok
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          {actionResult.body}
        </pre>
      )}

      <div className="mt-6">
        {q.isPending && <div className="text-ink-500 text-sm">Loading…</div>}
        {q.isError && (
          <div className="text-red-700 text-sm">Error: {q.error?.message}</div>
        )}
        {q.data && <ResourceDetail record={q.data} />}
      </div>
    </div>
  );
}
