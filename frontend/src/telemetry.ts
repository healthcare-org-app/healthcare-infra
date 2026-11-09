import { BrowserAgent } from "@newrelic/browser-agent/loaders/browser-agent";

const ACCOUNT_ID = import.meta.env.VITE_NEW_RELIC_ACCOUNT_ID as string | undefined;
const LICENSE_KEY = import.meta.env.VITE_NEW_RELIC_BROWSER_LICENSE_KEY as string | undefined;
const APP_ID = import.meta.env.VITE_NEW_RELIC_BROWSER_APP_ID as string | undefined;
const REGION = (import.meta.env.VITE_NEW_RELIC_REGION as string | undefined)?.toLowerCase();

export function initBrowserTelemetry(): void {
  if (!ACCOUNT_ID || !LICENSE_KEY || !APP_ID) return;

  const beacon = REGION === "eu" ? "bam.eu01.nr-data.net" : "bam.nr-data.net";
  const supabaseHost = (() => {
    try {
      return new URL(import.meta.env.VITE_SUPABASE_URL as string).host;
    } catch {
      return undefined;
    }
  })();

  // PHI: this app renders patient records, so capture performance and errors
  // only — no session replay or traces, no cookies, no distributed-tracing
  // headers, and no Supabase request URLs (they carry filter values).
  new BrowserAgent({
    init: {
      distributed_tracing: { enabled: false },
      privacy: { cookies_enabled: false },
      session_replay: { enabled: false },
      session_trace: { enabled: false },
      ajax: { deny_list: [beacon, ...(supabaseHost ? [supabaseHost] : [])] },
      obfuscate: [{ regex: /(?<=\/)\d+(?=\/|$|\?)/g, replacement: ":id" }],
    },
    info: {
      beacon,
      errorBeacon: beacon,
      licenseKey: LICENSE_KEY,
      applicationID: APP_ID,
      sa: 1,
    },
    loader_config: {
      accountID: ACCOUNT_ID,
      trustKey: ACCOUNT_ID,
      agentID: APP_ID,
      licenseKey: LICENSE_KEY,
      applicationID: APP_ID,
    },
  });
}
