#!/bin/sh
# NOTE: We intentionally do NOT use "set -e" here. The entrypoint must be
# resilient to transient failures (e.g. gateway not yet reachable on restart).

START_PORT="${TOR_START_PORT:-9052}"
NUM_PORTS="${TOR_NUM_PORTS:-6}"
TUNNEL_ENABLED="${TUNNEL_ENABLED:-false}"
TUNNEL_GATEWAY="${TUNNEL_GATEWAY:-}"
TUNNEL_IP=""

log() { echo "[tor-proxy] $(date '+%H:%M:%S') $1"; }

# Fetch and log the container's public uplink IP (should be VPS IP when tunnel is active)
check_uplink_ip() {
  UPLINK_IP=$(wget -qO- -T 10 https://api.ipify.org/ 2>/dev/null || wget -qO- -T 10 https://ifconfig.me/ip 2>/dev/null || echo "check-failed (no network connectivity)")
  log "Uplink IP check: ${UPLINK_IP}"
  if [ "$TUNNEL_ENABLED" = "true" ] && [ -n "$VPS_IP" ]; then
    if [ "$UPLINK_IP" = "$VPS_IP" ]; then
      log "  ✅ TUNNEL VERIFIED: Uplink IP ($UPLINK_IP) matches VPS IP"
    elif echo "$UPLINK_IP" | grep -q "check-failed"; then
      log "  ❌ TUNNEL CHECK FAILED: No internet connectivity through tunnel"
    else
      log "  ⚠ TUNNEL SUSPECT: Uplink IP ($UPLINK_IP) does NOT match VPS IP ($VPS_IP)"
      log "    Traffic may not be routing through the tunnel!"
    fi
  elif [ "$TUNNEL_ENABLED" = "true" ]; then
    log "  ↳ If tunnel is working, this should be your VPS IP, NOT your local server IP."
  fi
}

log "============================================"
log " Tor Proxy Container Starting"
log "============================================"
log "SOCKS ports     : ${NUM_PORTS} (${START_PORT}–$((START_PORT + NUM_PORTS - 1)))"
log "Tunnel enabled  : ${TUNNEL_ENABLED}"
if [ "$TUNNEL_ENABLED" = "true" ]; then
  log "Tunnel gateway  : ${TUNNEL_GATEWAY}"
  log "Tunnel type     : WireGuard VPS tunnel"
else
  log "Routing          : DIRECT (no tunnel — Tor uses local internet)"
fi
log "============================================"

# --- WireGuard tunnel routing (optional) ---
if [ "$TUNNEL_ENABLED" = "true" ]; then
  if [ -z "$TUNNEL_GATEWAY" ]; then
    log "ERROR: TUNNEL_ENABLED=true but TUNNEL_GATEWAY is not set. Aborting."
    exit 1
  fi

  log "Resolving tunnel gateway '${TUNNEL_GATEWAY}' to an IP via Docker DNS..."
  # Docker embedded DNS (127.0.0.11) resolves container names on shared networks.
  # Use ping to extract the resolved IP — works with busybox on Alpine.
  # Retry because wg-tunnel may not be fully ready immediately after a restart.
  TUNNEL_IP=""
  for RESOLVE_ATTEMPT in 1 2 3 4 5; do
    TUNNEL_IP=$(ping -c1 -W5 "$TUNNEL_GATEWAY" 2>/dev/null | head -1 | sed -n 's/.*(\([0-9.]*\)).*/\1/p')
    if [ -n "$TUNNEL_IP" ]; then
      break
    fi
    if [ "$RESOLVE_ATTEMPT" -lt 5 ]; then
      log "  Attempt ${RESOLVE_ATTEMPT}/5: Could not resolve '${TUNNEL_GATEWAY}'. Retrying in 5s..."
      sleep 5
    fi
  done

  if [ -z "$TUNNEL_IP" ]; then
    log "ERROR: Could not resolve '${TUNNEL_GATEWAY}' to an IP."
    log "       Make sure the WireGuard tunnel container is running and shares"
    log "       a Docker network with this tor container."
    exit 1
  fi

  log "Resolved '${TUNNEL_GATEWAY}' → ${TUNNEL_IP}"
  log "Configuring outbound route through WireGuard tunnel gateway ${TUNNEL_IP}..."

  # Replace default route so all Tor traffic exits via the WireGuard tunnel container
  if ip route replace default via "$TUNNEL_IP" 2>/dev/null; then
    log "SUCCESS: Default route set to ${TUNNEL_IP}"
    log "  All Tor traffic will exit via the VPS tunnel."
    log "  Route: tor container → wg-tunnel (${TUNNEL_GATEWAY}/${TUNNEL_IP}) → WireGuard → VPS → Internet"
  else
    log "WARNING: Could not set default route. Ensure NET_ADMIN capability is granted."
    log "  If using docker-compose.tunnel.yml this is included automatically."
  fi

  # Quick connectivity check — gateway reachable?
  if ping -c1 -W3 "$TUNNEL_IP" >/dev/null 2>&1; then
    log "SUCCESS: Tunnel gateway ${TUNNEL_IP} (${TUNNEL_GATEWAY}) is reachable."
  else
    log "WARNING: Tunnel gateway ${TUNNEL_IP} (${TUNNEL_GATEWAY}) is NOT reachable. Traffic may fail."
  fi

  # End-to-end connectivity check — can we actually reach the internet through the tunnel?
  # Use a retry loop because the tunnel may need time to stabilize after a restart.
  log "Testing end-to-end internet connectivity through tunnel..."
  TUNNEL_EXT_IP=""
  MAX_RETRIES=5
  RETRY_INTERVAL=10
  for ATTEMPT in $(seq 1 $MAX_RETRIES); do
    TUNNEL_EXT_IP=$(wget -qO- -T 15 https://api.ipify.org/ 2>/dev/null || wget -qO- -T 15 https://ifconfig.me/ip 2>/dev/null || echo "")
    if [ -n "$TUNNEL_EXT_IP" ]; then
      break
    fi
    if [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; then
      log "  Attempt ${ATTEMPT}/${MAX_RETRIES}: Internet not reachable yet. Retrying in ${RETRY_INTERVAL}s..."
      sleep "$RETRY_INTERVAL"
    fi
  done

  if [ -n "$TUNNEL_EXT_IP" ]; then
    log "SUCCESS: Internet is reachable through tunnel. External IP: ${TUNNEL_EXT_IP}"
    if [ -n "$VPS_IP" ] && [ "$TUNNEL_EXT_IP" = "$VPS_IP" ]; then
      log "  ✅ TUNNEL VERIFIED: External IP matches VPS IP ($VPS_IP)"
    elif [ -n "$VPS_IP" ]; then
      log "  ⚠ External IP ($TUNNEL_EXT_IP) does NOT match VPS IP ($VPS_IP)"
      log "    The tunnel may not be routing correctly."
    else
      log "  ↳ This should be your VPS public IP, NOT your local server IP."
    fi
  else
    log "WARNING: Internet is NOT reachable through the tunnel."
    log "  Tor will likely fail to bootstrap. Troubleshooting:"
    log "  1. Check the wg-tunnel container logs: docker logs wg-tunnel"
    log "  2. Verify the VPS WireGuard server is running: docker logs yt-wg-server"
    log "  3. Check that the WireGuard keys in .env match the VPS setup output."
    log "  4. Ensure UDP port 51821 is open on the VPS firewall."
    log "  5. See README.md for full setup instructions."
  fi

  log "============================================"
  log " Tunnel Configuration Summary"
  log "============================================"
  log "  Tunnel enabled   : YES (WireGuard)"
  log "  Gateway container: ${TUNNEL_GATEWAY}"
  log "  Gateway IP       : ${TUNNEL_IP}"
  if [ -n "$TUNNEL_EXT_IP" ]; then
    log "  External IP      : ${TUNNEL_EXT_IP}"
    if [ -n "$VPS_IP" ]; then
      log "  Expected VPS IP  : ${VPS_IP}"
    fi
  fi
  log "  Route            : tor → wg-tunnel → WireGuard → VPS → Internet"
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

# Generate hashed control password for Tor ControlPort
TOR_CONTROL_PASSWORD="${TOR_CONTROL_PASSWORD:-npcviewers}"
HASHED_PW=$(tor --hash-password "$TOR_CONTROL_PASSWORD" 2>/dev/null | tail -1)
log "Generated Tor control port password hash"

# Write torrc configuration
cat > /etc/tor/torrc <<EOF
User tor
DataDirectory /var/lib/tor
Log notice stdout
Log info stdout
Log notice file /tmp/tor_bootstrap.log
SafeLogging 0

# Control port for NEWNYM circuit rotation signals from the viewer app
ControlPort 0.0.0.0:9051
HashedControlPassword ${HASHED_PW}
EOF

for i in $(seq 0 $((NUM_PORTS - 1))); do
  PORT=$((START_PORT + i))
  # SessionGroup ensures each port gets its own Tor circuits (= unique exit IPs).
  # IsolateSOCKSAuth + IsolateClientAddr prevent circuit sharing across ports.
  echo "SocksPort 0.0.0.0:${PORT} SessionGroup=${i} IsolateSOCKSAuth IsolateClientAddr" >> /etc/tor/torrc
done

log "Generated torrc:"
cat /etc/tor/torrc

log "============================================"
log " Starting Tor daemon"
log "============================================"
log "When the NPC Viewers container connects, you will see"
log "  'New SOCKS connection' lines in this log."
log "If you do NOT see them, the viewer is not routing through Tor."
if [ "$TUNNEL_ENABLED" = "true" ]; then
  log "Tunnel mode is ACTIVE — Tor traffic routes through ${TUNNEL_GATEWAY} (${TUNNEL_IP}) → VPS."
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
      log "  Tunnel         : ACTIVE (WireGuard)"
      log "  Tunnel gateway : ${TUNNEL_GATEWAY} / ${TUNNEL_IP}"
      log "  Route          : tor → wg-tunnel → WireGuard → VPS → Internet"
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
    log "────────────────────────────────────────"
    sleep 60
  done
) &

# Clean up stale lock file that may remain after a hard stop/restart.
# Tor refuses to start if /var/lib/tor/lock exists from a previous run.
rm -f /var/lib/tor/lock

# Pre-create the bootstrap log file so Tor (running as user tor) can write to it
touch /tmp/tor_bootstrap.log
chown tor:tor /tmp/tor_bootstrap.log

exec tor -f /etc/tor/torrc
