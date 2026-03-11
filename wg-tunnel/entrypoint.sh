#!/bin/bash
set -e

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

VPS_WG_PORT=${VPS_WG_PORT:-51820}

log "============================================"
log " 🚀 WireGuard Tunnel Client Starting..."
log "============================================"
log "VPS Endpoint: ${VPS_IP}:${VPS_WG_PORT}"

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1
log "IP forwarding enabled."

# Create config directory
mkdir -p /config

# Write WireGuard client config
log "Writing WireGuard client configuration..."
cat > /config/wg0.conf << EOF
[Interface]
Address = 10.13.13.2/24
PrivateKey = ${WG_CLIENT_PRIVATE_KEY}

[Peer]
PublicKey = ${WG_SERVER_PUBLIC_KEY}
Endpoint = ${VPS_IP}:${VPS_WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 /config/wg0.conf

# Start WireGuard
log "Starting WireGuard interface..."
wg-quick up /config/wg0.conf
log "WireGuard interface is up."

# Auto-detect default network interface
DEFAULT_IFACE=$(ip route show default | awk '{print $5}' | head -n1)
if [ -z "${DEFAULT_IFACE}" ]; then
    DEFAULT_IFACE="eth0"
    log "Could not detect default interface, falling back to ${DEFAULT_IFACE}"
else
    log "Detected default interface: ${DEFAULT_IFACE}"
fi

# Set up iptables for NAT and forwarding
log "Configuring iptables rules..."
iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
iptables -A FORWARD -i "${DEFAULT_IFACE}" -o wg0 -j ACCEPT
iptables -A FORWARD -i wg0 -o "${DEFAULT_IFACE}" -m state --state RELATED,ESTABLISHED -j ACCEPT
log "iptables rules configured."

# Verify tunnel connectivity
log "Verifying tunnel connectivity..."
if ping -c 3 -W 5 10.13.13.1 > /dev/null 2>&1; then
    log "✅ Tunnel to VPS server (10.13.13.1) is reachable."
else
    log "⚠️  Warning: Could not ping VPS server (10.13.13.1). Tunnel may not be fully established yet."
fi

# Check external IP through tunnel
log "Checking external IP through tunnel..."
EXTERNAL_IP=$(curl -s --max-time 10 --interface wg0 https://api.ipify.org || curl -s --max-time 10 --interface wg0 https://ifconfig.me || echo "UNKNOWN")
log "External IP through tunnel: ${EXTERNAL_IP}"

log ""
log "============================================"
log " ✅ WireGuard Tunnel Client Ready!"
log "============================================"
log " VPS Endpoint:  ${VPS_IP}:${VPS_WG_PORT}"
log " Tunnel IP:     10.13.13.2"
log " External IP:   ${EXTERNAL_IP}"
log "============================================"
log ""
log "Tunnel is running. Maintaining connection..."

exec sleep infinity
