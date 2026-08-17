import { Link, useLocation } from "react-router-dom";
import { DOMAIN_ORDER, servicesByDomain, SERVICES, isServiceEnabled } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  Star,
  Users,
  Stethoscope,
  CalendarDays,
  FlaskConical,
  Pill,
  Receipt,
} from "lucide-react";

const DEFAULT_OPEN = new Set([
  "PATIENTS",
  "PROVIDERS",
  "CLINICAL/EHR",
  "SCHEDULING",
]);

const FAVORITES: Array<{ name: string; label: string; Icon: typeof Users }> = [
  { name: "patients-service", label: "Patients", Icon: Users },
  { name: "providers-service", label: "Providers", Icon: Stethoscope },
  { name: "appointments-service", label: "Appointments", Icon: CalendarDays },
  { name: "lab-results-service", label: "Lab results", Icon: FlaskConical },
  { name: "prescriptions-service", label: "Prescriptions", Icon: Pill },
  { name: "invoicing-service", label: "Invoices", Icon: Receipt },
];

export function Sidebar() {
  const grouped = useMemo(() => servicesByDomain(), []);
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(DOMAIN_ORDER.map((d) => [d, DEFAULT_OPEN.has(d)])),
  );

  return (
    <nav className="w-72 shrink-0 h-full overflow-y-auto border-r border-ink-200 bg-white">
      {/* Favorites */}
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-1 px-1">
          <Star className="w-3 h-3" /> Favorites
        </div>
        <ul>
          {FAVORITES.map(({ name, label, Icon }) => {
            const to = `/service/${name}`;
            const active = loc.pathname.startsWith(to);
            return (
              <li key={name}>
                <Link
                  to={to}
                  className={clsx(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded text-sm",
                    active
                      ? "bg-brand-50 text-brand-700 font-medium"
                      : "text-ink-700 hover:bg-ink-50",
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  <ServiceCount name={name} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="h-px bg-ink-200 mx-3 my-2" />

      <div className="px-3 pb-2">
        <div className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-1 px-1">
          Services
        </div>
      </div>

      <ul className="pb-4 text-sm">
        {DOMAIN_ORDER.map((d) => {
          const services = grouped[d];
          const isOpen = open[d];
          const Icon = DOMAIN_ICON[d];
          const tint = DOMAIN_TINT[d];
          return (
            <li key={d} className="mb-0.5 px-3">
              <div
                className={clsx(
                  "w-full flex items-center gap-1.5 rounded",
                  "hover:bg-ink-50",
                )}
              >
                <button
                  onClick={() => setOpen((o) => ({ ...o, [d]: !o[d] }))}
                  className="p-1 text-ink-400 hover:text-ink-700"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                <Link
                  to={`/domain/${encodeURIComponent(d)}`}
                  className="flex-1 flex items-center gap-2 py-1 pr-2"
                >
                  <span
                    className={clsx(
                      "w-5 h-5 rounded flex items-center justify-center",
                      tint.bg,
                      tint.text,
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-700">
                    {d}
                  </span>
                  <span className="ml-auto text-[10px] text-ink-400">
                    {services.length}
                  </span>
                </Link>
              </div>
              {isOpen && (
                <ul className="pl-8 pt-0.5 pb-1">
                  {services.map((s) => {
                    const to = `/service/${s.name}`;
                    const active = loc.pathname === to || loc.pathname.startsWith(to + "/");
                    const enabled = isServiceEnabled(s);
                    return (
                      <li key={s.name}>
                        <Link
                          to={to}
                          className={clsx(
                            "flex items-center gap-2 px-2 py-1 rounded text-[13px] leading-5",
                            active
                              ? "bg-brand-50 text-brand-700 font-medium"
                              : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                            !s.hasCrud && "opacity-60",
                            !enabled && s.hasCrud && "text-ink-400",
                          )}
                          title={
                            !enabled && s.hasCrud
                              ? `Stack '${s.stack}' isn't enabled`
                              : undefined
                          }
                        >
                          <span
                            className={clsx(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              enabled ? "bg-ok-500" : "bg-ink-300",
                            )}
                          />
                          <span className="flex-1 truncate">{s.displayName}</span>
                          <span className="text-[10px] text-ink-400 font-mono">
                            :{s.port}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-4 py-3 border-t border-ink-200 text-[11px] text-ink-500">
        <div className="flex items-center justify-between">
          <span>{SERVICES.length} services</span>
          <span className="chip chip-brand">Dev mode</span>
        </div>
      </div>
    </nav>
  );
}

function ServiceCount({ name: _ }: { name: string }) {
  // Placeholder — could wire a query per favorite for a live count, but that
  // would fan out N requests on every route change. Skip.
  return null;
}
