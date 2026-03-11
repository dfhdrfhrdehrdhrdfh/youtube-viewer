const net = require('net');
const { execWithPromise } = require('../utils/childProcessWrapper');

const { logger } = require('../utils');
const { IS_PROD, TOR_ENABLED, TOR_HOST, NEWT_TUNNEL_ENABLED, NEWT_TUNNEL_CONTAINER } = require('../utils/constants');

// When TOR_HOST is not localhost, Tor is running in a separate container
const isExternalTor = TOR_HOST !== '127.0.0.1';

/**
 * Test whether a single SOCKS port on the Tor container is reachable.
 * Returns a promise that resolves to { port, ok, ms } or { port, ok: false, error }.
 */
const probeSocksPort = (host, port, timeoutMs = 5000) => new Promise((resolve) => {
  const start = Date.now();
  const sock = new net.Socket();
  sock.setTimeout(timeoutMs);
  sock.once('connect', () => {
    const ms = Date.now() - start;
    sock.destroy();
    resolve({ port, ok: true, ms });
  });
  sock.once('timeout', () => {
    sock.destroy();
    resolve({ port, ok: false, error: 'timeout' });
  });
  sock.once('error', (err) => {
    sock.destroy();
    resolve({ port, ok: false, error: err.message });
  });
  sock.connect(port, host);
});

/**
 * Verify connectivity to all Tor SOCKS proxy ports and log results.
 */
const verifyTorConnectivity = async (startPort, count) => {
  logger.info('─────────────────────────────────────────');
  logger.info('  Tor Connectivity Check');
  logger.info('─────────────────────────────────────────');
  logger.info(`Tor host: ${TOR_HOST} | Ports: ${startPort}–${startPort + count - 1}`);
  logger.info(`Newt tunnel: ${NEWT_TUNNEL_ENABLED ? `ENABLED (container: ${NEWT_TUNNEL_CONTAINER || 'unknown'})` : 'DISABLED (direct internet)'}`);

  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => probeSocksPort(TOR_HOST, startPort + i)),
  );

  let allOk = true;
  results.forEach(({ port, ok, ms, error }) => {
    if (ok) {
      logger.success(`  SOCKS port ${port} → reachable (${ms}ms)`);
    } else {
      allOk = false;
      logger.error(`  SOCKS port ${port} → UNREACHABLE (${error})`);
    }
  });

  if (allOk) {
    logger.success(`All ${count} Tor SOCKS ports are reachable on ${TOR_HOST}.`);
    logger.info('Chromium browsers will be configured with --proxy-server=socks5://' + `${TOR_HOST}:<port>`);
    logger.info('After launch, each browser will fetch its IP — if the IP differs from your server IP, Tor is working.');
    if (NEWT_TUNNEL_ENABLED) {
      logger.info(`Tunnel routing: ytviewer → tor (${TOR_HOST}) → ${NEWT_TUNNEL_CONTAINER || 'Newt'} → VPS → Internet`);
      logger.info('The Tor exit IP should match or relate to your VPS public IP, NOT your local server IP.');
    }
  } else {
    logger.warn('Some Tor SOCKS ports are unreachable. Affected batches will fail.');
  }
  logger.info('─────────────────────────────────────────');
  return allOk;
};

const writeTorConfig = async (startPort, count) => {
  if (!IS_PROD || !TOR_ENABLED) return Promise.resolve();
  if (isExternalTor) {
    logger.info('Tor is running in a separate container. Skipping local config.');
    await verifyTorConnectivity(startPort, count);
    return Promise.resolve();
  }
  logger.info('App running in production. Will use rotating proxy via TOR.');
  logger.info(' Writing Tor Config');
  await execWithPromise('touch /etc/tor/torrc && echo > /etc/tor/torrc');
  const promiseArr = [];
  for (let i = 0; i < count; i += 1) {
    const port = startPort + i;
    promiseArr.push(
      execWithPromise(
        `echo "SocksPort ${port}" >> /etc/tor/torrc`,
      ).then(() => logger.debug(`PORT ${port} written in tor config`)),
    );
  }
  return Promise.all(promiseArr).then(() => {
    logger.success('Tor Config written successfully.');
  }).catch((error) => {
    logger.error('One or more ports couldn\'t be written into tor config.');
    logger.debug(error);
    throw new Error();
  });
};

const stopTor = async () => {
  if (!IS_PROD || !TOR_ENABLED || isExternalTor) return;
  try {
    await execWithPromise('pkill -9 -f "tor"');
  } catch (error) {
    logger.warn('Failed to stop TOR. Usually this is a no op but ensure the subsequent attempts are using different IPs.');
    logger.debug(error);
  }
};

const startTor = async () => {
  if (!IS_PROD || !TOR_ENABLED) return;
  if (isExternalTor) {
    logger.info('Tor is running in a separate container. Skipping local start.');
    return;
  }
  logger.info('Starting TOR.');
  await stopTor();
  try {
    await execWithPromise('/usr/bin/tor --RunAsDaemon 1');
    logger.success('Started TOR successfully');
  } catch (error) {
    logger.error('Failed to start TOR.');
    logger.debug(error);
    throw new Error();
  }
};

module.exports = { writeTorConfig, stopTor, startTor, verifyTorConnectivity };
