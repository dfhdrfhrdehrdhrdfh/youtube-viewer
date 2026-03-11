# YouTube Viewer - Docker Compose Setup

A containerized YouTube viewer using [Puppeteer](https://pptr.dev/), [Tor](https://www.torproject.org/) rotating proxies and [Docker](https://www.docker.com/).

Based on [soumyadityac/youtube-viewer](https://github.com/soumyadityac/youtube-viewer).

> **Disclaimer:** This project is intended for informational/educational purposes only. I strictly recommend against using it to artificially inflate video view counts for monetary benefits and/or other use cases that go against the YouTube Policies & Guidelines and/or the law of the land.

## Features

- **Single `docker-compose.yml`** deploys 2 containers: YouTube Viewer + Tor proxy
- **Single `.env` file** for all configuration — no need to edit code files
- YouTube URLs configured via `.env` (no separate `urls.txt` needed)
- Tor proxy runs in a separate container with automatic SOCKS port configuration
- Fully automatic deployment — just `docker-compose up`

## Quick Start

### Deploy with Arcane (recommended)

If you use [Arcane](https://github.com/Xerobase/Arcane) or another Docker Compose web UI:

1. Create a new stack in Arcane.
2. Paste the contents of [`docker-compose.yml`](docker-compose.yml) into the **Compose** field.
3. Paste the contents of [`.env.example`](`.env.example`) into the **Environment** field and set your `YOUTUBE_URLS`.
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
| `IMAGE_TAG` | `latest` | youtube-viewer image tag (pin to a SHA for reproducibility) |
| `TOR_IMAGE_TAG` | `latest` | tor image tag (pin to a SHA for reproducibility) |
| `YOUTUBE_VIEWER_FORCE_DEBUG` | `false` | Enable debug logging |

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
