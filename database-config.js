"use strict";

/* The publishable key is safe in the browser when RLS is enabled. Never place
   a Supabase secret/service-role key here. Set enabled and preferDatabase only
   after migrations and the initial source sync have completed. */
window.STYLEKOREAN_DATABASE = Object.freeze({
  enabled: false,
  preferDatabase: false,
  url: "",
  publishableKey: "",
  allowedDomain: "stylekoreanus.com"
});
