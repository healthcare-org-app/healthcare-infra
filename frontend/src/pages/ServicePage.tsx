import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serviceByName, isServiceEnabled, ENABLED_STACKS } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { api } from "@/api";
import { ResourceTable } from "@/components/ResourceTable";
import { ResourceForm } from "@/components/ResourceForm";
import {
  Plus,
  RefreshCw,
  X,
  Play,
  Search,
  Server,
  Radio,
} from "lucide-react";

export function ServicePage() {
  const { name } = useParams<{ name: string }>();
  const service = name ? serviceByName(name) : undefined;
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("");
  const [bulkResult, setBulkResult] = useState<{ ok: boolean; body: string } | null>(null);

  const stackEnabled = service ? isServiceEnabled(service) : false;
  const list = useQuery({
    queryKey: ["list", name],
    queryFn: () => api.list(service!.prefix),
    enabled: !!service?.hasCrud && stackEnabled,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.create(service!.prefix, body),
    onSuccess: () => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["list", name] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.remove(service!.prefix, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list", name] }),
  });

  const bulkAction = useMutation({
    mutationFn: async (a: { path: string; method: "POST" | "GET" }) =>
      api.action(service!.prefix, null, a.path, a.method),
    onSuccess: (data) => setBulkResult({ ok: true, body: JSON.stringify(data, null, 2) }),
    onError: (err: Error) => setBulkResult({ ok: false, body: err.message }),
  });

  const items = list.data?.items ?? [];
  const filteredItems = useMemo(() => {
    if (!filter) return items;
    const needle = filter.toLowerCase();
    return items.filter((row) =>
      Object.entries(row).some(([k, v]) => {
        if (["created_at", "updated_at"].includes(k)) return false;
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return s.toLowerCase().includes(needle);
      }),
    );
  }, [items, filter]);

  if (!service)
    return <div className="p-8">Unknown service: {name}</div>;

  if (service.hasCrud && !stackEnabled) {
    const Icon = DOMAIN_ICON[service.domain];
    const tint = DOMAIN_TINT[service.domain];
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <Header service={service} />
        <div className="card p-8 mt-6 flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text}`}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink-900">
              Stack not running
            </div>
            <p className="text-sm text-ink-600 mt-1 leading-relaxed">
              This service is in the{" "}
              <span className="chip chip-brand mx-0.5">{service.stack}</span>{" "}
              stack, which isn't currently enabled. Bring it up locally to talk
              to it.
            </p>
            <div className="mt-4">
              <div className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-1">
                Terminal
              </div>
              <pre className="font-mono text-xs bg-ink-900 text-ink-100 rounded px-3 py-2 overflow-x-auto">
{`cd ~/Postman/healthcare-org/infra
./run.sh ${service.stack}`}
              </pre>
            </div>
            <div className="mt-3 text-[11px] text-ink-500">
              Then update{" "}
              <code className="font-mono text-ink-700">ENABLED_STACKS</code> in{" "}
              <code className="font-mono text-ink-700">
                frontend/src/services.ts
              </code>{" "}
              to include{" "}
              <code className="font-mono text-ink-700">"{service.stack}"</code>{" "}
              (currently:{" "}
              {ENABLED_STACKS.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <code className="font-mono text-ink-700">"{s}"</code>
                </span>
              ))}
              ).
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!service.hasCrud) {
    const Icon = DOMAIN_ICON[service.domain];
    const tint = DOMAIN_TINT[service.domain];
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <Header service={service} />
        <div className="card p-8 mt-6 flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text}`}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink-900">
              No generic CRUD surface
            </div>
            <p className="text-sm text-ink-600 mt-1 leading-relaxed">
              This service (<code className="font-mono">{service.name}</code>) doesn't
              expose the uniform <code className="font-mono">/api/&lt;resource&gt;</code>{" "}
              CRUD template.
              {service.name === "api-gateway" && (
                <> It's a health-check-only Go stub in this repo.</>
              )}
              {service.name === "service-registry" && (
                <> It's the Consul service-registry proxy.</>
              )}
              {(service.name === "patient-portal-api" ||
                service.name === "provider-portal-api") && (
                <> It's a BFF-style aggregator for a portal client, not a CRUD service.</>
              )}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-ink-200 bg-ink-50 px-3 py-2">
                <div className="text-ink-500">Port</div>
                <div className="font-mono text-ink-900 mt-0.5">
                  {service.port}
                </div>
              </div>
              <div className="rounded border border-ink-200 bg-ink-50 px-3 py-2">
                <div className="text-ink-500">Language</div>
                <div className="text-ink-900 mt-0.5 capitalize">
                  {service.language}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-8 py-8">
      <Header service={service} />

      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="input pl-9 h-9"
            placeholder="Filter records…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="btn btn-primary"
        >
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? "Close" : "New record"}
        </button>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["list", name] })}
          className="btn btn-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        {service.bulkActions?.map((a) => (
          <button
            key={a.label}
            onClick={() => bulkAction.mutate({ path: a.path, method: a.method })}
            className="btn btn-secondary"
          >
            <Play className="w-4 h-4" />
            {a.label}
          </button>
        ))}
        <div className="ml-auto text-sm text-ink-500">
          {list.isPending
            ? "Loading…"
            : list.isError
              ? <span className="text-danger-700">Error: {list.error?.message}</span>
              : `${filteredItems.length}${filter ? ` / ${list.data?.count ?? 0}` : ` of ${list.data?.count ?? 0}`} records`}
        </div>
      </div>

      {showCreate && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-semibold text-ink-900 mb-3">
            Create {service.displayName}
          </h3>
          <ResourceForm
            fields={service.createFields}
            submitting={create.isPending}
            onSubmit={async (body) => {
              await create.mutateAsync(body);
            }}
          />
          {create.isError && (
            <div className="mt-3 text-sm text-danger-700 bg-danger-50 border border-danger-100 rounded px-3 py-2">
              {create.error?.message}
            </div>
          )}
        </div>
      )}

      {bulkResult && (
        <pre
          className={`mt-4 text-xs whitespace-pre-wrap p-3 rounded-md border ${
            bulkResult.ok
              ? "bg-ok-50 border-ok-100 text-ok-700"
              : "bg-danger-50 border-danger-100 text-danger-700"
          }`}
        >
          {bulkResult.body}
        </pre>
      )}

      <div className="mt-6">
        {list.isError && (
          <div className="card p-4 mb-4 text-sm text-danger-700 bg-danger-50 border-danger-100">
            Failed to load: {list.error?.message}
          </div>
        )}
        <ResourceTable
          loading={list.isPending}
          rows={filteredItems}
          linkBase={`/service/${service.name}`}
          onDelete={(id) => {
            if (window.confirm(`Delete #${id}?`)) remove.mutate(id);
          }}
        />
      </div>
    </div>
  );
}

function Header({ service }: { service: NonNullable<ReturnType<typeof serviceByName>> }) {
  const Icon = DOMAIN_ICON[service.domain];
  const tint = DOMAIN_TINT[service.domain];
  return (
    <div className="flex items-start gap-4">
      <div
        className={`w-12 h-12 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`}
      >
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
          <Link
            to={`/domain/${encodeURIComponent(service.domain)}`}
            className="hover:text-brand-700"
          >
            {service.domain}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold text-ink-900 mt-0.5">
          {service.displayName}
        </h1>
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1.5 font-mono">
            <Radio className="w-3.5 h-3.5" />
            {service.prefix}/
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            localhost:{service.port}
          </span>
          <span className="chip chip-neutral">{service.language}</span>
          {service.actions?.map((a) => (
            <span key={a.label} className="chip chip-brand">
              +{a.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
