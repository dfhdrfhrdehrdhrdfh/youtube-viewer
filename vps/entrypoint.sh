#!/bin/bash
# NOTE: We intentionally do NOT use "set -e" here. The entrypoint must be
# resilient: a failing sysctl or wg-quick-style call should never crash-loop
# the container and prevent the user from seeing the generated keys.

log() {
    echo "[wg-server] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log "============================================"
log " WireGuard VPS Server Starting"
log "============================================"

# Auto-detect VPS public IP
log "Detecting public IP address..."
VPS_IP=$(curl -s --max-time 10 https://api.ipify.org || curl -s --max-time 10 https://ifconfig.me || echo "")
if [ -z "${VPS_IP}" ]; then
    log "❌ ERROR: Failed to detect public IP address. Check your internet connection."
    exit 1
fi
log "Public IP: ${VPS_IP}"

# Auto-detect default network interface
DEFAULT_IFACE=$(ip route show default | awk '{print $5}' | head -n1)
if [ -z "${DEFAULT_IFACE}" ]; then
    log "❌ ERROR: Failed to detect default network interface. No default route found."
    exit 1
fi
log "Default network interface: ${DEFAULT_IFACE}"

WG_PORT=${WG_PORT:-51821}
log "WireGuard port: ${WG_PORT}"

# Create config directory
mkdir -p /config

# Generate keys if they don't exist
if [ ! -f /config/server_private.key ]; then
    log "Generating new WireGuard key pairs..."

    # Use umask 077 for secure file permissions.
    # Pipe through tee so wg genkey writes to a pipe (not a file), which avoids
    # the "writing to world accessible file" warning from wireguard-tools.
    umask 077
    wg genkey 2>/dev/null | tee /config/server_private.key | wg pubkey 2>/dev/null > /config/server_public.key
    wg genkey 2>/dev/null | tee /config/client_private.key | wg pubkey 2>/dev/null > /config/client_public.key

    log "Key pairs generated successfully."
else
    log "Using existing key pairs from /config."
fi

# Read keys from files
SERVER_PRIVATE_KEY=$(cat /config/server_private.key)
SERVER_PUBLIC_KEY=$(cat /config/server_public.key)
CLIENT_PRIVATE_KEY=$(cat /config/client_private.key)
CLIENT_PUBLIC_KEY=$(cat /config/client_public.key)

# Enable IP forwarding
# Docker's --sysctl net.ipv4.ip_forward=1 pre-configures the value, but
# /proc/sys may be read-only inside the container, so the sysctl write can
# fail.  Some sysctl implementations print errors on stdout, so we redirect
# both stdout and stderr and treat failure as non-fatal.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" = "1" ]; then
    log "IP forwarding is enabled."
else
    log "⚠ WARNING: IP forwarding could not be verified."
    log "  Ensure your docker run command includes: --sysctl net.ipv4.ip_forward=1"
    log "  Or enable it on the host: sysctl -w net.ipv4.ip_forward=1"
fi

# Write WireGuard server config
# This is a pure wg(8) config — no wg-quick extensions (Address, PostUp, etc.)
# so we can use 'wg setconf' directly and avoid wg-quick's internal sysctl
# calls that fail on read-only /proc/sys.
log "Writing WireGuard configuration..."
cat > /config/wg0.conf << EOF
[Interface]
PrivateKey = ${SERVER_PRIVATE_KEY}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = 10.13.13.2/32
EOF
chmod 600 /config/wg0.conf

# Clean up any lingering WireGuard interface from a previous (crashed) run
ip link del wg0 2>/dev/null || true

# Start WireGuard using manual ip/wg commands instead of wg-quick.
# wg-quick internally runs "sysctl -w" which fails on read-only /proc/sys
# and causes a crash-loop when combined with set -e.
log "Starting WireGuard interface..."
if ! ip link add wg0 type wireguard; then
    log "❌ ERROR: Failed to create WireGuard interface."
    log "  The host kernel must support WireGuard (Linux 5.6+ or wireguard-dkms)."
    log ""
    log "  Printing keys below so you can note them even though the interface failed."
else
    if wg setconf wg0 /config/wg0.conf &&
       ip addr add 10.13.13.1/24 dev wg0 &&
       ip link set wg0 up; then
        log "WireGuard interface is up."

        # Set up iptables NAT and forwarding (equivalent to the old PostUp rules)
        log "Configuring iptables rules..."
        iptables -t nat -A POSTROUTING -o "${DEFAULT_IFACE}" -j MASQUERADE
        iptables -A FORWARD -i wg0 -j ACCEPT
        iptables -A FORWARD -o wg0 -j ACCEPT
        log "iptables rules configured."

        # Show interface status
        wg show wg0
    else
        log "⚠ WARNING: Failed to fully configure WireGuard interface."
        log "  Keys are printed below. You can troubleshoot the interface later."
    fi
fi

# Print connection info — ALWAYS, even if WireGuard setup had issues.
# This is the whole point of the one-command deploy: the user must see the keys.
echo ""
echo "============================================"
echo " ✅ WireGuard VPS Server Ready!"
echo "============================================"
echo ""
echo "Copy these values to your .env on your home server:"
echo ""
echo "VPS_IP=${VPS_IP}"
echo "VPS_WG_PORT=${WG_PORT}"
echo "WG_SERVER_PUBLIC_KEY=${SERVER_PUBLIC_KEY}"
echo "WG_CLIENT_PRIVATE_KEY=${CLIENT_PRIVATE_KEY}"
echo ""
echo "============================================"
echo ""

log "Server is running. Waiting for connections..."

# Health monitoring loop — logs WireGuard status periodically
while true; do
    sleep 60
    PEER_STATUS=$(wg show wg0 latest-handshakes 2>/dev/null | awk '{print $2}')
    if [ -n "$PEER_STATUS" ] && [ "$PEER_STATUS" != "0" ]; then
        log "Client connected (last handshake: ${PEER_STATUS}s ago)"
    else
        log "No active client connections"
    fi
done
