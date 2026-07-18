/*
 * Logistics Master 2026 relational sync foundation
 *
 * Connects the dashboard layer to the Google Apps Script API layer.
 * Configure GAS_ENDPOINT before enabling write operations.
 */

const LogisticsSync = {
  GAS_ENDPOINT: "",

  async request(action, payload = {}) {
    if (!this.GAS_ENDPOINT) {
      console.warn("Google Apps Script endpoint not configured", action);
      return null;
    }

    const response = await fetch(this.GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload })
    });

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }

    return response.json();
  },

  getOutboundSchedule() {
    return this.request("getOutboundSchedule");
  },

  getInboundSchedule() {
    return this.request("getInboundSchedule");
  },

  updateShipmentStatus(recordId, status) {
    return this.request("updateShipmentStatus", {
      recordId,
      status,
      updatedAt: new Date().toISOString()
    });
  },

  reconcileInvoices() {
    return this.request("reconcileInvoices");
  }
};

window.LogisticsSync = LogisticsSync;
