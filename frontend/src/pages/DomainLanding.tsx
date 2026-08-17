import { Link, useParams } from "react-router-dom";
import { DOMAIN_ORDER, servicesByDomain, type Domain } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { ArrowRight, Server, Radio, Ban } from "lucide-react";

export function DomainLanding() {
  const { domain: rawDomain } = useParams<{ domain: string }>();
  const domain = rawDomain ? (decodeURIComponent(rawDomain) as Domain) : undefined;
  const grouped = servicesByDomain();

  if (!domain || !DOMAIN_ORDER.includes(domain)) {
    return <div className="p-8">Unknown domain.</div>;
  }

  const services = grouped[domain];
  const Icon = DOMAIN_ICON[domain];
  const tint = DOMAIN_TINT[domain];

  return (
    <div className="max-w-[1400px] mx-auto px-8 py-8">
      <div className="flex items-start gap-4">
        <div
          className={`w-14 h-14 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`}
        >
          <Icon className="w-7 h-7" />
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider">
            Domain
          </div>
          <h1 className="text-2xl font-semibold text-ink-900 mt-0.5">{domain}</h1>
          <p className="text-sm text-ink-500 mt-1">
            {services.length} services · {services.filter((s) => !s.hasCrud).length}{" "}
            without a generic CRUD template
          </p>
        </div>
      </div>

      <ul className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map((s) => (
          <li key={s.name}>
            {s.hasCrud ? (
              <Link
                to={`/service/${s.name}`}
                className="card card-hover p-4 flex flex-col gap-2 h-full"
              >
                <div className="flex items-start gap-2">
                  <div className="font-semibold text-ink-900">
                    {s.displayName}
                  </div>
                  <ArrowRight className="w-4 h-4 text-ink-300 ml-auto" />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-ink-500">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Radio className="w-3 h-3" />
                    {s.prefix}/
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Server className="w-3 h-3" /> :{s.port}
                  </span>
                </div>
                <div className="flex items-center flex-wrap gap-1">
                  <span className="chip chip-neutral">{s.language}</span>
                  {s.actions?.map((a) => (
                    <span key={a.label} className="chip chip-brand">
                      +{a.label}
                    </span>
                  ))}
                </div>
              </Link>
            ) : (
              <div className="card p-4 flex flex-col gap-2 h-full opacity-70">
                <div className="flex items-start gap-2">
                  <div className="font-semibold text-ink-900">
                    {s.displayName}
                  </div>
                  <span className="chip chip-warn ml-auto">
                    <Ban className="w-3 h-3" /> No CRUD
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-ink-500">
                  <span className="inline-flex items-center gap-1">
                    <Server className="w-3 h-3" /> :{s.port}
                  </span>
                  <span className="chip chip-neutral">{s.language}</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
