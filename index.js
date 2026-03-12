const TorService = require('./services/tor.service');
const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION, TOR_ENABLED, TOR_HOST,
  TUNNEL_ENABLED,
} = require('./utils/constants');

function getTargetUrls() {
  // Read URLs from YOUTUBE_URLS environment variable (comma-separated)
  if (process.env.YOUTUBE_URLS) {
    const urls = process.env.YOUTUBE_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  // Fallback to urls.txt file
  return urlReader('urls.txt');
}

async function main() {
  try {
    const targetUrls = getTargetUrls();

    // ── Startup banner ──────────────────────────────────────────────
    logger.info('=============================================');
    logger.info('  YouTube Viewer — Starting');
    logger.info('=============================================');
    logger.info(`Target URL(s) : ${targetUrls.join(', ')}`);
    logger.info(`Total views   : ${TOTAL_COUNT}  (${BATCH_COUNT} parallel × ${Math.ceil(TOTAL_COUNT / BATCH_COUNT)} rounds)`);
    logger.info(`View duration : ~${VIEW_DURATION}s (±16.6%)`);
    logger.info(`Tor enabled   : ${TOR_ENABLED}`);
    if (TOR_ENABLED) {
      logger.info(`Tor host      : ${TOR_HOST}`);
      logger.info(`SOCKS ports   : ${START_PORT}–${START_PORT + BATCH_COUNT - 1}`);
    }
    logger.info('─────────────────────────────────────────────');
    logger.info(`VPS tunnel    : ${TUNNEL_ENABLED ? 'ENABLED (WireGuard)' : 'DISABLED'}`);
    if (TUNNEL_ENABLED) {
      logger.info('Traffic route   : ytviewer → tor → WireGuard → VPS → Internet');
    } else {
      logger.info('Traffic route   : ytviewer → tor → Internet (direct)');
    }
    logger.info('=============================================');

    await TorService.writeTorConfig(START_PORT, BATCH_COUNT);

    for (let i = 0; i < Math.ceil(TOTAL_COUNT / BATCH_COUNT); i += 1) {
      logger.info(`── Round ${i + 1} of ${Math.ceil(TOTAL_COUNT / BATCH_COUNT)} ──`);
      await startViewingHandler({
        targetUrls, durationInSeconds: VIEW_DURATION, batchCount: BATCH_COUNT, startPort: START_PORT,
      }, i);
    }
    await TorService.stopTor();
    process.exit(0);
  } catch (error) {
    logger.error(`Failed to initialise: ${error.message || error}`);
  } finally {
    process.exit(1); // container restarts with non zero exit
  }
}

main();
