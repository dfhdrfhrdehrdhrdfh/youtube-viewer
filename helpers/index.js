/* eslint-disable no-restricted-syntax */
const _random = require('lodash/random');

const { logger } = require('../utils');

const { TOR_ENABLED, NEWT_TUNNEL_ENABLED, NEWT_TUNNEL_CONTAINER } = require('../utils/constants');

const watchVideosInSequence = async (page, ipAddr, targetUrlsList, durationInSeconds, port) => {
  const tunnelLabel = NEWT_TUNNEL_ENABLED ? ` via tunnel (${NEWT_TUNNEL_CONTAINER || 'Newt'} → VPS)` : '';
  for (const url of targetUrlsList) {
    const startTime = Date.now();
    const routeLabel = TOR_ENABLED ? `via Tor IP ${ipAddr}${tunnelLabel}` : `via direct IP ${ipAddr}`;
    logger.info(`[port ${port}] Navigating to ${url} ${routeLabel} (target: ${durationInSeconds}s)`);
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForSelector('.view-count', { timeout: 5000 });
      await page.mouse.click(100, 100);
      const duration = (durationInSeconds + _random(-(durationInSeconds / 6), (durationInSeconds / 6), true));
      logger.info(`[port ${port}] Watching ${url} for ${duration.toFixed(0)}s...`);
      await page.waitFor(duration * 1000);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`[port ${port}] Finished viewing ${url} after ${elapsed}s`);
      await logger.logCount(page, url, ipAddr, duration);
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.warn(`[port ${port}] View of ${url} failed after ${elapsed}s: ${error.message || 'unknown error'}`);
      logger.logFailedAttempt(url, ipAddr);
    }
  }
};

module.exports = { watchVideosInSequence };
