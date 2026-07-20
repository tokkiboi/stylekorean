import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-sync-secret") !== Deno.env.get("SOURCE_SYNC_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SECRET_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const body = await request.json();

  if (body.action === "ingest") {
    const { organizationId, sourceKey, records } = body;
    if (!organizationId || !sourceKey || !Array.isArray(records)) return json({ error: "Invalid ingest payload" }, 400);
    const { data: source, error: sourceError } = await db.from("sources")
      .select("id").eq("organization_id", organizationId).eq("source_key", sourceKey).single();
    if (sourceError) return json({ error: sourceError.message }, 400);
    const rows = records.map((record: Record<string, unknown>) => ({
      ...record, organization_id: organizationId, source_id: source.id
    }));
    const { data, error } = await db.from("shipments").upsert(rows, {
      onConflict: "source_id,external_id", ignoreDuplicates: false
    }).select("id,external_id,version");
    if (error) return json({ error: error.message }, 400);
    await db.from("sources").update({ last_synced_at: new Date().toISOString() }).eq("id", source.id);
    return json({ ok: true, written: data?.length || 0 });
  }

  if (body.action === "flush") {
    const { data: pending, error } = await db.from("sync_outbox")
      .select("*,sources(config)").eq("state", "pending").lte("available_at", new Date().toISOString())
      .order("id").limit(50);
    if (error) return json({ error: error.message }, 400);
    let succeeded = 0, failed = 0;
    for (const item of pending || []) {
      const endpoint = item.sources?.config?.writeback_url;
      if (!endpoint) {
        await db.from("sync_outbox").update({ state: "failed", error: "No writeback_url configured", finished_at: new Date().toISOString() }).eq("id", item.id);
        failed++;
        continue;
      }
      try {
        const response = await fetch(endpoint, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: item.operation, shipmentId: item.shipment_id, ...item.payload })
        });
        if (!response.ok) throw new Error(`Write-back HTTP ${response.status}`);
        await db.from("sync_outbox").update({ state: "succeeded", attempts: item.attempts + 1, finished_at: new Date().toISOString(), error: null }).eq("id", item.id);
        succeeded++;
      } catch (cause) {
        await db.from("sync_outbox").update({ state: "pending", attempts: item.attempts + 1, available_at: new Date(Date.now() + 60000).toISOString(), error: String(cause) }).eq("id", item.id);
        failed++;
      }
    }
    return json({ ok: true, processed: pending?.length || 0, succeeded, failed });
  }

  return json({ error: "Unknown action" }, 400);
});
