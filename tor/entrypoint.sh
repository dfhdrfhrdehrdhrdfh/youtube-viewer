#!/bin/bash
set -e

START_PORT="${TOR_START_PORT:-9052}"
NUM_PORTS="${TOR_NUM_PORTS:-6}"

echo "Generating Tor config with ${NUM_PORTS} SOCKS ports starting at ${START_PORT}..."

# Write torrc configuration
cat > /etc/tor/torrc <<EOF
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
