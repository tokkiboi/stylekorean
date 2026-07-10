(function (root, factory) {
  const api = factory();

  if (root) {
    root.TrackingLinks = api;
    root.getTrackingUrl = api.getTrackingUrl;
    root.formatTrackingLinks = api.formatTrackingLinks;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const OCEAN_CONTAINER_RE = /\b[A-Z]{4}[\s-]?\d{7}\b/i;
  const UPS_RE = /\b1Z[A-Z0-9]{16}\b/i;
  const USPS_RE = /\b9[234]\d{17,21}\b/;
  const DHL_RE = /\b(?:JJD|JD)[A-Z0-9]{6,}\b/i;
  const TRACKING_TOKEN_RE = /\b(?:1Z[A-Z0-9]{16}|[A-Z]{4}[\s-]?\d{7}|(?:JJD|JD)[A-Z0-9]{6,}|\d{10,22})\b/gi;

  function splitTrackingItems(value) {
    const text = String(value || "").trim();
    if (!text) return [];

    return text
      .split(/\r?\n|[,;|]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .flatMap(item => {
        const matches = item.match(TRACKING_TOKEN_RE) || [];
        return matches.length > 1 ? matches : [item];
      });
  }

  function extractTrackingId(value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return "";

    const ups = text.match(UPS_RE);
    if (ups) return ups[0];

    const ocean = text.match(OCEAN_CONTAINER_RE);
    if (ocean) return ocean[0].replace(/[\s-]/g, "");

    const dhl = text.match(DHL_RE);
    if (dhl) return dhl[0];

    const usps = text.match(USPS_RE);
    if (usps) return usps[0];

    const compact = text.replace(/[\s-]/g, "");
    if (/^[A-Z0-9]{8,30}$/.test(compact)) return compact;

    return "";
  }

  function buildCarrierContext(row, trackingId) {
    const safeRow = row || {};
    return [
      safeRow["Carrier Type"],
      safeRow["Carrier"],
      safeRow["Shipping Line"],
      safeRow["Steamship Line"],
      safeRow["Line"],
      safeRow["SSL"],
      safeRow["Shipment #"],
      safeRow["MBL"],
      safeRow["HBL"],
      safeRow["VSL"],
      trackingId
    ]
      .map(value => String(value || "").toUpperCase())
      .join(" ")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  }

  function hasWord(context, word) {
    return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(context);
  }

  function getTrackingUrl(value, row) {
    const trackingId = extractTrackingId(value);
    if (!trackingId) return "";

    const context = buildCarrierContext(row, trackingId);
    const prefix = trackingId.slice(0, 4);
    const encoded = encodeURIComponent(trackingId);

    if (UPS_RE.test(trackingId) || hasWord(context, "UPS")) {
      return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
    }

    if (USPS_RE.test(trackingId) || hasWord(context, "USPS")) {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    }

    if (DHL_RE.test(trackingId) || hasWord(context, "DHL")) {
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
    }

    if (context.includes("FEDEX") || hasWord(context, "FDX")) {
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    }

    if (prefix === "SMCU" || context.includes("SM LINE") || context.includes("SMLINE") || context.includes("SMLM")) {
      return `https://esvc.smlines.com/smline/CUP_HOM_3301GS.do?_search=false&f_cmd=121&page=1&rows=10000&search_name=${encoded}&search_type=C&sidx=&sord=asc`;
    }

    if (prefix === "HMMU" || hasWord(context, "HMM") || context.includes("HDMU") || context.includes("HYUNDAI MERCHANT MARINE")) {
      return `https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do?searchType=cntr&searchNo=${encoded}`;
    }

    if (["MAEU", "MSKU", "MRSU"].includes(prefix) || context.includes("MAERSK")) {
      return `https://www.maersk.com/tracking/${encoded}`;
    }

    if (prefix === "KMTU" || context.includes("KMTC") || context.includes("KORP") || context.includes("KOREA MARINE TRANSPORT")) {
      return "https://www.ekmtc.com/index.html";
    }

    if (prefix === "ONEU" || hasWord(context, "ONE") || context.includes("ONEY") || context.includes("PUSM") || context.includes("OCEAN NETWORK EXPRESS")) {
      return `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?ctrack-field=${encoded}&trakNoParam=${encoded}`;
    }

    return "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function formatTrackingLinks(value, row) {
    return splitTrackingItems(value)
      .map(item => {
        const trackingId = extractTrackingId(item);
        const url = getTrackingUrl(item, row);
        if (!url) return escapeHtml(item);

        const label = trackingId || String(item).trim();
        return `<a class="tracking-link" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer" title="Open carrier tracking for ${escapeAttribute(label)}" aria-label="Track ${escapeAttribute(label)}">${escapeHtml(item)}</a>`;
      })
      .join("<br>");
  }

  return {
    splitTrackingItems,
    extractTrackingId,
    getTrackingUrl,
    formatTrackingLinks
  };
});
