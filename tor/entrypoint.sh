#!/bin/sh
set -e

START_PORT="${TOR_START_PORT:-9052}"
NUM_PORTS="${TOR_NUM_PORTS:-6}"
TUNNEL_ENABLED="${NEWT_TUNNEL_ENABLED:-false}"
TUNNEL_CONTAINER="${NEWT_TUNNEL_CONTAINER:-}"

log() { echo "[tor-proxy] $(date '+%H:%M:%S') $1"; }

log "============================================"
log " Tor Proxy Container Starting"
log "============================================"
log "SOCKS ports : ${NUM_PORTS} (${START_PORT}–$((START_PORT + NUM_PORTS - 1)))"
log "Tunnel mode : ${TUNNEL_ENABLED}"

# --- Newt Tunnel routing (optional) ---
if [ "$TUNNEL_ENABLED" = "true" ]; then
  if [ -z "$TUNNEL_CONTAINER" ]; then
    log "ERROR: NEWT_TUNNEL_ENABLED=true but NEWT_TUNNEL_CONTAINER is not set. Aborting."
    exit 1
  fi

  log "Resolving Newt container '${TUNNEL_CONTAINER}' to an IP via Docker DNS..."
  # Docker embedded DNS (127.0.0.11) resolves container names on shared networks.
  # Use ping to extract the resolved IP — works with busybox on Alpine.
  TUNNEL_IP=$(ping -c1 -W5 "$TUNNEL_CONTAINER" 2>/dev/null | head -1 | sed -n 's/.*(\([0-9.]*\)).*/\1/p')

  if [ -z "$TUNNEL_IP" ]; then
    log "ERROR: Could not resolve '${TUNNEL_CONTAINER}' to an IP."
    log "       Make sure the Newt container is running and shares a Docker network"
    log "       with this tor container (see docker-compose.tunnel.yml)."
    exit 1
  fi

  log "Resolved '${TUNNEL_CONTAINER}' → ${TUNNEL_IP}"
  log "Configuring outbound route through Newt tunnel gateway ${TUNNEL_IP}..."

  # Replace default route so all Tor traffic exits via the Newt tunnel container
  ip route replace default via "$TUNNEL_IP" 2>/dev/null \
    && log "Default route set to ${TUNNEL_IP} — all Tor traffic will exit via the VPS tunnel." \
    || log "WARNING: Could not set default route. Ensure NET_ADMIN capability is granted."

  # Quick connectivity check
  if ping -c1 -W3 "$TUNNEL_IP" >/dev/null 2>&1; then
    log "Tunnel gateway ${TUNNEL_IP} (${TUNNEL_CONTAINER}) is reachable."
  else
    log "WARNING: Tunnel gateway ${TUNNEL_IP} (${TUNNEL_CONTAINER}) is NOT reachable. Traffic may fail."
  fi
fi

# Ensure directories exist with correct permissions
mkdir -p /etc/tor /var/lib/tor
chown -R tor:tor /var/lib/tor
chmod 700 /var/lib/tor

# Write torrc configuration — use info-level logging so circuit & stream
# events are visible, making it clear when the ytviewer is using Tor.
cat > /etc/tor/torrc <<EOF
User tor
DataDirectory /var/lib/tor
Log notice stdout
# Log every new SOCKS connection and circuit at info level
Log info stdout
# Show safe-logging off so we can see connection details (non-sensitive in this context)
SafeLogging 0
EOF

for i in $(seq 0 $((NUM_PORTS - 1))); do
  PORT=$((START_PORT + i))
  echo "SocksPort 0.0.0.0:${PORT}" >> /etc/tor/torrc
done

log "Generated torrc:"
cat /etc/tor/torrc

log "============================================"
log " Starting Tor daemon"
log "============================================"
log "When the ytviewer container connects, you will see"
log "  'New SOCKS connection' lines in this log."
log "If you do NOT see them, the viewer is not routing through Tor."
log "============================================"

exec tor -f /etc/tor/torrc
