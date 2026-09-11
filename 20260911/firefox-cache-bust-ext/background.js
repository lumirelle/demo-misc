// Cache-Bust on Navigate
// Appends a fresh ?t=<epoch ms> to top-level GET navigations so the browser,
// CDN and origin app all see a never-before-seen URL.
//
// Mechanism: webRequest.onBeforeRequest + redirectUrl (needs "blocking",
// which Firefox still supports in MV2 and MV3).

const PARAM = "t";

// Empty = every host. Restrict to, e.g., ["staging.example.com", "localhost"].
const SITES = [];

// Never touch these paths: OAuth/SSO callbacks, signed links, payment flows.
const SKIP_PATH = /(?:^|\/)(?:oauth|oauth2|signin|login|logout|callback|auth|payment|checkout)(?:\/|$)/i;

// URLs we generated ourselves. They must pass through untouched, otherwise
// every redirect would trigger another redirect -> infinite loop.
const produced = new Set();

function hostMatches(url) {
  if (SITES.length === 0) return true;
  return SITES.some((h) => url.hostname === h || url.hostname.endsWith("." + h));
}

function onBeforeRequest(d) {
  if (d.type !== "main_frame") return;        // navigations only, not sub-resources
  if (d.method && d.method !== "GET") return; // rewriting a POST turns it into a GET

  if (produced.delete(d.url)) return;         // our own rewrite: let it through

  let u;
  try {
    u = new URL(d.url);
  } catch (e) {
    return;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return;
  if (!hostMatches(u)) return;
  if (SKIP_PATH.test(u.pathname)) return;

  u.searchParams.set(PARAM, Date.now());

  if (produced.size > 500) produced.clear();
  produced.add(u.href);

  return { redirectUrl: u.href };
}

browser.webRequest.onBeforeRequest.addListener(
  onBeforeRequest,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

// Firefox may serve a reload from its in-memory cache without firing
// webRequest events at all. If the redirect seems to be skipped on reload,
// uncomment this (it flushes the in-memory cache; rate-limited by
// webRequest.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES):
//
// browser.webRequest.handlerBehaviorChanged();
