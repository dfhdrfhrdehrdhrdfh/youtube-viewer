const { execWithPromise } = require('../utils/childProcessWrapper');

const { logger } = require('../utils');
const { IS_PROD, TOR_ENABLED, TOR_HOST } = require('../utils/constants');

// When TOR_HOST is not localhost, Tor is running in a separate container
const isExternalTor = TOR_HOST !== '127.0.0.1';

const writeTorConfig = async (startPort, count) => {
  if (!IS_PROD || !TOR_ENABLED) return Promise.resolve();
  if (isExternalTor) {
    logger.info('Tor is running in a separate container. Skipping local config.');
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

module.exports = { writeTorConfig, stopTor, startTor };
