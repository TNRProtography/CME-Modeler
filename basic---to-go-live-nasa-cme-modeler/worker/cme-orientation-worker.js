// CME orientation store.
//
// The analysis runs as a GitHub Action (scripts/cme_orientation, every 30
// minutes) and uploads its results here; the app reads them from here. Kept
// apart from the analysis so the app never waits on image processing, and a
// failed analysis run leaves the last good results in place.
//
//   GET  /api/orientations        every stored CME's result, one read
//   GET  /api/orientation?id=...  one CME
//   GET  /api/status              the last run: when, how many, what failed
//   POST /api/ingest              the analysis uploads (Bearer INGEST_TOKEN)
//
// One KV key holds everything the app needs, so a page load is one read.
// Only the Action writes, one run at a time (its concurrency group), so the
// read-modify-write on that key cannot race.

const ALL_KEY = "all_v1";
const RUN_KEY = "last_run_v1";
const KEEP_DAYS = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      ...CORS,
    },
  });

async function readAll(env) {
  const all = await env.ORIENTATION_KV.get(ALL_KEY, { type: "json" });
  return all && typeof all === "object" && all.cmes ? all : { updatedAt: null, cmes: {} };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (url.pathname === "/api/orientations" && request.method === "GET") {
        return json(await readAll(env), 200, 120);
      }

      if (url.pathname === "/api/orientation" && request.method === "GET") {
        const id = url.searchParams.get("id");
        const all = await readAll(env);
        const one = id ? all.cmes[id] : null;
        return one ? json(one, 200, 120) : json({ error: "not found", id }, 404);
      }

      if (url.pathname === "/api/status" && request.method === "GET") {
        const [run, all] = await Promise.all([env.ORIENTATION_KV.get(RUN_KEY, { type: "json" }), readAll(env)]);
        const cmes = Object.values(all.cmes);
        const count = (s) => cmes.filter((c) => c.status === s).length;
        return json({
          ok: true,
          lastRun: run,
          stored: cmes.length,
          confirmed: count("confirmed"),
          estimated: count("estimated"),
          unknown: count("unknown"),
          updatedAt: all.updatedAt,
        });
      }

      if (url.pathname === "/api/ingest" && request.method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        if (!env.INGEST_TOKEN || auth !== `Bearer ${env.INGEST_TOKEN}`) return json({ error: "Unauthorized" }, 401);
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.results)) return json({ error: "Expected { run, results: [] }" }, 400);

        const all = await readAll(env);
        let stored = 0;
        for (const r of body.results) {
          if (!r || typeof r.id !== "string" || r.id.length > 80) continue;
          all.cmes[r.id] = r;
          stored++;
        }
        // Keep a month: older CMEs are long gone from the app's list.
        const cutoff = Date.now() - KEEP_DAYS * 86400000;
        for (const [id, r] of Object.entries(all.cmes)) {
          const t = Date.parse(r.startTime || "");
          if (Number.isFinite(t) && t < cutoff) delete all.cmes[id];
        }
        all.updatedAt = new Date().toISOString();
        await env.ORIENTATION_KV.put(ALL_KEY, JSON.stringify(all));
        await env.ORIENTATION_KV.put(RUN_KEY, JSON.stringify({ ...(body.run || {}), receivedAt: all.updatedAt, stored }));
        return json({ ok: true, stored, total: Object.keys(all.cmes).length });
      }

      return json({ error: "not found", routes: ["/api/orientations", "/api/orientation?id=", "/api/status", "POST /api/ingest"] }, 404);
    } catch (e) {
      return json({ error: e?.message || String(e) }, 500);
    }
  },
};
