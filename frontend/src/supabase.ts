import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!URL || !KEY) {
  // Non-fatal — the app renders and shows an obvious error state per query.
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set; API calls will fail.",
  );
}

export const supabase = createClient(URL ?? "", KEY ?? "");
