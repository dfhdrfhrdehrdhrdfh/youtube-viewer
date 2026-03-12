#!/bin/bash
set -e

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

    # Use umask 077 to avoid the "writing to world accessible file" warning
    (umask 077 && wg genkey > /config/server_private.key)
    (umask 077 && wg pubkey < /config/server_private.key > /config/server_public.key)

    (umask 077 && wg genkey > /config/client_private.key)
    (umask 077 && wg pubkey < /config/client_private.key > /config/client_public.key)

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
# When Docker is started with --sysctl net.ipv4.ip_forward=1, the value is
# pre-configured and the in-container sysctl call may fail on read-only kernels.
# We treat that as a soft error: if the value is already 1, we continue normally.
if sysctl -w net.ipv4.ip_forward=1 2>/dev/null; then
    log "IP forwarding enabled."
elif [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" = "1" ]; then
    log "IP forwarding already enabled (pre-configured via --sysctl flag)."
else
    log "❌ ERROR: Could not enable IP forwarding. Add --sysctl net.ipv4.ip_forward=1 to your docker run command, or add sysctls configuration to docker-compose.yml."
    exit 1
fi

# Write WireGuard server config
log "Writing WireGuard configuration..."
cat > /config/wg0.conf << EOF
[Interface]
Address = 10.13.13.1/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}
PostUp = iptables -t nat -A POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE; iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = 10.13.13.2/32
EOF
chmod 600 /config/wg0.conf

# Clean up any lingering WireGuard interface from a previous (crashed) run
wg-quick down /config/wg0.conf 2>/dev/null || true

# Start WireGuard
log "Starting WireGuard interface..."
wg-quick up /config/wg0.conf
log "WireGuard interface is up."

# Show interface status
wg show wg0

# Print connection info
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
