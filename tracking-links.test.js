const assert = require("node:assert/strict");
const {
  splitTrackingItems,
  extractTrackingId,
  getTrackingUrl,
  formatTrackingLinks
} = require("./tracking-links.js");

assert.equal(extractTrackingId("SMCU 1284520"), "SMCU1284520");
assert.equal(extractTrackingId("container: HMMU1234567"), "HMMU1234567");
assert.deepEqual(splitTrackingItems("SMCU1284520, HMMU1234567\nONEU7654321"), [
  "SMCU1284520",
  "HMMU1234567",
  "ONEU7654321"
]);

assert.match(getTrackingUrl("SMCU1284520", { "Carrier Type": "Ocean" }), /smlines\.com/);
assert.match(getTrackingUrl("HMMU1234567", { "Carrier Type": "Ocean" }), /hmm21\.com/);
assert.match(getTrackingUrl("KMTU1234567", { "Carrier Type": "Ocean" }), /ekmtc\.com/);
assert.match(getTrackingUrl("ONEU1234567", { "Carrier Type": "Ocean" }), /one-line\.com/);
assert.match(getTrackingUrl("MSKU1234567", { "Carrier Type": "Ocean" }), /maersk\.com/);
assert.match(getTrackingUrl("1Z999AA10123456784", { "Carrier Type": "UPS" }), /ups\.com/);
assert.match(getTrackingUrl("9400111899223856928499", { "Carrier Type": "USPS" }), /usps\.com/);
assert.match(getTrackingUrl("123456789012", { "Carrier Type": "FedEx" }), /fedex\.com/);
assert.equal(getTrackingUrl("ABCD1234567", { "Carrier Type": "Ocean" }), "");

const html = formatTrackingLinks("SMCU1284520; ONEU1234567", { "Carrier Type": "Ocean" });
assert.match(html, /SMCU1284520/);
assert.match(html, /ONEU1234567/);
assert.match(html, /noopener noreferrer/);

console.log("tracking-links tests passed");
