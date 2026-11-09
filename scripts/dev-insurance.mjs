#!/usr/bin/env node
// Minimal local host for the insurance handlers under frontend/api/insurance/ and the patient contact
// handler under frontend/api/patients/[id]/ (a stand-in for
// `vercel dev`, which would need a Vercel login and the production Supabase keys). Insurance
// routes plus patients/[id]/contact: every other gateway route needs Supabase. Handlers are re-bundled per request,
// so edits show up without a restart.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "frontend/api");
const require = createRequire(import.meta.url);
const esbuild = require(path.join(root, "frontend/node_modules/esbuild"));
const PORT = Number(process.env.PORT || 4400);

function routeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

const SERVED_DIRS = ["insurance", path.join("patients", "[id]")];

function matchRoute(pathname) {
  const want = pathname.replace(/^\/api\//, "").replace(/\/+$/, "").split("/");
  for (const file of SERVED_DIRS.flatMap((d) => routeFiles(path.join(apiDir, d)))) {
    const have = path.relative(apiDir, file).replace(/\.ts$/, "").split(path.sep);
    if (have.length !== want.length) continue;
    const params = {};
    const ok = have.every((seg, i) => {
      const m = /^\[(.+)\]$/.exec(seg);
      if (m) return ((params[m[1]] = decodeURIComponent(want[i])), true);
      return seg === want[i];
    });
    if (ok) return { file, params };
  }
  return null;
}

function loadHandler(file) {
  const out = esbuild.buildSync({
    entryPoints: [file], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports.default;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const route = matchRoute(url.pathname);
    res.on("finish", () => console.log(`${req.method} ${url.pathname} -> ${res.statusCode}`));
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(b));
      return res;
    };
    if (!route) return res.status(404).json({ error: { code: "not_found", message: "no such route" } });

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    req.query = { ...Object.fromEntries(url.searchParams), ...route.params };
    req.body = body;
    try {
      await loadHandler(route.file)(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: { code: "internal", message: "unhandled error" } });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`insurance service on http://localhost:${PORT}`));
