# YouTube Viewer - Docker Compose Setup

A containerized YouTube viewer using [Puppeteer](https://pptr.dev/), [Tor](https://www.torproject.org/) rotating proxies and [Docker](https://www.docker.com/).

Based on [soumyadityac/youtube-viewer](https://github.com/soumyadityac/youtube-viewer).

> **Disclaimer:** This project is intended for informational/educational purposes only. I strictly recommend against using it to artificially inflate video view counts for monetary benefits and/or other use cases that go against the YouTube Policies & Guidelines and/or the law of the land.

## Features

- **Two compose files** — `docker-compose.yml` (standard) and `docker-compose.tunnel.yml` (with WireGuard VPS tunnel) — both are complete standalone deploy options
- **Single `.env` file** for all configuration — no need to edit code files
- YouTube URLs configured via `.env` (no separate `urls.txt` needed)
- Tor proxy runs in a separate container with automatic SOCKS port configuration
- **Enhanced logging** — both containers clearly show whether they are connected and working together
- **Optional WireGuard VPS tunnel** — route Tor traffic through a WireGuard tunnel to your VPS so Tor uses the VPS as its internet uplink (disabled by default)
- **One-command VPS setup** — deploy the tunnel receiver on your VPS with a single command, keys are echoed immediately
- Fully automatic deployment — just paste a compose file and click Deploy

## Quick Start — Choose Your Setup

### Do you have a VPS?

| I have a VPS and want to tunnel traffic through it | I don't have a VPS / I just want standard Tor |
|---|---|
| Use **Option B** — WireGuard VPS Tunnel | Use **Option A** — Standard |
| `docker-compose.tunnel.yml` | `docker-compose.yml` |
| 3 containers: ytviewer + tor + wg-tunnel | 2 containers: ytviewer + tor |

---

## Option A — Standard (no VPS tunnel)

This is the simplest setup. Tor traffic exits directly from your server.

### Deploy with Arcane (recommended)

1. Create a new stack in Arcane.
2. Paste the contents of [`docker-compose.yml`](docker-compose.yml) into the **Compose** field.
3. Paste the contents of [`.env.example`](.env.example) into the **Environment** field and set your `YOUTUBE_URLS`.
4. Click **Deploy**.

Arcane (and Docker) will pull both images from GHCR and create the network and volume automatically — no cloning, no building, no extra commands.

### Deploy with Docker CLI

```bash
git clone https://github.com/dfhdrfhrdehrdhrdfh/youtube-viewer.git
cd youtube-viewer
cp .env.example .env
nano .env  # set YOUTUBE_URLS
docker-compose up -d
```

Check the logs:
```bash
docker-compose logs -f tor
docker-compose logs -f ytviewer
```

Stop:
```bash
docker-compose down
```

---

## Option B — With WireGuard VPS Tunnel

This setup routes **all Tor traffic** through a WireGuard tunnel to your VPS. Tor circuits are built using the VPS as the internet uplink instead of your local server's IP.

```
┌──────────── Home Server ──────────────┐          ┌────── VPS ──────┐
│                                        │          │                  │
│  ytviewer → tor → wg-tunnel ═══WireGuard═══════▶ wg-server → Internet
│          ytnet                         │          │                  │
└────────────────────────────────────────┘          └──────────────────┘
```

### Prerequisites

- A **VPS** with a public IP address and Docker installed
- **UDP port 51821** open on the VPS firewall
- Docker and Docker Compose on your home server

### Step 1 — Deploy VPS Receiver (one command)

SSH into your VPS and run this single command:

```bash
docker run -d --name yt-wg-server \
  --restart unless-stopped \
  --cap-add NET_ADMIN \
  --sysctl net.ipv4.ip_forward=1 \
  -p 51821:51821/udp \
  -v yt-wg-data:/config \
  ghcr.io/dfhdrfhrdehrdhrdfh/youtube-viewer-vps:latest \
&& sleep 3 && docker logs yt-wg-server 2>&1
```

This single command:
- Pulls and starts the WireGuard VPS server container
- Auto-detects your VPS public IP
- Generates WireGuard key pairs
- Enables IP forwarding and NAT masquerade
- Persists keys in a Docker volume (survives restarts)
- Auto-restarts on reboot
- **Echoes the connection keys in the same terminal window**

You'll see output like this:

```
============================================
 ✅ WireGuard VPS Server Ready!
============================================

Copy these values to your .env on your home server:

VPS_IP=107.150.20.218
VPS_WG_PORT=51821
WG_SERVER_PUBLIC_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd=
WG_CLIENT_PRIVATE_KEY=xYzAbCdEfGhIjKlMnOpQrStUvWxYz1234567890ef=

============================================
```

**Copy these 4 values** — you'll need them in the next step.

> **Note:** If you need to see the keys again later, run: `docker logs yt-wg-server`

### Step 2 — Deploy on Home Server

#### With Arcane (recommended)

1. Create a new stack in Arcane.
2. Paste the contents of [`docker-compose.tunnel.yml`](docker-compose.tunnel.yml) into the **Compose** field.
3. Paste the contents of [`.env.example`](.env.example) into the **Environment** field.
4. Fill in:
   - `YOUTUBE_URLS` — your target video URLs
   - `TUNNEL_ENABLED=true`
   - `VPS_IP` — from VPS output
   - `WG_SERVER_PUBLIC_KEY` — from VPS output
   - `WG_CLIENT_PRIVATE_KEY` — from VPS output
5. Click **Deploy**.

That's it! Docker pulls all 3 images (ytviewer, tor, wg-tunnel) and creates the network and volume automatically. The WireGuard tunnel connects to your VPS, the Tor container routes through it, and the viewer starts automatically.

#### With Docker CLI

```bash
git clone https://github.com/dfhdrfhrdehrdhrdfh/youtube-viewer.git
cd youtube-viewer
cp .env.example .env
nano .env  # set YOUTUBE_URLS and tunnel settings (VPS_IP, keys, TUNNEL_ENABLED=true)
docker-compose -f docker-compose.tunnel.yml up -d
```

Check the logs:
```bash
docker-compose -f docker-compose.tunnel.yml logs -f wg-tunnel
docker-compose -f docker-compose.tunnel.yml logs -f tor
docker-compose -f docker-compose.tunnel.yml logs -f ytviewer
```

Stop:
```bash
docker-compose -f docker-compose.tunnel.yml down
```

### Verify the Tunnel

In the **wg-tunnel** logs you should see:
```
[wg-tunnel] ✅ Tunnel to VPS server (10.13.13.1) is reachable.
[wg-tunnel] External IP through tunnel: 107.150.20.218
[wg-tunnel] ✅ Tunnel routing confirmed — external IP matches VPS IP.
```

In the **tor** logs you should see:
```
[tor-proxy] Tunnel enabled  : true
[tor-proxy] Tunnel gateway  : wg-tunnel
[tor-proxy] Resolved 'wg-tunnel' → 172.20.0.x
[tor-proxy] SUCCESS: Default route set to 172.20.0.x
[tor-proxy] Uplink IP check: 107.150.20.218
[tor-proxy]   ↳ If tunnel is working, this should be your VPS IP, NOT your local server IP.
```

The uplink IP should be your **VPS IP**, not your local server's IP.

---

## Configuration

All settings are in the `.env` file:

| Variable | Default | Description |
|---|---|---|
| `YOUTUBE_URLS` | *(required)* | Comma-separated YouTube video URLs |
| `TOR_ENABLED` | `true` | Enable/disable Tor proxy |
| `TOR_START_PORT` | `9052` | Starting port for Tor SOCKS proxies |
| `BATCH_COUNT` | `6` | Number of parallel browser instances |
| `TOTAL_COUNT` | `96` | Total number of view actions (divisible by BATCH_COUNT) |
| `VIEW_ACTION_COUNT` | `10` | Videos watched per browser session |
| `VIEW_DURATION` | `50` | Average view duration in seconds (±16.6%) |
| `PAGE_DEFAULT_TIMEOUT` | `600` | Max page timeout in seconds |
| `IMAGE_TAG` | `latest` | youtube-viewer image tag (`latest`, `beta`, or a SHA for reproducibility) |
| `TOR_IMAGE_TAG` | `latest` | tor image tag |
| `WG_IMAGE_TAG` | `latest` | wg-tunnel image tag (tunnel mode only) |
| `YOUTUBE_VIEWER_FORCE_DEBUG` | `false` | Enable debug logging |
| `TUNNEL_ENABLED` | `false` | Route Tor traffic through WireGuard VPS tunnel |
| `VPS_IP` | *(empty)* | Public IP of your VPS (tunnel mode only) |
| `VPS_WG_PORT` | `51821` | WireGuard UDP port on VPS |
| `WG_SERVER_PUBLIC_KEY` | *(empty)* | Server public key from VPS setup |
| `WG_CLIENT_PRIVATE_KEY` | *(empty)* | Client private key from VPS setup |

### Multiple URLs

You can specify multiple URLs separated by commas:

```env
YOUTUBE_URLS=https://www.youtube.com/watch?v=VIDEO1,https://www.youtube.com/watch?v=VIDEO2,https://www.youtube.com/watch?v=VIDEO3
```

## Architecture

### Standard (no tunnel)

```
docker-compose.yml
├── tor (container)         — Tor SOCKS proxy with multiple ports
│   └── Listens on ports 9052-9057 (configurable)
└── ytviewer (container)    — YouTube viewer with Puppeteer + Chromium
    └── Connects to tor:9052-9057 for anonymized browsing
```

### With WireGuard VPS Tunnel

```
docker-compose.tunnel.yml
├── wg-tunnel (container)   — WireGuard client, connects to VPS
│   └── Routes tor traffic through WireGuard tunnel to VPS
├── tor (container)         — Tor SOCKS proxy, routes through wg-tunnel
│   └── Default route points to wg-tunnel container
└── ytviewer (container)    — YouTube viewer with Puppeteer + Chromium
    └── Connects to tor:9052-9057 for anonymized browsing
```

Both setups share a private Docker network (`ytnet`). The viewer connects to the Tor container's SOCKS proxies for anonymized browsing.

## Logging & Connectivity Verification

Both containers produce detailed logs so you can verify they are actually working together.

### WireGuard tunnel logs (`docker-compose -f docker-compose.tunnel.yml logs -f wg-tunnel`)

| What you should see | Meaning |
|---|---|
| `WireGuard Tunnel Client Starting` | WireGuard client entrypoint is running |
| `WireGuard interface is up` | WireGuard interface created successfully |
| `✅ Tunnel to VPS server (10.13.13.1) is reachable` | Tunnel connectivity verified |
| `External IP through tunnel: <VPS_IP>` | Traffic exits through VPS |
| `✅ Tunnel routing confirmed` | External IP matches VPS IP |

### Tor container logs (`docker-compose logs -f tor`)

| What you should see | Meaning |
|---|---|
| `Tor Proxy Container Starting` | Tor entrypoint is running |
| `Tunnel enabled  : true/false` | Whether WireGuard tunnel routing is active |
| `Tunnel gateway  : wg-tunnel` | Routing through WireGuard tunnel container |
| `SUCCESS: Default route set to <IP>` | Tunnel routing configured successfully |
| `Uplink IP check: <IP>` | Public IP the Tor container sees — **should be VPS IP when tunnel is active** |
| `Bootstrapped 100% (done)` | Tor has connected to the Tor network |
| `New SOCKS connection opened` | **The YT viewer is routing traffic through Tor** |
| `Periodic Status` block | Repeating status (every 60s) with tunnel state and uplink IP |

### YT viewer logs (`docker-compose logs -f ytviewer`)

| What you should see | Meaning |
|---|---|
| `Tor enabled   : true` | The viewer will use Tor |
| `VPS tunnel    : ENABLED / DISABLED` | Whether WireGuard tunnel is configured |
| `Traffic route : ytviewer → tor → ...` | The full traffic path being used |
| `SOCKS port <port> → reachable (Xms)` | TCP connectivity to the Tor container confirmed |
| `All N Tor SOCKS ports are reachable` | Every proxy port is working |
| `Container direct IP : X.X.X.X` | The ytviewer container's own public IP (baseline) |
| `Tor exit IP (via WireGuard → VPS tunnel): X.X.X.X` | Exit IP through tunnel |
| `✓ Routing OK — exit IP X differs from container uplink IP Y` | **Tor is routing correctly** |

> **Key check:** Look for the `✓ Routing OK` line after each browser launch. It confirms the Tor exit IP differs from the ytviewer container's own direct IP, proving traffic is genuinely routed through Tor (and through the VPS when the tunnel is active).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| wg-tunnel shows `Could not ping VPS server` | WireGuard tunnel not established | Check VPS_IP, keys, and that UDP 51821 is open on VPS firewall |
| wg-tunnel shows `External IP does not match VPS IP` | Tunnel routing issue | Verify VPS container is running: `docker logs yt-wg-server` |
| Tor logs show `Uplink IP check` with local IP (not VPS) | Tunnel not routing | Check wg-tunnel container health, verify keys match VPS output |
| YT viewer shows `SOCKS port → UNREACHABLE` | Tor container not healthy yet | Wait for Tor to bootstrap (can take 30-60s) |
| `⚠ Routing SUSPECT` in YT viewer logs | Exit IP matches server IP | Check `TOR_ENABLED=true` and that Tor bootstrapped |
| `WARNING: Could not set default route` in Tor logs | Missing NET_ADMIN capability | Make sure you used `docker-compose.tunnel.yml` |
| Tor shows `Bootstrapped` stuck below 100% | Tor cannot reach the Tor network | Check firewall, DNS, or tunnel connectivity |
| wg-tunnel container won't start | Missing .env variables | Set VPS_IP, WG_SERVER_PUBLIC_KEY, WG_CLIENT_PRIVATE_KEY |

### VPS-side troubleshooting

```bash
# Check VPS container status
docker ps -a | grep yt-wg-server

# View VPS server logs (includes connection keys)
docker logs yt-wg-server

# Check WireGuard status on VPS
docker exec yt-wg-server wg show

# Restart VPS server
docker restart yt-wg-server

# Remove and redeploy VPS server (keys are preserved in volume)
docker rm -f yt-wg-server
# Re-run the deploy command from Step 1
```

### Home-side troubleshooting

```bash
# Check WireGuard tunnel status
docker exec wg-tunnel wg show

# Check tor container default route
docker exec tor-proxy ip route show default

# Check tor container external IP
docker exec tor-proxy wget -qO- https://api.ipify.org/
```

## Disable the Tunnel

Set `TUNNEL_ENABLED=false` in your `.env` (this is the default). Deploy with the standard `docker-compose.yml` — the WireGuard container is not included.

## VPS Server Management

### Re-deploying the VPS Server

If you need to redeploy the VPS server, keys are persisted in the `yt-wg-data` Docker volume:

```bash
docker rm -f yt-wg-server
docker run -d --name yt-wg-server \
  --restart unless-stopped \
  --cap-add NET_ADMIN \
  --sysctl net.ipv4.ip_forward=1 \
  -p 51821:51821/udp \
  -v yt-wg-data:/config \
  ghcr.io/dfhdrfhrdehrdhrdfh/youtube-viewer-vps:latest \
&& sleep 3 && docker logs yt-wg-server 2>&1
```

The same keys will be used — no need to update your home server `.env`.

### Generating New Keys

To generate completely new keys, remove the volume first:

```bash
docker rm -f yt-wg-server
docker volume rm yt-wg-data
# Re-run the deploy command — new keys will be generated
```

You will need to update the keys in your home server `.env` file.

### Complete VPS Cleanup (remove everything)

If the tunnel didn't work, you no longer need it, or you just want to start fresh — run this single command on your VPS to remove **everything** that was created by the setup command:

```bash
docker rm -f yt-wg-server 2>/dev/null; docker volume rm yt-wg-data 2>/dev/null; docker rmi ghcr.io/dfhdrfhrdehrdhrdfh/youtube-viewer-vps:latest 2>/dev/null; echo "✅ Done — all youtube-viewer VPS resources have been removed."
```

> **Note:** The command uses `;` (not `&&`) intentionally — each removal runs regardless of whether the previous one existed. This is safe to run multiple times.

This removes:
- The `yt-wg-server` container (stops it if running)
- The `yt-wg-data` volume (contains generated WireGuard keys)
- The `youtube-viewer-vps` Docker image

After running this, your VPS is back to its original state — nothing from this project remains. If you want to try again later, just re-run the one-command deploy from [Step 1](#step-1--deploy-vps-receiver-one-command).

---

## Why WireGuard?

WireGuard was chosen for the VPS tunnel after evaluating several alternatives. The key requirements were: lightweight, encrypted, Docker-friendly, single-peer point-to-point, and deployable with zero manual configuration.

| Protocol | Encrypted | Lightweight | Docker-friendly | Auto-config | Verdict |
|---|---|---|---|---|---|
| **WireGuard** | ✅ Yes | ✅ ~4K lines of code, kernel-level | ✅ Excellent | ✅ Easy | **✅ Best fit** |
| GRE / IPIP | ❌ No | ✅ Very light | ⚠ Needs `--privileged` | ⚠ Manual | ❌ No encryption |
| VXLAN | ❌ No | ⚠ Medium | ✅ Good for clusters | ❌ Complex | ❌ Overkill for 1 peer |
| SSH tunnel | ✅ Yes | ❌ High CPU (userspace) | ⚠ Awkward for full routing | ✅ Easy | ❌ Too slow |
| OpenVPN | ✅ Yes | ❌ 70K+ lines, userspace | ⚠ Complex setup | ❌ Many config files | ❌ Heavy |

**WireGuard wins** because it's the only option that is simultaneously encrypted, kernel-integrated (fast), tiny, Docker-native, and simple enough to auto-configure with key generation in a single container startup. GRE/IPIP are lighter but unencrypted. SSH tunnels are easy but too slow for routing all traffic. OpenVPN works but is far heavier and harder to automate.
