const chalk = require('chalk');
const EventEmitter = require('events');

const { IS_PROD, SHOULD_FORCE_DEBUG_LOGS } = require('./constants');

const store = {};
const STORE_MAX_ENTRIES = 100;

// ── In-memory ring buffer & emitter for the web UI ──────────────────────
const LOG_BUFFER_MAX = 500;
const logBuffer = [];
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

const pushToBuffer = (level, message) => {
  const entry = { timestamp: new Date().toISOString(), level, message };
  if (logBuffer.length >= LOG_BUFFER_MAX) logBuffer.shift();
  logBuffer.push(entry);
  logEmitter.emit('log', entry);
};

// ── Cap the store at STORE_MAX_ENTRIES ───────────────────────────────────
const storeKeys = [];
const ensureStoreCap = (url) => {
  if (!store[url] && storeKeys.length >= STORE_MAX_ENTRIES) {
    const oldest = storeKeys.shift();
    delete store[oldest];
  }
  if (!store[url]) storeKeys.push(url);
};

const info = (message) => {
  console.log(`${chalk.white.inverse(` [${(new Date()).toLocaleTimeString()}] - INFO    `)} ${chalk.white(message)}`);
  pushToBuffer('INFO', message);
};
const error = (message) => {
  console.log(`${chalk.red.inverse(` [${(new Date()).toLocaleTimeString()}] - ERROR   `)} ${chalk.red(message)}`);
  pushToBuffer('ERROR', message);
};
const success = (message) => {
  console.log(`${chalk.green.inverse(` [${(new Date()).toLocaleTimeString()}] - SUCCESS `)} ${chalk.green(message)}`);
  pushToBuffer('SUCCESS', message);
};
const debug = (message) => {
  if (!SHOULD_FORCE_DEBUG_LOGS && IS_PROD) return;
  console.log(`${chalk.magenta.inverse(` [${(new Date()).toLocaleTimeString()}] - DEBUG   `)} ${chalk.magenta(message)}`);
  pushToBuffer('DEBUG', message);
};
const warn = (message) => {
  console.log(`${chalk.yellow.inverse(` [${(new Date()).toLocaleTimeString()}] - WARN    `)} ${chalk.yellow(message)}`);
  pushToBuffer('WARN', message);
};

const logFailedAttempt = (url, ipAddr) => {
  warn(`An attempt to view ${url} with IP: ${ipAddr} was probably blocked.`);
};

const logCount = async (page, url, ipAddr, duration) => {
  try {
    const currentLiveViewCount = await page.$eval('.view-count', (viewCountNode) => viewCountNode.innerText.replace(/[^0-9]/g, ''));
    ensureStoreCap(url);
    if (!store[url]) store[url] = { initial: currentLiveViewCount };
    store[url].current = currentLiveViewCount;
    store[url].added = store[url].current - store[url].initial;
    success(`Attempted ${url} with IP: ${ipAddr} for ${duration} seconds. (Init View Count: ${store[url].initial} Current View Count: ${store[url].current} Views added this session: ${store[url].added})`);
  } catch {
    logFailedAttempt(url, ipAddr);
  }
};

module.exports = {
  logCount,
  logFailedAttempt,
  info,
  error,
  warn,
  success,
  debug,
  logBuffer,
  logEmitter,
};
