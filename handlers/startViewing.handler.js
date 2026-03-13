const _each = require('lodash/each');

const TorService = require('../services/tor.service');
const YTBrowserService = require('../services/youtubeBrowser.service');
const { logger } = require('../utils');
const { TOR_ENABLED, TOR_HOST } = require('../utils/constants');

let successes = 0;
let failures = 0;
let total = 0;

const PREFLIGHT_RETRIES = 5;
const PREFLIGHT_DELAY_MS = 3000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until all required SOCKS ports are reachable before launching browsers.
 * @param {number} startPort First SOCKS port to check.
 * @param {number} count Number of consecutive ports to check.
 */
const awaitSocksPorts = async (startPort, count) => {
  if (!TOR_ENABLED) return;
  for (let attempt = 1; attempt <= PREFLIGHT_RETRIES; attempt += 1) {
    const results = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          TorService.probeSocksPort(TOR_HOST, startPort + i)),
    );
    const unreachable = results.filter((r) => !r.ok);
    if (unreachable.length === 0) {
      logger.info(`Pre-flight: all ${count} SOCKS ports reachable`);
      return;
    }
    logger.warn(`Pre-flight: ${unreachable.length}/${count} SOCKS ports unreachable — ` +
      `attempt ${attempt}/${PREFLIGHT_RETRIES}`);
    unreachable.forEach(({ port, error }) =>
      logger.warn(`  port ${port}: ${error}`));
    if (attempt < PREFLIGHT_RETRIES) {
      await delay(PREFLIGHT_DELAY_MS);
    }
  }
  logger.warn('Pre-flight: proceeding despite unreachable ports — per-batch retries will handle failures');
};

const startViewingHandler = async (options, index) => {
  await TorService.startTor();
  await awaitSocksPorts(options.startPort, options.batchCount);
  const promiseArr = [];
  for (let i = 0; i < options.batchCount; i += 1) {
    const port = options.startPort + i;
    promiseArr.push(YTBrowserService.viewVideosInBatch({ ...options, port }));
  }
  return Promise.allSettled(promiseArr).then((settedPromises) => {
    logger.info('Batch Summary -');
    _each(settedPromises, ({ status, reason }, i) => {
      total += 1;
      const viewNum = index * options.batchCount + i + 1;
      if (status === 'fulfilled') {
        successes += 1;
        logger.info(`View ${viewNum} - SUCCESS`);
      } else {
        failures += 1;
        logger.error(`View ${viewNum} - FAILED: ${reason?.message || reason}`);
      }
    });
    logger.info(`Succeeded - ${successes}\t Failed - ${failures}\t Total - ${total}`);
  });
};

module.exports = startViewingHandler;
