#!/bin/sh
set -e

START_PORT="${TOR_START_PORT:-9052}"
NUM_PORTS="${TOR_NUM_PORTS:-6}"

echo "Generating Tor config with ${NUM_PORTS} SOCKS ports starting at ${START_PORT}..."

# Ensure directories exist with correct permissions
mkdir -p /etc/tor
mkdir -p /var/lib/tor
chown -R tor:tor /var/lib/tor
chmod 700 /var/lib/tor

# Write torrc configuration
cat > /etc/tor/torrc <<EOF
User tor
DataDirectory /var/lib/tor
Log notice stdout
EOF

for i in $(seq 0 $((NUM_PORTS - 1))); do
  PORT=$((START_PORT + i))
  echo "SocksPort 0.0.0.0:${PORT}" >> /etc/tor/torrc
done

echo "Tor config generated:"
cat /etc/tor/torrc
echo "Starting Tor..."
exec tor -f /etc/tor/torrc
