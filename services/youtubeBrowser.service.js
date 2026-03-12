const _shuffle = require('lodash/shuffle');
const _take = require('lodash/take');

const puppeteer = require('../core/puppeteer');
const { watchVideosInSequence } = require('../helpers');
const { logger } = require('../utils');
const {
  VIEW_ACTION_COUNT, IP_GETTER_URL, PAGE_DEFAULT_TIMEOUT, TOR_ENABLED, TOR_HOST,
  TUNNEL_ENABLED, VPS_IP,
} = require('../utils/constants');
const { getContainerDirectIp } = require('./tor.service');

const getCurrentIP = async (page) => {
  await page.goto(IP_GETTER_URL, { waitUntil: 'load' });
  return page.$eval('body', (body) => body.innerText);
};

const handlePageCrash = (page) => (error) => {
  logger.error('Browser page crashed');
  logger.debug(error);
  page.close();
};

const viewVideosInBatch = async (options) => {
  const { targetUrls, durationInSeconds, port } = options;
  const actionCount = options.viewActionCount || VIEW_ACTION_COUNT;
  const pageTimeout = options.pageDefaultTimeout || PAGE_DEFAULT_TIMEOUT;
  let browser;
  try {
    const proxyUrl = `socks5://${TOR_HOST}:${port}`;
    const tunnelLabel = TUNNEL_ENABLED ? ' | tunnel: WireGuard → VPS' : '';
    logger.info(`[port ${port}] Launching browser with proxy: ${TOR_ENABLED ? proxyUrl : 'DIRECT (Tor disabled)'}${tunnelLabel}`);
    browser = await puppeteer.getBrowserInstance(port);
    const page = await browser.newPage();
    await page.setBypassCSP(true);
    page.setDefaultTimeout(pageTimeout * 1000);
    page.on('error', handlePageCrash(page));
    page.on('pageerror', handlePageCrash(page));

    await page.setViewport({
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
    });
    const ipAddr = await getCurrentIP(page);
    const directIp = getContainerDirectIp();
    // Only use directIp for comparison when the uplink check actually returned a real IP.
    const directIpKnown = directIp && !directIp.startsWith('check-failed');

    if (TOR_ENABLED) {
      if (TUNNEL_ENABLED) {
        logger.success(`[port ${port}] Tor exit IP: ${ipAddr} (via Tor network, tunneled through VPS)`);
        logger.info(`[port ${port}] Note: Tor exit IP is a random Tor relay, NOT the VPS IP. This is expected.`);
        if (VPS_IP) {
          logger.info(`[port ${port}] To verify tunnel: check tor-proxy logs — uplink IP should be ${VPS_IP}`);
        }
        // Only flag a REAL problem: exit IP matching the container's direct IP means Tor is not proxying
        if (directIpKnown && ipAddr === directIp) {
          logger.error(`[port ${port}] ❌ CRITICAL: Exit IP ${ipAddr} matches container direct IP — Tor is NOT proxying traffic!`);
        }
      } else {
        logger.success(`[port ${port}] Tor exit IP: ${ipAddr}`);
        if (directIpKnown && ipAddr !== directIp) {
          logger.success(`[port ${port}] ✓ Tor routing OK — exit IP ${ipAddr} differs from container uplink IP ${directIp}`);
        } else if (directIpKnown && ipAddr === directIp) {
          logger.warn(`[port ${port}] ⚠ Tor routing SUSPECT — exit IP ${ipAddr} matches container direct IP (Tor may not be routing)`);
        } else {
          logger.info(`[port ${port}] If exit IP ${ipAddr} differs from your server's public IP, Tor is working correctly.`);
        }
      }
      logger.info(`[port ${port}] The Tor container logs should now show a "New SOCKS connection" for this request.`);
    } else {
      logger.warn(`[port ${port}] Tor is DISABLED — using direct IP: ${ipAddr}`);
    }

    const targetUrlsForAction = _take(_shuffle(targetUrls), actionCount);
    await watchVideosInSequence(page, ipAddr, targetUrlsForAction, durationInSeconds, port);
    await page.close();
  } catch (error) {
    logger.error(`Batch failed on port ${port}: ${error.message || error}`);
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

module.exports = { getCurrentIP, viewVideosInBatch };
