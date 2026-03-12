const IS_PROD = (process.env.NODE_ENV === 'production');
const SHOULD_FORCE_DEBUG_LOGS = process.env.YOUTUBE_VIEWER_FORCE_DEBUG === 'true';
const TOR_ENABLED = process.env.TOR_ENABLED !== 'false';
const TOR_HOST = process.env.TOR_HOST || '127.0.0.1';
const IP_GETTER_URL = 'https://api.ipify.org/';
const TUNNEL_ENABLED = process.env.TUNNEL_ENABLED === 'true';
const VPS_IP = process.env.VPS_IP || '';

/**
 * All settings can be configured via environment variables.
 * START_PORT - Port TOR will start using from for SOCKS proxy.
 * BATCH_COUNT - Number of parallel chromium instances to run.
 * TOTAL_COUNT - Total number of view actions. Ensure this number is exactly divisible by BATCH_COUNT for optimal resource usage.
 * VIEW_ACTION_COUNT - A single browsing session will watch these many videos sequentially.
 * VIEW_DURATION - Max duration of a single view in seconds. Actual view duration will be +/- 16.6% of this number.
 * PAGE_DEFAULT_TIMEOUT - Max duration in seconds to wait for any action in the page.
 */
const START_PORT = parseInt(process.env.TOR_START_PORT, 10) || 9052;
const BATCH_COUNT = parseInt(process.env.BATCH_COUNT, 10) || (IS_PROD ? 6 : 1);
const TOTAL_COUNT = parseInt(process.env.TOTAL_COUNT, 10) || 96;
const VIEW_ACTION_COUNT = parseInt(process.env.VIEW_ACTION_COUNT, 10) || 10;
const VIEW_DURATION = parseInt(process.env.VIEW_DURATION, 10) || 50;
const PAGE_DEFAULT_TIMEOUT = parseInt(process.env.PAGE_DEFAULT_TIMEOUT, 10) || 600;

module.exports = {
  IS_PROD,
  SHOULD_FORCE_DEBUG_LOGS,
  TOR_ENABLED,
  TOR_HOST,
  IP_GETTER_URL,
  TUNNEL_ENABLED,
  VPS_IP,

  START_PORT,
  BATCH_COUNT,
  TOTAL_COUNT,
  VIEW_ACTION_COUNT,
  VIEW_DURATION,
  PAGE_DEFAULT_TIMEOUT,
};
