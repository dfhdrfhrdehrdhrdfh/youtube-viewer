const _each = require('lodash/each');

const TorService = require('../services/tor.service');
const VideoBrowserService = require('../services/videoBrowser.service');
const { logger } = require('../utils');

const startViewingHandler = async (options, index) => {
  let successes = 0;
  let failures = 0;
  let total = 0;

  await TorService.startTor();
  const promiseArr = [];
  for (let i = 0; i < options.batchCount; i += 1) {
    const port = options.startPort + i;
    promiseArr.push(VideoBrowserService.viewVideosInBatch({ ...options, port }));
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
    return { successes, failures, total };
  });
};

module.exports = startViewingHandler;
