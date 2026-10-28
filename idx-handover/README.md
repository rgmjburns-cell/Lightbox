# Self-host deployment bundle - Imaging Queensland & The Xray Group (IDX Linux server)

Everything you need to run the Imaging Queensland and The Xray Group instances on
`3.104.233.90`. No build step, and no access from my side: the server pulls
digest-pinned images and runs them with `docker compose`.

**Start here: `runbook.md`.** Then `smoke-checklist.md` to sign off.

| File | What it is |
|---|---|
| `docker-compose.yml` | **The deployment.** Two services, digest-pinned, hardened, loopback-only ports 3001/3002 → container 3000. |
| `.env.example` | Template for `.env`. It holds the one secret (admin passcode): copy it, generate a value, `chmod 600`. |
| `runbook.md` | Step-by-step install → up → verify → update → rollback → backups → logs. |
| `SECURITY-POSTURE.md` | One page for your review: ports, TLS, secrets, keys, image provenance, known gaps, Tailscale. |
| `smoke-checklist.md` | Tick-list verification, local then public. Section C purges the first-boot seed DB (`runbook.md` §12) so you sign off on a pristine board. |
| `migration-notes.md` | **Open decision:** fresh board vs carry-over (default: fresh). Both procedures written. |
| `Caddyfile`, `docker-compose.caddy.yml` | OPTIONAL alternative TLS mode (self-service Let's Encrypt). Use instead of, never alongside, IDX's proxy. |

Facts the whole bundle is consistent with:

- **Two containers on this server only.** The separate unbranded master instance stays on Railway.
- Imaging Queensland → `127.0.0.1:3001`, The Xray Group → `127.0.0.1:3002`; app listens on **3000**.
- Runtime is **Bun**; plain HTTP inside; TLS and public ports 80/443 belong to IDX's proxy.
- Health = **`GET /` → 200**; `GET /api/leaderboard` → JSON.
- No outbound network calls at runtime; data is each brand's own SQLite on a Docker volume.
- Deploy model is PULL: no inbound SSH from me, no deploy key, my IP is not allow-listed.

Images (digest-pinned; tags exist for reference only):

- Imaging Queensland - `rgmjburns/lightbox-play@sha256:53d5317d8e62dfca0e3a898efa4e69047a3d0eff87d40927425cc15335faa21c` (`:imaging-queensland`)
- The Xray Group - `rgmjburns/lightbox-play@sha256:6e188530d393aab96e0b32360a60771bf97d1a7d1ef286c888a311d04d978d54` (`:the-xray-group`)

Validated in this bundle: `docker compose config` passes for both compose files, and the stack
refuses to start if `LEADERBOARD_ADMIN_PASSCODE` is unset (no fallback passcode can go live).
