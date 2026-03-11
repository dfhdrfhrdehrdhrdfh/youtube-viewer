#!/bin/sh
set -e

START_PORT="${TOR_START_PORT:-9052}"
NUM_PORTS="${TOR_NUM_PORTS:-6}"
TUNNEL_ENABLED="${NEWT_TUNNEL_ENABLED:-false}"
TUNNEL_CONTAINER="${NEWT_TUNNEL_CONTAINER:-}"
TUNNEL_IP=""

log() { echo "[tor-proxy] $(date '+%H:%M:%S') $1"; }

# Fetch and log the container's public uplink IP (should be VPS IP when tunnel is active)
check_uplink_ip() {
  UPLINK_IP=$(wget -qO- https://api.ipify.org/ 2>/dev/null || curl -s https://api.ipify.org/ 2>/dev/null || echo "unavailable")
  log "Uplink IP check: ${UPLINK_IP}"
  if [ "$TUNNEL_ENABLED" = "true" ]; then
    log "  ↳ If tunnel is working, this should be your VPS IP, NOT your local server IP."
  fi
}

log "============================================"
log " Tor Proxy Container Starting"
log "============================================"
log "SOCKS ports     : ${NUM_PORTS} (${START_PORT}–$((START_PORT + NUM_PORTS - 1)))"
log "Tunnel enabled  : ${TUNNEL_ENABLED}"
if [ "$TUNNEL_ENABLED" = "true" ]; then
  log "Tunnel container: ${TUNNEL_CONTAINER}"
else
  log "Routing          : DIRECT (no tunnel — Tor uses local internet)"
fi
log "============================================"

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
  if ip route replace default via "$TUNNEL_IP" 2>/dev/null; then
    log "SUCCESS: Default route set to ${TUNNEL_IP}"
    log "  All Tor traffic will exit via the VPS tunnel."
    log "  Route: tor container → Newt (${TUNNEL_CONTAINER}/${TUNNEL_IP}) → VPS (Pangolin) → Internet"
  else
    log "WARNING: Could not set default route. Ensure NET_ADMIN capability is granted."
    log "  If using docker-compose.tunnel.yml this is included automatically."
  fi

  # Quick connectivity check
  if ping -c1 -W3 "$TUNNEL_IP" >/dev/null 2>&1; then
    log "SUCCESS: Tunnel gateway ${TUNNEL_IP} (${TUNNEL_CONTAINER}) is reachable."
  else
    log "WARNING: Tunnel gateway ${TUNNEL_IP} (${TUNNEL_CONTAINER}) is NOT reachable. Traffic may fail."
  fi

  log "============================================"
  log " Tunnel Configuration Summary"
  log "============================================"
  log "  Tunnel enabled  : YES"
  log "  Gateway container: ${TUNNEL_CONTAINER}"
  log "  Gateway IP       : ${TUNNEL_IP}"
  log "  Route            : tor → ${TUNNEL_CONTAINER} → VPS → Internet"
  log "============================================"
fi

# --- Startup uplink IP check ---
# Reports the public IP this container sees — should be VPS IP when tunnel is active.
log "============================================"
log " Startup Uplink IP Check"
log "============================================"
check_uplink_ip
log "============================================"

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
if [ "$TUNNEL_ENABLED" = "true" ]; then
  log "Tunnel mode is ACTIVE — Tor traffic routes through ${TUNNEL_CONTAINER} (${TUNNEL_IP}) to VPS."
else
  log "Tunnel mode is OFF — Tor uses the local server's internet directly."
fi
log "============================================"

# --- Background status reporter ---
# Periodically logs the current status so users can always see the configuration
# and whether the tunnel is active, even when scrolling through logs.
(
  # Wait for Tor to bootstrap before starting periodic status reports
  sleep 60
  while true; do
    log "──────────── Periodic Status ────────────"
    log "  SOCKS ports    : ${START_PORT}–$((START_PORT + NUM_PORTS - 1)) (${NUM_PORTS} ports)"
    if [ "$TUNNEL_ENABLED" = "true" ]; then
      log "  Tunnel         : ACTIVE"
      log "  Tunnel gateway : ${TUNNEL_CONTAINER} / ${TUNNEL_IP}"
      log "  Route          : tor → ${TUNNEL_CONTAINER} → VPS → Internet"
      # Verify tunnel gateway is still reachable
      if ping -c1 -W3 "$TUNNEL_IP" >/dev/null 2>&1; then
        log "  Tunnel status  : REACHABLE (OK)"
      else
        log "  Tunnel status  : UNREACHABLE (WARNING)"
      fi
    else
      log "  Tunnel         : DISABLED (direct internet)"
    fi
    # Show current default route
    CURRENT_ROUTE=$(ip route show default 2>/dev/null || echo "unknown")
    log "  Default route  : ${CURRENT_ROUTE}"
    # Show current uplink IP (VPS IP when tunnel active, local IP when direct)
    check_uplink_ip
    log "────────────────────────────────────────"
    sleep 60
  done
) &

exec tor -f /etc/tor/torrc
