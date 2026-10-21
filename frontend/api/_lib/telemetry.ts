import { AsyncLocalStorage } from "node:async_hooks";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { waitUntil } from "@vercel/functions";
import type { Handler } from "./cors.js";

// PHI rule for everything in this file: spans carry only the route template,
// method, status code and outbound *host*. Never a raw URL, query string, body,
// header, or error message — patient names and search terms travel in all of them.

type Telemetry = { tracer: Tracer; flush: () => Promise<void> };

const OTLP_ENDPOINTS = {
  us: "https://otlp.nr-data.net",
  eu: "https://otlp.eu01.nr-data.net",
} as const;

const activeSpan = new AsyncLocalStorage<Span>();
let state: Telemetry | null | undefined;

function init(): Telemetry | null {
  if (state !== undefined) return state;
  const licenseKey = process.env.NEW_RELIC_LICENSE_KEY;
  if (!licenseKey) return (state = null);
  try {
    const region = process.env.NEW_RELIC_REGION?.toLowerCase() === "eu" ? "eu" : "us";
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        "service.name": process.env.NEW_RELIC_APP_NAME ?? "myhealthcare-gateway",
        "service.version": process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
        "deployment.environment.name": process.env.VERCEL_ENV ?? "development",
        "vercel.deployment.id": process.env.VERCEL_DEPLOYMENT_ID,
        "cloud.provider": "vercel",
        "cloud.region": process.env.VERCEL_REGION,
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${process.env.NEW_RELIC_OTLP_ENDPOINT ?? OTLP_ENDPOINTS[region]}/v1/traces`,
            headers: { "api-key": licenseKey },
          }),
        ),
      ],
    });
    patchFetch(provider.getTracer("myhealthcare-gateway"));
    state = {
      tracer: provider.getTracer("myhealthcare-gateway"),
      flush: () => provider.forceFlush(),
    };
  } catch (err) {
    console.error("telemetry disabled: init failed", err instanceof Error ? err.name : err);
    state = null;
  }
  return state;
}

function patchFetch(tracer: Tracer): void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const parent = activeSpan.getStore();
    if (!parent) return original(input, init);
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (
      init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
    ).toUpperCase();
    const span = tracer.startSpan(
      `${method} ${url.host}`,
      {
        kind: SpanKind.CLIENT,
        attributes: { "http.request.method": method, "server.address": url.hostname },
      },
      trace.setSpan(ROOT_CONTEXT, parent),
    );
    try {
      const res = await original(input, init);
      span.setAttribute("http.response.status_code", res.status);
      if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      return res;
    } catch (err) {
      span.setAttribute("error.type", err instanceof Error ? err.name : "unknown");
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  };
}

// /api/patients/37/... -> /api/patients/:id/...; numeric, UUID and long opaque segments.
export function routeTemplate(url: string | undefined): string {
  const path = (url ?? "").split("?")[0] ?? "";
  const templated = path
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) || /^(?=.*\d)[\w-]{20,}$/.test(seg) ? ":id" : seg))
    .join("/");
  return templated || "/";
}

export function annotateActiveSpan(attributes: Record<string, string | number | boolean>): void {
  activeSpan.getStore()?.setAttributes(attributes);
}

export function withTelemetry(handler: Handler): Handler {
  return async (req, res) => {
    const telemetry = init();
    if (!telemetry) return handler(req, res);

    const method = req.method ?? "GET";
    const route = routeTemplate(req.url);
    const span = telemetry.tracer.startSpan(`${method} ${route}`, {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": method, "http.route": route },
    });
    try {
      await activeSpan.run(span, () => handler(req, res));
    } catch (err) {
      span.setAttribute("error.type", err instanceof Error ? err.name : "unknown");
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.setAttribute("http.response.status_code", res.statusCode);
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      waitUntil(telemetry.flush().catch(() => undefined));
    }
  };
}
