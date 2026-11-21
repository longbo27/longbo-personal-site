# longbo-personal-site
Personal website of Longbo Xian

## CSP hashes

`_headers` allows inline scripts by SHA-256 hash. After editing any inline `<script>`, run
`python3 scripts/check_csp_hashes.py --fix` to update the hashes. The "CSP hashes" GitHub
Action runs the same check (without `--fix`) on every push and pull request and fails if
`_headers` is out of date.
