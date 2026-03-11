/* eslint-disable no-restricted-syntax */
const _random = require('lodash/random');

const { logger } = require('../utils');

const watchVideosInSequence = async (page, ipAddr, targetUrlsList, durationInSeconds) => {
  for (const url of targetUrlsList) {
    const startTime = Date.now();
    logger.info(`Navigating to ${url} with IP: ${ipAddr} (target: ${durationInSeconds}s)`);
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForSelector('.view-count', { timeout: 5000 });
      await page.mouse.click(100, 100);
      const duration = (durationInSeconds + _random(-(durationInSeconds / 6), (durationInSeconds / 6), true));
      logger.info(`Watching ${url} for ${duration.toFixed(0)}s...`);
      await page.waitFor(duration * 1000);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Finished viewing ${url} after ${elapsed}s`);
      await logger.logCount(page, url, ipAddr, duration);
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.warn(`View of ${url} failed after ${elapsed}s: ${error.message || 'unknown error'}`);
      logger.logFailedAttempt(url, ipAddr);
    }
  }
};

module.exports = { watchVideosInSequence };
