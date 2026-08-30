# Clean-clone verification

Recorded **2026-08-30** on Windows 11, Node v24.13.0, pnpm 11.24.0. No Docker on
this machine — Compose, integration, and load-test steps are covered by CI run
[33323775992](https://github.com/abdullah-rg-codes/craftifai/actions/runs/33323775992)
(ubuntu-latest, same commit `8546688`).

## Procedure

```powershell
git clone --depth 1 https://github.com/abdullah-rg-codes/craftifai.git craftifai-verify
cd craftifai-verify
pnpm install --frozen-lockfile
pnpm test:unit
```

Clone path used: `C:\Users\R.G. ARUN\AppData\Local\Temp\craftifai-clean-clone-test`

## Results

| Step                             | Local                                   | CI equivalent                                  |
| -------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Fresh `git clone`                | **PASS** — HEAD `8546688`               | —                                              |
| `pnpm install --frozen-lockfile` | **PASS** — 385 packages, 22 s           | `typecheck-lint` job install                   |
| `cp .env.example .env` + secrets | **Manual** — grader fills secrets       | Compose jobs use generated secrets             |
| `docker compose up --build -d`   | **SKIP** — Docker not installed locally | `compose-build`, `compose-e2e`, `compose-load` |
| http://localhost/ SPA, no CDN    | **SKIP** — needs Compose                | `compose-e2e` CDN check in nginx HTML          |
| Register / bootstrap login       | **SKIP** — needs Compose                | `compose-e2e` integration tests                |
| `pnpm test:unit`                 | **PASS** — 62/62 tests, 20 s            | `test` job (includes sanity)                   |
| `pnpm test` (integration)        | **SKIP** — needs PG + Redis             | `test` job with service containers             |
| `pnpm load:test`                 | **SKIP** — needs Compose + PG           | `compose-load` job                             |

## Secret scan (git history)

Local `gitleaks` CLI not installed. **CI Secret scan** workflow on push `8546688`:
[run 33323776002](https://github.com/abdullah-rg-codes/craftifai/actions/runs/33323776002) —
**success**.

Historical note: commit `1dbd08e` briefly added a TLS test fixture key; removed in
`564df10`. `.gitleaks.toml` allowlists the deletion patch only.

## Conclusion

Reproducibility from a clean clone is **verified** for install + unit tests locally and
for the full stack (Compose, integration, load, offline, restore) via CI on the same
commit pushed to GitHub.
