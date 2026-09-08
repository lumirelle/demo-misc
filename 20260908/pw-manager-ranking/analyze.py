#!/usr/bin/env python3
"""Analyze 2025-2026 CVEs: response days + CVSS severity."""
import json
from datetime import datetime

with open("data/nvd_raw.json", encoding="utf-8") as f:
    raw = json.load(f)

def parse(t): return datetime.fromisoformat(t.replace("Z", ""))

print(f"{'manager':<12} {'CVE':<16} {'pub':<10} {'resp_days':>9} {'cvss':>5} {'sev':<8} desc[:80]")
for name, cves in raw.items():
    recent = [c for c in cves if c["published"][:4] in ("2025", "2026")]
    print(f"\n### {name}: {len(recent)} CVEs in 2025-2026")
    for c in sorted(recent, key=lambda x: x["published"]):
        resp = (parse(c["lastModified"]) - parse(c["published"])).days
        print(f"  {c['id']:<16} {c['published'][:10]} {resp:>6}d  {str(c['cvss'] or '-'):>5} {str(c['severity'] or '-'):<8} {c['desc'][:75]}")
