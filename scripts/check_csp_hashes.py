#!/usr/bin/env python3
"""Check that the CSP script-src hashes in _headers match the inline scripts.

Every inline <script> (one without a src attribute) in the site's HTML files
is hashed with SHA-256, the same way browsers do it. The resulting set must
equal the set of 'sha256-...' sources in the script-src directive of _headers:

  * a missing hash means the browser will block that script on the live site;
  * a leftover hash means the policy still allows code that no longer exists.

Usage:
  python3 scripts/check_csp_hashes.py         # check only, exit 1 on mismatch
  python3 scripts/check_csp_hashes.py --fix   # rewrite _headers in place

Standard library only, so it runs on any machine or CI runner with Python 3.
"""
import base64
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HEADERS = ROOT / "_headers"

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.S | re.I)
SRC_ATTR_RE = re.compile(r"\bsrc\s*=", re.I)
HANDLER_RE = re.compile(r"<[a-z][^>]*\son[a-z]+\s*=", re.I)
SCRIPT_SRC_RE = re.compile(r"(script-src\s)([^;\r\n]*)", re.I)
HASH_RE = re.compile(r"'sha256-[A-Za-z0-9+/=]+'")


def inline_script_hashes():
    """Return {hash_source: [where it came from, ...]} for all inline scripts."""
    found, problems = {}, []
    for page in sorted(ROOT.rglob("*.html")):
        if ".git" in page.parts:
            continue
        rel = page.relative_to(ROOT)
        text = page.read_text(encoding="utf-8")
        for m in SCRIPT_RE.finditer(text):
            if SRC_ATTR_RE.search(m.group(1)):
                continue  # external script, covered by host sources, not hashes
            digest = hashlib.sha256(m.group(2).encode("utf-8")).digest()
            source = "'sha256-" + base64.b64encode(digest).decode() + "'"
            line = text.count("\n", 0, m.start()) + 1
            found.setdefault(source, []).append(f"{rel}:{line}")
        for m in HANDLER_RE.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"{rel}:{line}: inline event handler (onclick= etc.) "
                            "is blocked by this CSP; move it into a script")
    return found, problems


def main():
    fix = "--fix" in sys.argv[1:]
    headers = HEADERS.read_text(encoding="utf-8")
    m = SCRIPT_SRC_RE.search(headers)
    if not m:
        print("_headers: no script-src directive found")
        return 1

    declared = HASH_RE.findall(m.group(2))
    expected, problems = inline_script_hashes()

    missing = [h for h in expected if h not in declared]
    stale = [h for h in declared if h not in expected]

    for h in missing:
        print(f"MISSING  {h}  (needed by {', '.join(expected[h])})")
    for h in stale:
        print(f"STALE    {h}  (no inline script has this hash any more)")
    for p in problems:
        print(f"WARNING  {p}")

    if not missing and not stale:
        print(f"OK: {len(expected)} inline script hash(es) in _headers are up to date.")
        return 1 if problems else 0

    if fix:
        others = HASH_RE.sub("", m.group(2)).split()
        new_value = " ".join(others + list(expected))
        headers = headers[:m.start(2)] + new_value + headers[m.end(2):]
        HEADERS.write_text(headers, encoding="utf-8")
        print("Rewrote script-src in _headers. Review and commit the change.")
        return 1 if problems else 0

    print("\n_headers is out of date. Run: python3 scripts/check_csp_hashes.py --fix")
    return 1


if __name__ == "__main__":
    sys.exit(main())
