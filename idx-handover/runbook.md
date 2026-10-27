# Rad Games — Runbook for the IDX self-host server

**Audience:** IDX IT (preferred) or the product owner, executing on `3.104.233.90`.
**Written by:** the Rad Games team. Nothing here needs anyone from our side: the server
pulls pre-built images from a public registry; we have no inbound access to it.

Read this top to bottom once before starting. Every command is copy-pasteable.

---

## 0. What runs on this server (and what does not)

| | Brand | Container | Host address | Public URL (once DNS + TLS exist) |
|---|---|---|---|---|
| 1 | Imaging Queensland | `radgames-imaging-queensland` | `127.0.0.1:3001` → container `:3000` | `https://games.imagingqueensland.com.au` |
| 2 | The Xray Group | `radgames-the-xray-group` | `127.0.0.1:3002` → container `:3000` | `https://games.thexraygroup.com.au` |

- **Two containers only.** The neutral Rad Games master instance stays on Railway and is
  **not** part of this server or this bundle.
- Runtime inside the container: **Bun** (not Node), serving the site and its JSON API over
  plain **HTTP on port 3000**.
- Data: each container keeps its own **SQLite database on a persistent Docker volume**
  (`/app/data/leaderboard.db`, plus daily snapshots in `/app/data/backups/`). Data survives
  restarts, image updates and `docker compose down`.
- **No outbound network calls at runtime.** All analytics are first-party and stored in the
  container's own database.
- Health definition: **`GET /` returns HTTP 200**; `GET /api/leaderboard` returns JSON.

Ports 3001 and 3002 are bound to **loopback only** — they are not reachable from the network.
IDX's reverse proxy on 80/443 terminates TLS and forwards to them.

Bundle contents:

```
docker-compose.yml          the stack (PRIMARY deployment mode)
.env.example                environment template — copy to .env, set the passcode
runbook.md                  this file
SECURITY-POSTURE.md         one page for IT review
smoke-checklist.md          post-deploy verification checklist
migration-notes.md          open decision: fresh board vs carry-over (owner to decide)
Caddyfile                   OPTIONAL alternative (self-service TLS) — not the primary mode
docker-compose.caddy.yml    OPTIONAL alternative stack — see §11
handover-to-idx-it.md       earlier context: DNS records, keys, network facts
```

---

## 1. Install Docker + the compose plugin (Ubuntu 24.04)

Distro packages are fine for this workload.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
docker --version            # expect Docker version 2x.x
docker compose version      # expect Docker Compose version v2.x
```

If `docker compose version` reports "command not found" but `docker-compose version` works,
the plugin package is missing: `sudo apt install -y docker-compose-v2` (do **not** use the
old `docker-compose` v1 binary — this stack uses compose file features v1 cannot parse).

Run the remaining commands either as `root` (e.g. `sudo -i`) or as a user in the `docker`
group (`sudo usermod -aG docker <user>` then log out and back in). The examples assume root;
drop `sudo` if your user is in the `docker` group.

Confirm the daemon starts on boot:

```bash
systemctl is-enabled docker     # enabled
systemctl is-active docker      # active
```

---

## 2. Create the deployment directory

```bash
sudo mkdir -p /opt/radgames
sudo cp docker-compose.yml .env.example /opt/radgames/
cd /opt/radgames
```

Result: `/opt/radgames/docker-compose.yml` and `/opt/radgames/.env.example`.
All commands below run from `/opt/radgames`.

---

## 3. Create `.env` with a real admin passcode

The passcode protects the leaderboard's admin actions (clearing the board) and the `/admin`
analytics dashboard. **Someone at IDX / the owner generates the value and holds it.** IT just
pastes it in — no one else needs the plaintext.

```bash
cd /opt/radgames
printf 'LEADERBOARD_ADMIN_PASSCODE=%s\n' "$(openssl rand -hex 24)" | sudo tee .env
sudo chmod 600 .env
```

- The generated value is a 48-character hex string. Store it in your password manager
  (IDX should hold a copy too).
- **Do not use the app's built-in fallback passcode (`clear2026`).** `docker-compose.yml`
  deliberately has no default; if `.env` is missing or empty the stack refuses to start with
  a clear error message. That is intentional.
- `.env` must never be committed to source control or emailed as an attachment.
- To change the passcode later: edit `.env`, then `docker compose up -d` (both containers
  restart, ~10 s, data untouched).

Check that compose can see the file:

```bash
sudo docker compose config | grep -c LEADERBOARD_ADMIN_PASSCODE   # expect 2
```

---

## 4. Pull the pinned images

```bash
cd /opt/radgames
sudo docker compose pull
```

- Both images come from the public Docker Hub repository `rgmjburns/lightbox-play`, pinned
  **by digest** in `docker-compose.yml` — the server fetches exactly the builds we verified.
- Expect roughly 1.1 GB of downloads on first pull (two images, ~568 MB each) and a few
  minutes on a typical AWS egress link. The 80 GB disk is ample.
- If Docker Hub rate-limits an anonymous pull (`toomanyrequests`), wait a few minutes and
  re-run — it is a per-IP limit on anonymous pulls, not an error in the stack.

Optional integrity check — the digests must match the compose file exactly:

```bash
sudo docker image inspect --format '{{index .RepoDigests 0}}' \
  rgmjburns/lightbox-play@sha256:53d5317d8e62dfca0e3a898efa4e69047a3d0eff87d40927425cc15335faa21c
sudo docker image inspect --format '{{index .RepoDigests 0}}' \
  rgmjburns/lightbox-play@sha256:6e188530d393aab96e0b32360a60771bf97d1a7d1ef286c888a311d04d978d54
```

---

## 5. Start the stack

```bash
cd /opt/radgames
sudo docker compose up -d
sudo docker compose ps
```

Expected: both services `running`, and after ~10–60 s the `STATUS` column shows `(healthy)`.
The first boot also creates each brand's SQLite database on its volume.

Watch the boot if you want to see it:

```bash
sudo docker compose logs -f imaging-queensland
# Ctrl-C to stop following; the containers keep running
```

**Benign log lines you can ignore on first boot:**

- `sudo: command not found` / `sudo: ... operation not permitted` — the app's start script
  tries to free port 3000 with `sudo`; in a fresh container nothing holds the port, the failure
  is handled deliberately, and the server binds normally. This is expected with the hardening
  in place.
- `railway-entrypoint: seeded /app/data/leaderboard.db from frozen data` — first-boot seed
  copy. See §12 for what that seed contains and the one-off cleanup.

If a container goes `unhealthy` or restarts in a loop, go to §10.

---

## 6. Verify on the server itself (before DNS or TLS exist)

Health check — `GET /` must return HTTP 200 for both ports:

```bash
curl -sS -o /dev/null -w 'IQ  / -> %{http_code}\n'  http://127.0.0.1:3001/
curl -sS -o /dev/null -w 'TXG / -> %{http_code}\n'  http://127.0.0.1:3002/
```

Board API — must return JSON (`{"ok":true,...}`, an empty list is expected initially):

```bash
curl -sS http://127.0.0.1:3001/api/leaderboard
curl -sS http://127.0.0.1:3002/api/leaderboard
```

Admin dashboard loads (passcode-protected; a login prompt or 401/403 is fine — what matters
is that the page is served):

```bash
curl -sS -o /dev/null -w 'IQ  /admin -> %{http_code}\n'  http://127.0.0.1:3001/admin
curl -sS -o /dev/null -w 'TXG /admin -> %{http_code}\n'  http://127.0.0.1:3002/admin
```

Docker's own health state:

```bash
sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}'
sudo docker inspect --format '{{.Name}} {{.State.Health.Status}}' \
  radgames-imaging-queensland radgames-the-xray-group
```

> **About the healthcheck.** The image is built on a slim Debian rootfs that does not
> guarantee `curl` or `wget`, so the container healthcheck is implemented with Bun itself
> (always present in the image):
> `bun -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"`.
> If you would rather health-check from outside the container, use the `curl` commands above
> from cron/monitoring and the container healthcheck can stay as is (or be removed).

---

## 7. After DNS and TLS exist (IDX's side)

Prerequisite: both A records point at `3.104.233.90` (see `handover-to-idx-it.md` §1), and
IDX's proxy serves HTTPS for the two hostnames.

Reverse-proxy requirement — forward the **whole** request to the right loopback port:

| Hostname | Upstream |
|---|---|
| `games.imagingqueensland.com.au` | `http://127.0.0.1:3001` |
| `games.thexraygroup.com.au` | `http://127.0.0.1:3002` |

Minimal nginx equivalent (for reference; use whatever IDX standardises on):

```nginx
server {
    listen 443 ssl;
    server_name games.imagingqueensland.com.au;
    # ssl_certificate / ssl_certificate_key as issued by IDX
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
# repeat for games.thexraygroup.com.au -> http://127.0.0.1:3002
```

Then verify end to end:

```bash
curl -sS -o /dev/null -w 'IQ  public / -> %{http_code}\n' https://games.imagingqueensland.com.au/
curl -sS -o /dev/null -w 'TXG public / -> %{http_code}\n' https://games.thexraygroup.com.au/
curl -sS https://games.thexraygroup.com.au/api/leaderboard
```

Browser check (open each URL in a phone or desktop browser):

- **Imaging Queensland** — mascot is **Stu**, brand logo in the top bar
  (`home-logo.png?v=4`), welcome copy says Imaging Queensland.
- **The Xray Group** — mascot is **Rex** (crimson cape placeholder until the owner's final
  artwork lands), brand logo in the top bar.
- Both: the dark navy theme, the eight games, and a leaderboard that loads.

Then work through `smoke-checklist.md` and sign it off.

---

## 8. Day-2: shipping an update

An update is a **digest swap** — there is no build on this server and no access from our side.
We send you two new digest strings; you replace them in `docker-compose.yml`.

1. **Note the current digests** (this is your rollback):

   ```bash
   cd /opt/radgames
   sudo grep -n 'image:' docker-compose.yml
   cp docker-compose.yml docker-compose.yml.bak-$(date +%F)
   ```

2. **Edit the two `image:` lines** to the new digest values, e.g.

   ```yaml
   image: rgmjburns/lightbox-play@sha256:<new-iq-digest>
   image: rgmjburns/lightbox-play@sha256:<new-txg-digest>
   ```

3. **Validate, pull, apply:**

   ```bash
   sudo docker compose config >/dev/null && echo "compose OK"
   sudo docker compose pull
   sudo docker compose up -d
   sudo docker compose ps
   ```

4. **Verify** — §6 again (health 200, `/api/leaderboard` JSON, `/admin` served), then the
   browser brand check in §7. Player data is untouched: it lives on the volume, not the image.

5. **Rollback** — restore the previous file and re-apply:

   ```bash
   sudo cp docker-compose.yml.bak-YYYY-MM-DD docker-compose.yml
   sudo docker compose pull
   sudo docker compose up -d
   ```

   Rollback is safe at any time; the database is never touched by an image swap.

**Never use `docker compose down -v`** — the `-v` flag deletes the data volumes, i.e. the
month's leaderboard. Plain `docker compose down` keeps them.

Maintenance windows: a restart takes ~5–10 s per container and players simply reload the page.
Mid-evening peak is unlikely on this workload, but if you want to be careful, update outside
clinic hours.

---

## 9. Backups

What exists already, inside each container:

- `/app/data/leaderboard.db` — the live SQLite database.
- `/app/data/backups/` — the app snapshots it **daily on a rotating basis, keeping the
  newest 10 copies**. Zero configuration required.

What is **not** covered by the app: the whole volume, i.e. losing the server or the volume.
Recommend one of these, owned by IDX:

```bash
# Nightly tar of both volumes (add to cron, e.g. 02:30 daily)
sudo mkdir -p /var/backups/radgames
sudo docker run --rm \
  -v radgames_iq_data:/data -v /var/backups/radgames:/backup:ro \
  debian:bookworm-slim tar czf /backup/iq-$(date +%F).tar.gz -C /data .
sudo docker run --rm \
  -v radgames_txg_data:/data -v /var/backups/radgames:/backup:ro \
  debian:bookworm-slim tar czf /backup/txg-$(date +%F).tar.gz -C /data .
```

(On AWS, an **EBS snapshot** of the volume hosting `/var/lib/docker` is the lower-effort
option and covers everything.) Restore = stop the stack, restore the volume contents, start.

**Open question for IDX IT:** which of the two is preferred for this server, where backups
are retained, and for how long? The app's own 10 snapshots sit on the same disk as the live
database, so they do not protect against volume or server loss.

---

## 10. Logs and troubleshooting

```bash
cd /opt/radgames
sudo docker compose logs -f                      # both services
sudo docker compose logs -f imaging-queensland   # one service
sudo docker compose logs --tail=200 the-xray-group
sudo docker compose ps
```

| Symptom | Likely cause | Fix |
|---|---|---|
| `port is already allocated` | something else holds 3001/3002 | `sudo ss -ltnp \| grep -E '3001\|3002'` — stop the other process |
| Container restarts in a loop | missing/blank `.env` variable, or volume permission | `docker compose logs --tail=100 <service>`; check `.env` exists with `chmod 600` |
| `unhealthy` after 2 min | app not answering `/` | `docker compose logs`; check no proxy/iptables rule intercepts loopback |
| `toomanyrequests` on pull | Docker Hub anonymous pull limit | wait, re-run `docker compose pull` |
| Proxy returns 502 | container down, or wrong upstream port (3001 vs 3002 swapped) | `curl http://127.0.0.1:3001/` on the server, re-check proxy config |
| Disk filling | image layers from old pulls | `sudo docker image prune` (only removes images not used by a running container) |
| Log says `read-only file system` | the app tried to write outside `/app/data` | report it to the Rad Games team — do **not** simply delete `read_only: true`; the fix belongs in the image |
| Log says `operation not permitted` at start | `cap_drop: [ALL]` on a future image that needs a capability | the start-up `sudo` line is expected and harmless (see §5); if a *different* permission error blocks boot, remove the `cap_drop` block for that service and note why |

Escalation: any change to the **code or the images** comes from the Rad Games team as a new
digest. IT should not modify containers in place (no `docker exec` edits, no rebuilds) — that
would make the deployment unreproducible.

---

## 11. OPTIONAL alternative: Caddy in front (do not mix modes)

**Primary deployment mode is §2–§8:** containers on loopback + IDX's own proxy issuing the
certificates. Use Caddy **only** if IDX decides it does not want to run TLS itself.

If and only if that decision is made:

```bash
cd /opt/radgames
sudo cp docker-compose.caddy.yml Caddyfile /opt/radgames/
sudo docker compose -f docker-compose.caddy.yml up -d
```

`docker-compose.caddy.yml` publishes 80/443 publicly, runs the same two pinned images with the
same hardening, and adds a Caddy container that obtains and auto-renews Let's Encrypt
certificates for both hostnames (needs public DNS + 80/443 reachable from the internet).

**Pick one mode only.** Running both means two things fight over ports 80/443 — and if IDX's
proxy and Caddy both answer, certificate issuance fails. `docker-compose.caddy.yml` is a
complete standalone file: it must never be combined with `docker-compose.yml` in the same
`docker compose up`. Never run `docker compose -f docker-compose.yml -f
docker-compose.caddy.yml` — the two files bind the same ports.

Responsibilities in Caddy mode: certificate renewal is automatic (Caddy), and the certificate
material lives in the `caddy_data` volume — back that volume up too, or you will re-issue
certificates on restore (harmless, just rate-limited if done repeatedly).

---

## 12. Known first-boot detail: the image's seed database

The image boots by copying a bundled seed database into `/app/data` **only when no database
exists yet**. That seed is an old snapshot (August 2026) and contains nine score rows with
nicknames from that period. It does **not** show on the leaderboard, because the board only
ever displays the current UTC month — but the rows physically exist on a brand-new volume
until the next monthly rollover purges them.

Two options, both fine:

- **Leave it** — invisible to players, purged automatically at the next 1st-of-month rollover.
- **Start genuinely clean** (recommended if IDX prefers that no inherited row exists), run
  once, before the first `docker compose up -d` that patients will see:

  ```bash
  cd /opt/radgames
  sudo docker compose up -d          # creates the volumes
  sudo docker compose stop           # app stopped, volumes intact
  sudo docker compose run --rm --no-deps imaging-queensland bun -e '
    import { Database } from "bun:sqlite";
    const db = new Database("/app/data/leaderboard.db");
    const n = db.query("DELETE FROM scores").run().changes;
    console.log("cleared", n, "inherited rows");
    db.close();'
  sudo docker compose run --rm --no-deps the-xray-group bun -e '
    import { Database } from "bun:sqlite";
    const db = new Database("/app/data/leaderboard.db");
    const n = db.query("DELETE FROM scores").run().changes;
    console.log("cleared", n, "inherited rows");
    db.close();'
  sudo docker compose up -d
  ```

  `--no-deps` keeps it to one container; `run` uses the same image, volume and hardening.
  This is also the safest way to inspect the database (`SELECT COUNT(*) FROM scores`).

---

## 13. Who to ask

| Topic | Owner |
|---|---|
| New image digests, code changes, product behaviour | Rad Games team (owner: Megan) |
| Admin passcode value | IDX / owner — generated once, stored in a password manager |
| Backups, retention, disk, patching, certificate issuance | IDX IT |
| DNS records | IDX IT (Netregistry zones) |
| Network access to the server (SSH, Tailscale) | IDX IT — SSH key auth only, over the Tailscale 100.x address |
