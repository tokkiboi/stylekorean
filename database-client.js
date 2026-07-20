"use strict";

(() => {
  const config = window.STYLEKOREAN_DATABASE || {};
  let client = null;

  function configured() {
    return Boolean(config.enabled && config.url && config.publishableKey && window.supabase?.createClient);
  }

  function getClient() {
    if (!configured()) return null;
    if (!client) client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  async function session() {
    const db = getClient();
    if (!db) return null;
    const { data } = await db.auth.getSession();
    return data.session;
  }

  async function signIn(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized.endsWith(`@${config.allowedDomain}`)) throw new Error(`Use your @${config.allowedDomain} email.`);
    const db = getClient();
    if (!db) throw new Error("Database is not configured yet.");
    const { error } = await db.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: location.href.split("#")[0] }
    });
    if (error) throw error;
  }

  async function signOut() {
    const db = getClient();
    if (db) await db.auth.signOut();
    await mount();
  }

  async function listShipments() {
    const db = getClient();
    if (!db || !await session()) return [];
    const { data, error } = await db.from("shipments")
      .select("*,sources(label,source_key,source_url)")
      .is("deleted_at", null)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data || [];
  }

  async function updateShipment(id, expectedVersion, patch) {
    const db = getClient();
    if (!db || !await session()) throw new Error("Sign in before editing.");
    const { data, error } = await db.rpc("update_shipment", {
      p_id: id, p_expected_version: expectedVersion, p_patch: patch
    });
    if (error) throw error;
    return data;
  }

  async function mount() {
    const status = document.getElementById("databaseStatus");
    const form = document.getElementById("databaseSignIn");
    const signOutButton = document.getElementById("databaseSignOut");
    if (!status || !form || !signOutButton) return;
    if (!configured()) {
      status.innerHTML = "<strong>Sheets fallback active</strong><span>Database activation pending · dashboard remains fully operational</span>";
      form.hidden = true;
      signOutButton.hidden = true;
      return;
    }
    const current = await session();
    status.innerHTML = current
      ? `<strong>Database connected</strong><span>${current.user.email} · realtime-ready secured workspace</span>`
      : "<strong>Database ready</strong><span>Sign in with your StyleKorean member email to edit synchronized records</span>";
    form.hidden = Boolean(current);
    signOutButton.hidden = !current;
  }

  document.addEventListener("DOMContentLoaded", () => {
    mount();
    document.getElementById("databaseSignIn")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = document.getElementById("databaseResult");
      try {
        result.textContent = "Sending secure sign-in link…";
        await signIn(new FormData(event.currentTarget).get("email"));
        result.textContent = "Check your email for the sign-in link.";
      } catch (error) { result.textContent = error.message; }
    });
    document.getElementById("databaseSignOut")?.addEventListener("click", signOut);
  });

  window.StyleKoreanDatabase = Object.freeze({ configured, session, signIn, signOut, listShipments, updateShipment, mount });
})();
