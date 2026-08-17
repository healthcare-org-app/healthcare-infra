import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { SERVICES } from "./src/services";
// Build a proxy table mapping /api/<resource> → localhost:<port>.
// The Go api-gateway is a health-check stub, so this dev-server proxy
// gives the SPA a single origin without a real gateway in place.
const proxy = Object.fromEntries(SERVICES.map((s) => [
    s.prefix,
    {
        target: `http://127.0.0.1:${s.port}`,
        changeOrigin: false,
        secure: false,
    },
]));
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
        host: "127.0.0.1",
        port: 5173,
        proxy,
    },
});
