const TorService = require('./services/tor.service');
const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION,
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
    logger.info(`Preparing to generate ${TOTAL_COUNT} views. Target URL(s): ${targetUrls} Duration: ${VIEW_DURATION} seconds`);
    await TorService.writeTorConfig(START_PORT, BATCH_COUNT);

    for (let i = 0; i < Math.ceil(TOTAL_COUNT / BATCH_COUNT); i += 1) {
      await startViewingHandler({
        targetUrls, durationInSeconds: VIEW_DURATION, batchCount: BATCH_COUNT, startPort: START_PORT,
      }, i);
    }
    await TorService.stopTor();
  } catch {
    logger.error('Failed to initialise. There should be an additional error message logged above.');
  } finally {
    process.exit(1); // container restarts with non zero exit
  }
}

main();
