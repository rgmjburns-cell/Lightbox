# Rad Games — Security posture summary (for IDX IT review)

Scope: the two containers on `3.104.233.90` (Imaging Queensland + The Xray Group) deployed
from `docker-compose.yml` in this bundle. The master instance on Railway is out of scope.

## 1. Network exposure

| Port | Bound to | Who can reach it | Purpose |
|---|---|---|---|
| 22 | server | approved IPs / Tailscale tailnet only | SSH administration (key auth) |
| 80 / 443 | server | public | IDX reverse proxy — **the only public entry point** |
| 3001 | `127.0.0.1` inside the server | the proxy on the same host | Imaging Queensland container |
| 3002 | `127.0.0.1` inside the server | the proxy on the same host | The Xray Group container |

- Container ports are **loopback-only** (`ports: "127.0.0.1:3001:3000"`). Nothing is exposed to
  the LAN or the internet except through the proxy.
- No container-to-container traffic; no inbound connections from the Rad Games team (the
  server pulls updates itself — see §5).
- The app makes **no outbound network calls** at runtime (analytics are first-party, stored in
  the local SQLite database). No third-party SDKs or analytics.

## 2. TLS

- TLS is terminated at **IDX's reverse proxy** (primary mode). IDX issues and renews the
  certificates for `games.imagingqueensland.com.au` and `games.thexraygroup.com.au`;
  renewal timing and monitoring are **IDX's responsibility**.
- Traffic from the proxy to the containers crosses loopback only (no wire, no TLS needed).
- Alternative mode (§11 of the runbook) hands certificate issuance to Caddy with automatic
  Let's Encrypt renewal — used only if IDX decides not to terminate TLS itself.

## 3. Secrets

- **One secret exists: the admin passcode.** It protects the leaderboard's admin actions
  (clearing a board) and the `/admin` analytics dashboard.
- It is supplied **only via the environment** — `.env` next to `docker-compose.yml`,
  `chmod 600`, owned by the deploy account. It is not in any image, not in source control, and
  not in the compose file.
- The application code contains a fallback value (`clear2026`) for local development.
  **It must never be live.** `docker-compose.yml` therefore declares the variable with no
  default (`${LEADERBOARD_ADMIN_PASSCODE:?...}`): the stack physically will not start unless a
  real value is set.
- **Who does what:** the owner/operator generates the value (`openssl rand -hex 24`) and holds
  it; IT pastes it into `.env` at setup. Rotation = edit `.env` + `docker compose up -d`.
- The registry credential model is "none": the images are public pulls, so there are no
  registry secrets on the server.

## 4. Host access and keys

- SSH key authentication only; no passwords.
- **Megan (owner) is the maintainer.** Her ed25519 key was added by IT. Tailscale is installed on
  the server; she joins the node to her own tailnet (free tier) and connects to the stable
  **100.x** tailnet address instead of allow-listing her dynamic Starlink egress IP. The
  firewall still restricts port 22; Tailscale is an address path, not a replacement for
  key auth — key auth stays on.
- **Rotation:** revoke by removing her key from the server's `authorized_keys` (or from the
  Tailscale admin console removing the node), then issue/set up a new key for her successor.
  No application secret is tied to the key, so revoking access requires no redeploy.
- **Revocation on role change / device loss:** remove the key + remove the device from the
  tailnet; rotate the admin passcode at the same time (§3) as a precaution.
- The Rad Games team holds **no** key, no SSH route and no IP allow-list entry on this server.
  If a server-side action is ever needed, it is performed by IT or the owner from this runbook.

## 5. Image provenance and integrity

- Images are pulled from the public Docker Hub repository **`rgmjburns/lightbox-play`**.
- `docker-compose.yml` pins **both images by digest** (`@sha256:…`), not by tag. A digest is the
  cryptographic hash of the image manifest: the server gets byte-identical content every time,
  and an update can only happen when someone deliberately edits that line.
- Images are built in our pipeline from source (one master codebase, one build per brand) and
  are two-brand variants of the same code — game logic and data behaviour are identical; the
  per-brand differences are configuration only (name, logo, mascot, colour).
- Tags `:imaging-queensland` / `:the-xray-group` also exist but are **for human reference
  only**. Never deploy by tag: a tag can be moved, a digest cannot.

## 6. Container hardening in compose (already applied)

- `read_only: true` — root filesystem is immutable; only `/app/data` (the volume) and `/tmp`
  (tmpfs) are writable. An exploited process cannot persist a payload in the image.
- `cap_drop: [ALL]` — no Linux capabilities are granted. The app listens on an unprivileged
  port and writes its own volume, so it needs none.
- `security_opt: ["no-new-privileges:true"]` — the process can never gain privileges via setuid
  binaries.
- `mem_limit: 512m` / `memswap_limit: 1g`, `pids_limit: 256`, `cpus: 1.0` — one container cannot
  starve the other or the host (4 GB box).
- `restart: unless-stopped` — recovers automatically after a crash or host reboot.
- Logs are bounded (`json-file`, 3 × 10 MB per container) so they cannot fill the 80 GB disk.

## 7. Known gap — the image runs as root inside the container

The image has **no non-root `USER`**. Processes inside the container run as UID 0. This is a
container-local root (not host root) and is heavily constrained by §6, but it is a real gap
against a "runs as non-root" policy and we are stating it plainly.

Mitigations currently in place: read-only rootfs, all capabilities dropped, no-new-privileges,
loopback-only ports, no host mounts (named volume only), no outbound calls, no secrets in the
image.

**Status: image hardening to non-root is a follow-up if IDX requires it before go-live.** It
requires an image change on our side (add a `USER` + volume ownership) and a new digest —
tell us and we schedule it in the next update pass.

## 8. Data handled (context for the review)

- The only identifier is a player-chosen **nickname**, plus scores. No phone, email, location,
  device identifier or movement data is collected anywhere in the code.
- Each brand has its own database; there is no cross-brand sharing.
- Names, scores and profiles are purged automatically at the monthly rollover (1st of the month,
  UTC); personal progress (badges, per-game bests) survives.
- Players can erase their own data in-app ("Clear All Data"), which deletes their rows
  server-side.
- The app keeps 10 daily database snapshots on the same volume (rotating).
- Full retention and deletion policy: `RETENTION-AND-DELETION.md` in the source repository
  (available on request).

## 9. Patching cadence — ask

Please confirm IDX's expectations for: OS/security patching of the host, Docker engine updates,
image update cadence (we propose: an update pass only when there is a code change or a
security-relevant base-image update — not a fixed calendar schedule), and how IDX wants to be
notified of new digests. There is nothing scheduled on the server itself; all updates are
pull-based and deliberate.
