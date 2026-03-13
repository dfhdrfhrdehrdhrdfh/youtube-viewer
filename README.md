# NPC Viewers

Containerized video viewer using [Puppeteer](https://pptr.dev/), [Tor](https://www.torproject.org/) rotating proxies, and [Docker](https://www.docker.com/).

> **Disclaimer:** For educational purposes only. Do not use to artificially inflate view counts or violate any platform's Terms of Service.

## Features

- **Web Dashboard** — Manage agents, view logs, and monitor system stats from a browser UI on port 8093
- **Tor Proxy** — Separate container with rotating SOCKS ports and unique exit IPs per agent
- **Immediate Stop** — Agents terminate instantly when stopped (no waiting for rounds)
- **Idle Mode** — Starts clean without any agents when no `VIDEO_URLS` is configured
- **Efficient Resources** — Proper browser cleanup and garbage collection to minimize idle RAM
- **Optional WireGuard VPS Tunnel** — Routes Tor traffic through your VPS
- **Single `.env` file** for all configuration
- **One-command VPS setup** with auto-generated keys
- Works with [Arcane](https://github.com/Xerobase/Arcane) or Docker CLI

## Quick Start

### Option A — Standard (no tunnel)

```bash
cp .env.example .env
nano .env                  # optionally set VIDEO_URLS (or leave empty for idle mode)
docker compose up -d
docker compose logs -f     # verify
```

Or with **Arcane**: paste [`docker-compose.yml`](docker-compose.yml) + [`.env.example`](.env.example), optionally set `VIDEO_URLS`, deploy.

The web dashboard is available at **http://localhost:8093**. If `VIDEO_URLS` is left empty, the app starts in idle mode — create agents from the dashboard.

### Option B — WireGuard VPS Tunnel

**1. Deploy receiver on your VPS** (requires UDP port 51821 open):

```bash
docker run -d --name npc-wg-server \
  --restart unless-stopped \
  --cap-add NET_ADMIN \
  --sysctl net.ipv4.ip_forward=1 \
  -p 51821:51821/udp \
  -v npc-wg-data:/config \
  ghcr.io/dfhdrfhrdehrdhrdfh/npc-viewers-vps:latest \
&& sleep 3 && docker logs npc-wg-server 2>&1
```

The output will display `VPS_IP`, `WG_SERVER_PUBLIC_KEY`, and `WG_CLIENT_PRIVATE_KEY`. Copy these values.

**2. Deploy on your home server:**

```bash
cp .env.example .env
nano .env                  # optionally set VIDEO_URLS, TUNNEL_ENABLED=true, VPS_IP, keys
docker compose -f docker-compose.tunnel.yml up -d
```

Or with **Arcane**: paste [`docker-compose.tunnel.yml`](docker-compose.tunnel.yml) + [`.env.example`](.env.example), fill in the values, deploy.

## Configuration

All settings are in `.env` (see [`.env.example`](.env.example) for defaults and documentation):

| Variable | Default | Description |
|---|---|---|
| `VIDEO_URLS` | *(empty — idle mode)* | Comma-separated video URLs. Optional — leave empty to manage via web UI. |
| `TOR_ENABLED` | `true` | Enable Tor proxy |
| `BATCH_COUNT` | `6` | Parallel browser instances |
| `TOTAL_COUNT` | `96` | Total view actions |
| `VIEW_DURATION` | `50` | Avg view duration in seconds (±16.6%) |
| `TUNNEL_ENABLED` | `false` | Route Tor traffic through WireGuard VPS tunnel |
| `VPS_IP` | *(empty)* | VPS public IP (tunnel mode) |
| `WG_SERVER_PUBLIC_KEY` | *(empty)* | Server public key from VPS setup |
| `WG_CLIENT_PRIVATE_KEY` | *(empty)* | Client private key from VPS setup |

See `.env.example` for additional settings (`TOR_START_PORT`, `VIEW_ACTION_COUNT`, `PAGE_DEFAULT_TIMEOUT`, image tags, debug flag).

## Troubleshooting

Check logs for each container:

```bash
docker compose logs -f tor          # Tor bootstrap + SOCKS connections
docker compose logs -f npcviewers   # Viewer status + routing verification
docker compose logs -f wg-tunnel    # Tunnel connectivity (tunnel mode only)
```

**Common issues:**

| Symptom | Fix |
|---|---|
| `Could not ping VPS server` | Check `VPS_IP`, keys, and that UDP 51821 is open on VPS |
| `SOCKS port → UNREACHABLE` | Wait for Tor to bootstrap (30–60s) |
| `⚠ Routing SUSPECT` | Verify `TOR_ENABLED=true` and Tor has bootstrapped |
| `WARNING: Could not set default route` | Use `docker-compose.tunnel.yml` (needs `NET_ADMIN`) |

## VPS Management

```bash
# View keys again
docker logs npc-wg-server

# Restart
docker restart npc-wg-server

# Generate new keys
docker rm -f npc-wg-server && docker volume rm npc-wg-data
# Re-run the deploy command

# Full cleanup
docker rm -f npc-wg-server 2>/dev/null; docker volume rm npc-wg-data 2>/dev/null; \
  docker rmi ghcr.io/dfhdrfhrdehrdhrdfh/npc-viewers-vps:latest 2>/dev/null
```

## License

Educational use only. See disclaimer above.
