const _shuffle = require('lodash/shuffle');
const _take = require('lodash/take');

const puppeteer = require('../core/puppeteer');
const { watchVideosInSequence } = require('../helpers');
const { logger } = require('../utils');
const {
  VIEW_ACTION_COUNT, IP_GETTER_URL, PAGE_DEFAULT_TIMEOUT, TOR_ENABLED, TOR_HOST,
  TUNNEL_ENABLED, VPS_IP,
} = require('../utils/constants');
const { getContainerDirectIp, probeSocksPort } = require('./tor.service');

const MAX_PROXY_RETRIES = 3;
const PROXY_RETRY_DELAY_MS = 5000;

const getCurrentIP = async (page) => {
  await page.goto(IP_GETTER_URL, { waitUntil: 'load' });
  return page.$eval('body', (body) => body.innerText);
};

const handlePageCrash = (page) => (error) => {
  logger.error('Browser page crashed');
  logger.debug(error);
  page.close();
};

const isProxyError = (error) => {
  const msg = (error && error.message) || '';
  return msg.includes('ERR_PROXY_CONNECTION_FAILED') ||
    msg.includes('ERR_SOCKS_CONNECTION_FAILED') ||
    msg.includes('ERR_TUNNEL_CONNECTION_FAILED');
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const verifyTorIp = (ipAddr, port) => {
  const directIp = getContainerDirectIp();
  const directIpKnown = directIp && !directIp.startsWith('check-failed');

  if (TOR_ENABLED) {
    if (TUNNEL_ENABLED) {
      logger.success(`[port ${port}] ✓ Tor exit IP: ${ipAddr} (via Tor → WireGuard → VPS)`);
      if (VPS_IP) {
        logger.info(`[port ${port}] Verify tunnel in tor-proxy logs — uplink should be ${VPS_IP}`);
      }
      if (directIpKnown && ipAddr === directIp) {
        logger.error(`[port ${port}] ❌ CRITICAL: Exit IP ${ipAddr} matches container direct IP — Tor is NOT proxying!`);
        throw new Error(`Tor not proxying on port ${port}: exit IP ${ipAddr} matches container direct IP`);
      }
    } else {
      logger.success(`[port ${port}] Tor exit IP: ${ipAddr}`);
      if (directIpKnown && ipAddr !== directIp) {
        logger.success(`[port ${port}] ✓ Tor routing OK — exit IP ${ipAddr} differs from container uplink IP ${directIp}`);
      } else if (directIpKnown && ipAddr === directIp) {
        logger.error(`[port ${port}] ❌ Tor routing FAILED — exit IP ${ipAddr} matches container direct IP`);
        throw new Error(`Tor not proxying on port ${port}: exit IP ${ipAddr} matches container direct IP`);
      } else {
        logger.info(`[port ${port}] If exit IP ${ipAddr} differs from your server's public IP, Tor is working correctly.`);
      }
    }
    logger.info(`[port ${port}] The Tor container logs should show a "New SOCKS connection" for this request.`);
  } else {
    logger.warn(`[port ${port}] Tor is DISABLED — using direct IP: ${ipAddr}`);
  }
};

const tryViewBatch = async ({ targetUrls, durationInSeconds, port }) => {
  let browser;
  try {
    const proxyUrl = `socks5://${TOR_HOST}:${port}`;
    const tunnelLabel = TUNNEL_ENABLED ? ' | tunnel: WireGuard → VPS' : '';
    logger.info(`[port ${port}] Launching browser with proxy: ${TOR_ENABLED ? proxyUrl : 'DIRECT (Tor disabled)'}${tunnelLabel}`);
    browser = await puppeteer.getBrowserInstance(port);
    const page = await browser.newPage();
    await page.setBypassCSP(true);
    page.setDefaultTimeout(PAGE_DEFAULT_TIMEOUT * 1000);
    page.on('error', handlePageCrash(page));
    page.on('pageerror', handlePageCrash(page));

    await page.setViewport({
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
    });
    const ipAddr = await getCurrentIP(page);
    verifyTorIp(ipAddr, port);

    const targetUrlsForAction = _take(_shuffle(targetUrls), VIEW_ACTION_COUNT);
    await watchVideosInSequence(page, ipAddr, targetUrlsForAction, durationInSeconds, port);
    await page.close();
  } catch (error) {
    logger.debug(`[port ${port}] tryViewBatch error: ${error.message || error}`);
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        logger.debug(`Browser close error: ${closeError.message || closeError}`);
      }
    }
  }
};

const viewVideosInBatch = async (options) => {
  const { port } = options;
  for (let attempt = 1; attempt <= MAX_PROXY_RETRIES; attempt += 1) {
    if (TOR_ENABLED) {
      const probe = await probeSocksPort(TOR_HOST, port);
      if (!probe.ok) {
        logger.warn(`[port ${port}] SOCKS port unreachable (${probe.error}) — attempt ${attempt}/${MAX_PROXY_RETRIES}`);
        if (attempt < MAX_PROXY_RETRIES) {
          await delay(PROXY_RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`SOCKS port ${port} on ${TOR_HOST} unreachable after ${MAX_PROXY_RETRIES} attempts: ${probe.error}`);
      }
      logger.info(`[port ${port}] SOCKS pre-check passed (${probe.ms}ms)`);
    }

    try {
      await tryViewBatch(options);
      return;
    } catch (error) {
      if (isProxyError(error) && attempt < MAX_PROXY_RETRIES) {
        logger.warn(`[port ${port}] Proxy connection failed — retrying in ${PROXY_RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_PROXY_RETRIES})`);
        await delay(PROXY_RETRY_DELAY_MS);
      } else {
        logger.error(`Batch failed on port ${port}: ${error.message || error}`);
        throw error;
      }
    }
  }
};

module.exports = { getCurrentIP, viewVideosInBatch };
