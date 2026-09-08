#!/usr/bin/env python3
"""Fetch CVEs for password managers from NVD API, filter 2025-2026."""
import json, time, urllib.request, urllib.parse, sys, os

KEYWORDS = {
    "bitwarden": "bitwarden",
    "keepassxc": "keepassxc",
    "keepass": "keepass",
    "protonpass": "proton pass",
    "lastpass": "lastpass",
    "1password": "1password",
    "keepassdx": "keepassdx",
    "strongbox": "strongbox",
    "gopass": "gopass",
    "enpass": "enpass",
}

def fetch(keyword, retries=4):
    url = "https://services.nvd.nist.gov/rest/json/cves/2.0?" + urllib.parse.urlencode(
        {"keywordSearch": keyword, "resultsPerPage": 200})
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "research-script"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print(f"  retry {i+1} for {keyword}: {e}", file=sys.stderr)
            time.sleep(8)
    return None

out = {}
for name, kw in KEYWORDS.items():
    print(f"fetching: {kw} ...", file=sys.stderr)
    data = fetch(kw)
    if data is None:
        print(f"  FAILED: {kw}", file=sys.stderr)
        continue
    cves = []
    for v in data.get("vulnerabilities", []):
        c = v["cve"]
        cves.append({
            "id": c["id"],
            "published": c["published"],
            "lastModified": c["lastModified"],
            "desc": next((d["value"] for d in c["descriptions"] if d["lang"] == "en"), "")[:300],
            "cvss": (c.get("metrics", {}).get("cvssMetricV31", [{}])[0].get("cvssData", {}).get("baseScore")
                     or c.get("metrics", {}).get("cvssMetricV30", [{}])[0].get("cvssData", {}).get("baseScore")
                     or c.get("metrics", {}).get("cvssMetricV2", [{}])[0].get("cvssData", {}).get("baseScore")),
            "severity": (c.get("metrics", {}).get("cvssMetricV31", [{}])[0].get("cvssData", {}).get("baseSeverity")
                     or c.get("metrics", {}).get("cvssMetricV30", [{}])[0].get("cvssData", {}).get("baseSeverity")),
        })
    out[name] = cves
    print(f"  {name}: {len(cves)} total CVEs", file=sys.stderr)
    time.sleep(7)  # NVD rate limit: 5 req/30s without key

os.makedirs("data", exist_ok=True)
with open("data/nvd_raw.json", "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print("saved data/nvd_raw.json", file=sys.stderr)
