# YouTube Viewer - Docker Compose Setup

A containerized YouTube viewer using [Puppeteer](https://pptr.dev/), [Tor](https://www.torproject.org/) rotating proxies and [Docker](https://www.docker.com/).

Based on [soumyadityac/youtube-viewer](https://github.com/soumyadityac/youtube-viewer).

> **Disclaimer:** This project is intended for informational/educational purposes only. I strictly recommend against using it to artificially inflate video view counts for monetary benefits and/or other use cases that go against the YouTube Policies & Guidelines and/or the law of the land.

## Features

- **Single `docker-compose.yml`** deploys 2 containers: YouTube Viewer + Tor proxy
- **Single `.env` file** for all configuration — no need to edit code files
- YouTube URLs configured via `.env` (no separate `urls.txt` needed)
- Tor proxy runs in a separate container with automatic SOCKS port configuration
- **Enhanced logging** — both containers clearly show whether they are connected and working together
- **Optional Newt tunnel routing** — route Tor traffic through an existing Newt tunnel container to a VPS with Pangolin (disabled by default)
- Fully automatic deployment — just `docker-compose up`

## Quick Start

### Deploy with Arcane (recommended)

If you use [Arcane](https://github.com/Xerobase/Arcane) or another Docker Compose web UI:

#### Option A — Standard (no tunnel)

1. Create a new stack in Arcane.
2. Paste the contents of [`docker-compose.yml`](docker-compose.yml) into the **Compose** field.
3. Paste the contents of [`.env.example`](.env.example) into the **Environment** field and set your `YOUTUBE_URLS`.
4. Click **Deploy**.

#### Option B — With Newt tunnel

1. Create a new stack in Arcane.
2. Paste the contents of [`docker-compose.tunnel.yml`](docker-compose.tunnel.yml) into the **Compose** field.
3. Paste the contents of [`.env.example`](.env.example) into the **Environment** field and set your `YOUTUBE_URLS`, `NEWT_TUNNEL_NETWORK`, and `NEWT_TUNNEL_CONTAINER`.
4. Click **Deploy**.

Arcane (and Docker) will pull both images from GHCR and create the network and volume automatically — no cloning, no building, no extra commands.

### Deploy with Docker CLI

### Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Deploy

1. Clone this repository:

```bash
git clone https://github.com/dfhdrfhrdehrdhrdfh/youtube-viewer.git
cd youtube-viewer
```

2. Copy the example `.env` file and edit it with your settings:

```bash
cp .env.example .env
nano .env
```

3. Set your YouTube URL(s) in the `.env` file:

```env
YOUTUBE_URLS=https://www.youtube.com/watch?v=YOUR_VIDEO_ID
```

4. Start the containers (images are pulled automatically from GHCR):

```bash
docker-compose up -d
```

5. Check the logs:

```bash
docker-compose logs -f ytviewer
```

### Stop

```bash
docker-compose down
```

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
| `TOR_IMAGE_TAG` | `latest` | tor image tag (`latest`, `beta`, or a SHA for reproducibility) |
| `YOUTUBE_VIEWER_FORCE_DEBUG` | `false` | Enable debug logging |
| `NEWT_TUNNEL_ENABLED` | `false` | Route Tor traffic through a Newt tunnel container (see below) |
| `NEWT_TUNNEL_NETWORK` | *(empty)* | Docker network name shared with the Newt container |
| `NEWT_TUNNEL_CONTAINER` | *(empty)* | Name of the Newt container (IP auto-resolved at startup) |

### Multiple URLs

You can specify multiple URLs separated by commas:

```env
YOUTUBE_URLS=https://www.youtube.com/watch?v=VIDEO1,https://www.youtube.com/watch?v=VIDEO2,https://www.youtube.com/watch?v=VIDEO3
```

## Architecture

```
docker-compose.yml
├── tor (container)         - Tor SOCKS proxy with multiple ports
│   └── Listens on ports 9052-9057 (configurable)
└── ytviewer (container)    - YouTube viewer with Puppeteer + Chromium
    └── Connects to tor:9052-9057 for anonymized browsing
```

Both containers share a private Docker network (`ytnet`). The viewer connects to the Tor container's SOCKS proxies for anonymized browsing.

## Logging & Connectivity Verification

Both containers produce detailed logs so you can verify they are actually working together.

### Tor container logs (`docker-compose logs -f tor`)

| What you should see | Meaning |
|---|---|
| `Tor Proxy Container Starting` | Tor entrypoint is running |
| `Tunnel enabled  : true/false` | Whether Newt tunnel routing is active |
| `Tunnel container: <name>` | Which Newt container is being used as gateway (when enabled) |
| `SUCCESS: Default route set to <IP>` | Tunnel routing configured successfully |
| `Bootstrapped 100% (done)` | Tor has connected to the Tor network |
| `New SOCKS connection opened` | **The YT viewer is routing traffic through Tor** |
| `Periodic Status` block | Repeating status with tunnel state, gateway reachability, and route info |
| Circuit / stream log lines | Tor is actively building circuits for the viewer |

> **Key check:** If you see `New SOCKS connection` lines appearing every time the YT viewer starts a batch, Tor is genuinely handling the viewer's traffic. If you do **not** see them, the viewer is **not** connected to Tor. When tunnel mode is active, the periodic status logs confirm the tunnel gateway remains reachable.

### YT viewer logs (`docker-compose logs -f ytviewer`)

| What you should see | Meaning |
|---|---|
| `Tor enabled : true` | The viewer will use Tor |
| `Newt tunnel : ENABLED / DISABLED` | Whether tunnel routing is configured |
| `Traffic route : ytviewer → tor → ...` | The full traffic path being used |
| `SOCKS port <port> → reachable (Xms)` | TCP connectivity to the Tor container confirmed |
| `All N Tor SOCKS ports are reachable` | Every proxy port is working |
| `Launching browser with proxy: socks5://tor:<port>` | Chromium is configured to use Tor |
| `Tor proxy socks5://tor:<port> → exit IP: X.X.X.X` | **Traffic is exiting through Tor** — this IP should differ from your server's real IP |
| `Tunnel ACTIVE — traffic routes via <container> → VPS` | Confirms tunnel is being used for this connection |

> **Key check:** Compare the `exit IP` shown in the YT viewer logs with your server's real public IP (`curl ifconfig.me`). If they differ, Tor is working. When tunnel mode is active, the exit IP should match or relate to your VPS IP. The Tor logs should show a matching `New SOCKS connection` for each IP lookup.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| YT viewer shows `SOCKS port → UNREACHABLE` | Tor container not healthy yet or network issue |
| Exit IP matches your server IP | Tor proxy not being used — check `TOR_ENABLED=true` |
| No `New SOCKS connection` in Tor logs | The viewer is not routing through Tor |
| Tor shows `Bootstrapped` stuck below 100% | Tor cannot reach the Tor network (firewall / DNS) |

## Newt Tunnel (optional)

> **Default: disabled.** This feature is for users who already have a [Newt](https://github.com/fosrl/newt) tunnel container running on the same Docker host, connected to an external VPS that runs [Pangolin](https://github.com/fosrl/pangolin).

When enabled, the **Tor container** routes all its outbound internet traffic through the Newt tunnel → your VPS, so Tor circuits are built using the VPS as the internet uplink instead of your local server's IP.

```
┌─────────────────── Docker host ───────────────────┐
│                                                    │
│  ytviewer ──▶ tor ──▶ Newt container ══tunnel══▶ VPS (Pangolin) ──▶ Internet
│          ytnet        newt_net                     │
└────────────────────────────────────────────────────┘
```

### Prerequisites

1. A running **Newt tunnel container** on the same Docker host, already connected to your VPS with Pangolin.
2. The Newt container must be on a **Docker network** (note the network name).
3. **IP forwarding** and **NAT/masquerade** must be enabled on the VPS so that traffic from the Tor container can exit to the internet through the VPS.

### VPS / Pangolin setup

On your VPS (the one running Pangolin), make sure:

1. **IP forwarding is enabled:**

   ```bash
   # Check current setting
   sysctl net.ipv4.ip_forward
   # Enable (persist across reboots)
   echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-forward.conf
   sudo sysctl -p /etc/sysctl.d/99-forward.conf
   ```

2. **NAT / masquerade is configured** so forwarded traffic gets the VPS public IP:

   ```bash
   # Replace eth0 with your VPS public interface (check with: ip route show default)
   sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
   # Persist with iptables-persistent or your distro's method
   ```

3. **UFW (if active)** allows forwarded traffic:

   ```bash
   # /etc/ufw/sysctl.conf — set:
   net/ipv4/ip_forward=1

   # /etc/ufw/before.rules — add BEFORE the *filter section:
   *nat
   :POSTROUTING ACCEPT [0:0]
   -A POSTROUTING -o eth0 -j MASQUERADE
   COMMIT

   sudo ufw reload
   ```

4. **Pangolin** does not require extra configuration — Newt tunnels are already bidirectional. As long as the VPS forwards and masquerades traffic, the Tor container's packets will exit through the VPS.

### Enable the Newt tunnel

1. **Set the `.env` variables:**

   ```env
   NEWT_TUNNEL_ENABLED=true
   NEWT_TUNNEL_NETWORK=my_newt_network    # Docker network name of your Newt container
   NEWT_TUNNEL_CONTAINER=newt             # Name of your Newt container
   ```

   > **Find the Newt container name:**
   > ```bash
   > docker ps --format '{{.Names}}'
   > ```
   >
   > **Find the Docker network name:**
   > ```bash
   > docker network ls
   > ```
   >
   > The Newt container's IP is **auto-resolved** at startup via Docker DNS — you don't need to look it up.

2. **Deploy with `docker-compose.tunnel.yml`** (complete standalone file — no merging needed):

   **Docker CLI:**
   ```bash
   docker-compose -f docker-compose.tunnel.yml up -d
   ```

   **Arcane / Web UI:**
   Paste the contents of [`docker-compose.tunnel.yml`](docker-compose.tunnel.yml) into the Compose field (instead of `docker-compose.yml`). This file is a complete standalone compose file that includes everything from `docker-compose.yml` plus the tunnel configuration — no merging required.

3. **Verify in the logs:**

   ```bash
   docker-compose logs -f tor
   ```

   You should see:
   ```
   [tor-proxy] Tunnel enabled  : true
   [tor-proxy] Tunnel container: newt
   [tor-proxy] Resolving Newt container 'newt' to an IP via Docker DNS...
   [tor-proxy] Resolved 'newt' → 172.20.0.2
   [tor-proxy] SUCCESS: Default route set to 172.20.0.2
   [tor-proxy]   All Tor traffic will exit via the VPS tunnel.
   [tor-proxy] SUCCESS: Tunnel gateway 172.20.0.2 (newt) is reachable.
   ```

   The periodic status logs (every 60 seconds) will also confirm the tunnel state:
   ```
   [tor-proxy] ──────────── Periodic Status ────────────
   [tor-proxy]   Tunnel         : ACTIVE
   [tor-proxy]   Tunnel gateway : newt / 172.20.0.2
   [tor-proxy]   Route          : tor → newt → VPS → Internet
   [tor-proxy]   Tunnel status  : REACHABLE (OK)
   ```

   If you see `WARNING: Could not set default route`, make sure you are using `docker-compose.tunnel.yml` (it includes the required `NET_ADMIN` capability automatically).

### Disable the Newt tunnel

Set `NEWT_TUNNEL_ENABLED=false` in your `.env` (this is the default). You can then deploy with just the base `docker-compose.yml` — no overlay needed.
