const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { IS_PROD, TOR_ENABLED, TOR_HOST } = require('../utils/constants');

puppeteer.use(stealthPlugin());

// In order to run chromium processes in parallel. https://github.com/puppeteer/puppeteer/issues/594#issuecomment-325919885
process.setMaxListeners(Infinity);

const getBrowserInstance = async (port) => {
  const useTorProxy = IS_PROD && TOR_ENABLED;
  const browser = await puppeteer.launch({
    args: useTorProxy ? ['--no-sandbox', `--proxy-server=socks5://${TOR_HOST}:${port}`] : ['--no-sandbox'],
    devtools: !IS_PROD,
    executablePath: IS_PROD ? '/usr/bin/chromium-browser' : undefined,
  });
  const incognitoBrowserContext = typeof browser.createBrowserContext === 'function'
    ? browser.createBrowserContext()
    : browser.createIncognitoBrowserContext();
  incognitoBrowserContext.close = browser.close;
  return incognitoBrowserContext;
};

module.exports = {
  getBrowserInstance,
};
