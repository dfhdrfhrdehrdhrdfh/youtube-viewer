#!/bin/bash
# NOTE: We intentionally do NOT use "set -e" here. The entrypoint must be
# resilient to sysctl / wg-quick failures on read-only /proc/sys.

log() {
    echo "[wg-tunnel] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

# Validate required environment variables
MISSING=""
if [ -z "${VPS_IP}" ]; then
    MISSING="${MISSING}  - VPS_IP: Public IP address of your VPS\n"
fi
if [ -z "${WG_CLIENT_PRIVATE_KEY}" ]; then
    MISSING="${MISSING}  - WG_CLIENT_PRIVATE_KEY: WireGuard client private key\n"
fi
if [ -z "${WG_SERVER_PUBLIC_KEY}" ]; then
    MISSING="${MISSING}  - WG_SERVER_PUBLIC_KEY: WireGuard server public key\n"
fi

if [ -n "${MISSING}" ]; then
    log "❌ ERROR: Missing required environment variables:"
    echo -e "${MISSING}"
    log "Please set these in your .env file and restart."
    exit 1
fi

VPS_WG_PORT=${VPS_WG_PORT:-51821}

log "============================================"
log " WireGuard Tunnel Client Starting"
log "============================================"
log "VPS Endpoint: ${VPS_IP}:${VPS_WG_PORT}"

# Detect default network interface and gateway BEFORE wg changes routing
DEFAULT_IFACE=$(ip route show default | awk '{print $5}' | head -n1)
DEFAULT_GW=$(ip route show default | awk '{print $3}' | head -n1)
if [ -z "${DEFAULT_IFACE}" ]; then
    DEFAULT_IFACE="eth0"
    log "Could not detect default interface, falling back to ${DEFAULT_IFACE}"
else
    log "Detected default interface: ${DEFAULT_IFACE}"
fi
if [ -z "${DEFAULT_GW}" ]; then
    log "⚠ WARNING: Could not detect default gateway"
else
    log "Detected default gateway: ${DEFAULT_GW}"
fi

# Enable IP forwarding so the tor container can route through us.
# Docker's --sysctl / sysctls directive pre-configures the value, but
# /proc/sys may be read-only inside the container, so the sysctl write can
# fail.  Some sysctl implementations print errors on stdout, so we redirect
# both stdout and stderr and treat failure as non-fatal.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" = "1" ]; then
    log "IP forwarding is enabled."
else
    log "⚠ WARNING: IP forwarding could not be verified."
    log "  Ensure your docker-compose.yml includes: sysctls: net.ipv4.ip_forward=1"
fi

# Create config directory
mkdir -p /config

# Write WireGuard client config
# This is a pure wg(8) config — no wg-quick extensions (Address, DNS, etc.)
# so we can use 'wg setconf' directly and avoid wg-quick's internal sysctl
# calls that fail on read-only /proc/sys.
log "Writing WireGuard client configuration..."
cat > /config/wg0.conf << EOF
[Interface]
PrivateKey = ${WG_CLIENT_PRIVATE_KEY}

[Peer]
PublicKey = ${WG_SERVER_PUBLIC_KEY}
Endpoint = ${VPS_IP}:${VPS_WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 /config/wg0.conf

# Function to bring up the WireGuard interface and routing.
# Used both at startup and for reconnection in the health loop.
setup_wg() {
    ip link del wg0 2>/dev/null || true
    if ! ip link add wg0 type wireguard; then
        log "❌ ERROR: Failed to create WireGuard interface."
        log "  The host kernel must support WireGuard (Linux 5.6+ or wireguard-dkms)."
        return 1
    fi
    wg setconf wg0 /config/wg0.conf || return 1
    ip addr add 10.13.13.2/24 dev wg0 2>/dev/null || log "⚠ Address 10.13.13.2/24 may already be assigned (non-fatal)"
    ip link set wg0 up || return 1

    # Routing: send all traffic through the WireGuard tunnel, but keep the
    # VPS endpoint itself reachable through the original default gateway so
    # the encrypted WireGuard packets can actually reach the VPS.
    if [ -n "${DEFAULT_GW}" ]; then
        ip route add "${VPS_IP}/32" via "${DEFAULT_GW}" dev "${DEFAULT_IFACE}" 2>/dev/null \
            || log "⚠ Route to VPS endpoint may already exist (non-fatal)"
    fi
    # 0.0.0.0/1 + 128.0.0.0/1 are more specific than the default route
    # (0.0.0.0/0) so they take priority, but Docker-subnet routes (/16 etc.)
    # are even more specific and continue to work for inter-container traffic.
    ip route add 0.0.0.0/1 dev wg0 2>/dev/null \
        || log "⚠ Route 0.0.0.0/1 via wg0 may already exist (non-fatal)"
    ip route add 128.0.0.0/1 dev wg0 2>/dev/null \
        || log "⚠ Route 128.0.0.0/1 via wg0 may already exist (non-fatal)"
    return 0
}

# Clean up any lingering WireGuard interface from a previous (crashed) run,
# then bring up a fresh interface.
log "Starting WireGuard interface..."

# Flush all iptables rules to prevent duplicates on container restart.
# This container exclusively manages its own iptables rules (NAT + FORWARD for
# WireGuard tunneling). Docker's own networking rules live on the host, not inside
# the container, so flushing here is safe.
log "Flushing existing iptables rules (clean slate for restart)..."
iptables -F 2>/dev/null || true
iptables -t nat -F 2>/dev/null || true
iptables -X 2>/dev/null || true

if ! setup_wg; then
    log "❌ Failed to start WireGuard interface. Exiting."
    exit 1
fi
log "WireGuard interface is up."

# Set up iptables for NAT and forwarding
# Traffic from the tor container arrives on DEFAULT_IFACE and exits through wg0
log "Configuring iptables rules..."
iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
iptables -A FORWARD -i "${DEFAULT_IFACE}" -o wg0 -j ACCEPT
iptables -A FORWARD -i wg0 -o "${DEFAULT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
log "iptables rules configured."

# Log routing table and iptables state for debugging
log "Current routing table:"
ip route show 2>&1 | while IFS= read -r line; do log "  $line"; done
log "iptables FORWARD rules:"
iptables -L FORWARD -n -v 2>&1 | while IFS= read -r line; do log "  $line"; done
log "iptables NAT POSTROUTING rules:"
iptables -t nat -L POSTROUTING -n -v 2>&1 | while IFS= read -r line; do log "  $line"; done

# Verify tunnel connectivity with retry logic
log "Verifying tunnel connectivity..."
TUNNEL_VERIFIED=false
for ATTEMPT in 1 2 3; do
    if ping -c 3 -W 5 10.13.13.1 > /dev/null 2>&1; then
        log "✅ Tunnel to VPS server (10.13.13.1) is reachable."
        break
    else
        log "⚠ Attempt ${ATTEMPT}/3: Could not ping VPS server (10.13.13.1). Retrying in 5s..."
        sleep 5
    fi
done

# Check external IP through tunnel with retry logic
log "Checking external IP through tunnel..."
EXTERNAL_IP="check-failed"
for ATTEMPT in 1 2 3; do
    EXTERNAL_IP=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null || curl -s --max-time 10 https://ifconfig.me 2>/dev/null || echo "check-failed")
    if [ "${EXTERNAL_IP}" = "${VPS_IP}" ]; then
        log "✅ Tunnel routing confirmed — external IP (${EXTERNAL_IP}) matches VPS IP."
        TUNNEL_VERIFIED=true
        break
    elif [ "${EXTERNAL_IP}" = "check-failed" ]; then
        log "⚠ Attempt ${ATTEMPT}/3: Could not determine external IP. Retrying in 5s..."
        sleep 5
    else
        log "⚠ Attempt ${ATTEMPT}/3: External IP (${EXTERNAL_IP}) does not match VPS IP (${VPS_IP}). Retrying in 5s..."
        sleep 5
    fi
done

if [ "${TUNNEL_VERIFIED}" != "true" ]; then
    log "⚠ External IP (${EXTERNAL_IP}) does not match VPS IP (${VPS_IP}) after 3 attempts."
    log "  The tunnel may not be routing correctly. Forwarded traffic may also be affected."
fi

log ""
log "============================================"
log " ✅ WireGuard Tunnel Client Ready!"
log "============================================"
log " VPS Endpoint:  ${VPS_IP}:${VPS_WG_PORT}"
log " Tunnel IP:     10.13.13.2"
log " External IP:   ${EXTERNAL_IP}"
log "============================================"
log ""
log "Tunnel is running. Waiting for connections from tor container..."

# Health monitoring loop — checks tunnel connectivity periodically
HEALTH_COUNT=0
while true; do
    sleep 30
    if ! ping -c1 -W3 10.13.13.1 >/dev/null 2>&1; then
        log "⚠ Tunnel health: VPS (10.13.13.1) unreachable — attempting reconnect..."
        # Flush iptables and re-setup to prevent stale rules
        iptables -F 2>/dev/null || true
        iptables -t nat -F 2>/dev/null || true
        iptables -X 2>/dev/null || true
        if setup_wg; then
            iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
            iptables -A FORWARD -i "${DEFAULT_IFACE}" -o wg0 -j ACCEPT
            iptables -A FORWARD -i wg0 -o "${DEFAULT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
            log "Reconnect succeeded — iptables rules re-applied."
        else
            log "❌ Reconnect failed"
        fi
        continue
    fi
    # Periodically verify external IP still matches VPS IP (every 5 min, not every 30s)
    HEALTH_COUNT=$((HEALTH_COUNT + 1))
    if [ $((HEALTH_COUNT % 10)) -eq 0 ]; then
        HEALTH_EXT_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "check-failed")
        if [ "${HEALTH_EXT_IP}" = "${VPS_IP}" ]; then
            log "Tunnel health: OK (VPS reachable, external IP ${HEALTH_EXT_IP} matches VPS)"
        elif [ "${HEALTH_EXT_IP}" = "check-failed" ]; then
            log "Tunnel health: VPS reachable but external IP check failed"
        else
            log "⚠ Tunnel health: VPS reachable but external IP (${HEALTH_EXT_IP}) ≠ VPS IP (${VPS_IP}) — attempting reconnect..."
            iptables -F 2>/dev/null || true
            iptables -t nat -F 2>/dev/null || true
            iptables -X 2>/dev/null || true
            if setup_wg; then
                iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
                iptables -A FORWARD -i "${DEFAULT_IFACE}" -o wg0 -j ACCEPT
                iptables -A FORWARD -i wg0 -o "${DEFAULT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
                log "Reconnect completed — iptables rules re-applied."
            else
                log "❌ Reconnect failed"
            fi
        fi
    else
        log "Tunnel health: OK (VPS reachable)"
    fi
done
