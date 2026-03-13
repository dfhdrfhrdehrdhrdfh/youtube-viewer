const { execSync } = require('child_process');
const https = require('https');
const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const { logEmitter } = require('./utils/logger');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION,
  VIEW_ACTION_COUNT, PAGE_DEFAULT_TIMEOUT, IS_PROD,
} = require('./utils/constants');

const agents = new Map();
let nextAgentId = 1;
const MAX_COMPLETED_AGENTS = 50;

// ── Port allocation ─────────────────────────────────────────────────────
// All agents share the same Tor SOCKS port range (START_PORT … START_PORT +
// BATCH_COUNT - 1).  Tor supports multiplexing on a single SOCKS port, so
// there is no need for exclusive per-agent port blocks.
function allocatePortBlock() {
  return START_PORT;
}

// ── Evict oldest completed/failed agents when cap exceeded ──────────────
function evictOldAgents() {
  if (agents.size <= MAX_COMPLETED_AGENTS) return;
  const finished = Array.from(agents.values())
      .filter((a) => a.status === 'completed' || a.status === 'failed' || a.status === 'stopped')
      .sort((a, b) => a.startTime - b.startTime);
  while (agents.size > MAX_COMPLETED_AGENTS && finished.length > 0) {
    const old = finished.shift();
    agents.delete(old.name);
  }
}

// ── Resource cleanup when all agents are idle ───────────────────────────
function cleanupIfIdle() {
  const running = Array.from(agents.values())
      .some((a) => a.status === 'running' || a.status === 'stopping');
  if (running) return;

  logger.info('All agents idle — cleaning up resources to reduce memory usage');

  // Kill orphaned chromium-browser processes (production only)
  if (IS_PROD) {
    try {
      const pids = execSync('pgrep -f chromium-browser 2>/dev/null || true', { encoding: 'utf8' }).trim();
      if (pids) {
        const pidList = pids.split('\n').filter(Boolean);
        pidList.forEach((pid) => {
          try {
            process.kill(parseInt(pid, 10), 'SIGKILL');
          } catch (killErr) {
            if (killErr.code !== 'ESRCH') {
              logger.debug(`Could not kill PID ${pid}: ${killErr.message}`);
            }
          }
        });
        logger.info(`Killed ${pidList.length} orphaned chromium process(es)`);
      }
    } catch (pgrepErr) {
      logger.debug(`Chromium cleanup skipped: ${pgrepErr.message}`);
    }
  }

  // Request garbage collection if --expose-gc was used
  if (typeof global.gc === 'function') {
    global.gc();
    logger.info('Garbage collection completed');
  }

  const mem = process.memoryUsage();
  logger.info(`Memory after cleanup: RSS ${Math.round(mem.rss / 1024 / 1024)}MB, Heap ${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
}

function getTargetUrls(videoUrl) {
  if (videoUrl) return [videoUrl];
  if (process.env.VIDEO_URLS || process.env.YOUTUBE_URLS) {
    const urls = (process.env.VIDEO_URLS || process.env.YOUTUBE_URLS).split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return urlReader('urls.txt');
}

// ── Fetch video title from YouTube oEmbed ───────────────────────────────
function fetchVideoTitle(youtubeUrl) {
  return new Promise((resolve) => {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
    const req = https.get(oembedUrl, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.title || null);
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

// ── Listen for Tor exit IPs and view counts in log messages ─────────────
logEmitter.on('log', (entry) => {
  if (!entry || !entry.message || typeof entry.message !== 'string') return;
  const msg = entry.message;

  // Capture Tor exit IPs: "[port XXXX] Tor exit IP: X.X.X.X ..."
  const ipMatch = msg.match(/Tor exit IP:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
  if (ipMatch) {
    const ip = ipMatch[1];
    for (const agent of agents.values()) {
      if (agent.status === 'running') {
        if (!agent.torExitIps.includes(ip)) {
          agent.torExitIps.push(ip);
        }
      }
    }
  }

  // Capture view counts from logCount: "Init View Count: X Current View Count: Y Views added this session: Z"
  const countMatch = msg.match(/Attempted (https?:\/\/[^\s]+) with IP:.+Init View Count:\s*(\d+)\s+Current View Count:\s*(\d+)\s+Views added this session:\s*(-?\d+)/);
  if (countMatch) {
    const url = countMatch[1];
    const initial = parseInt(countMatch[2], 10);
    const current = parseInt(countMatch[3], 10);
    const added = parseInt(countMatch[4], 10);
    for (const agent of agents.values()) {
      if (agent.status === 'running') {
        if (!agent.viewCounts[url]) {
          agent.viewCounts[url] = { initial, current, added };
        } else {
          agent.viewCounts[url].current = current;
          agent.viewCounts[url].added = added;
        }
      }
    }
  }
});

async function runAgentTask(agentName, abortSignal, config) {
  const agent = agents.get(agentName);
  const targetUrls = getTargetUrls(config.videoUrl);
  const totalRounds = Math.ceil(config.totalCount / config.batchCount);

  if (agent) {
    agent.totalRounds = totalRounds;
    agent.totalViews = config.totalCount;
  }

  logger.info(`[${agentName}] Starting — ${config.totalCount} views (${config.batchCount} parallel × ${totalRounds} rounds)`);
  logger.info(`[${agentName}] Target URL(s): ${targetUrls.join(', ')}`);

  for (let i = 0; i < totalRounds; i += 1) {
    if (abortSignal.aborted) {
      logger.info(`[${agentName}] Stopped by user after round ${i}`);
      return;
    }
    if (agent) agent.currentRound = i + 1;
    logger.info(`[${agentName}] ── Round ${i + 1} of ${totalRounds} ──`);

    // Set current view info for live progress display
    if (agent) {
      agent.currentViewDuration = config.viewDuration;
      agent.currentViewStartTime = new Date().toISOString();
    }

    const result = await startViewingHandler({
      targetUrls,
      durationInSeconds: config.viewDuration,
      batchCount: config.batchCount,
      startPort: config.startPort,
      viewActionCount: config.viewActionCount,
      pageDefaultTimeout: config.pageDefaultTimeout,
    }, i);

    // Clear view timer between rounds
    if (agent) {
      agent.currentViewDuration = null;
      agent.currentViewStartTime = null;
    }

    if (agent && result) {
      agent.completedViews += result.total;
      agent.viewsSucceeded += result.successes;
      agent.viewsFailed += result.failures;
    }
  }

  logger.success(`[${agentName}] All ${totalRounds} rounds completed`);
}

function startAgent(optionalConfig) {
  // Handle optional name parameter
  let agentName;
  if (optionalConfig && optionalConfig.name && optionalConfig.name.trim()) {
    agentName = optionalConfig.name.trim();
    // Validate name: only alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
      throw new Error('Agent name must contain only alphanumeric characters, hyphens, and underscores');
    }
    // Check for duplicate names
    if (agents.has(agentName)) {
      throw new Error(`Agent name '${agentName}' is already in use`);
    }
  } else {
    agentName = `agent${nextAgentId}`;
    nextAgentId += 1;
  }

  const requestedBatch = (optionalConfig && optionalConfig.batchCount) || BATCH_COUNT;
  const batchCount = Math.min(requestedBatch, BATCH_COUNT);
  const portStart = allocatePortBlock();

  const config = {
    videoUrl: (optionalConfig && optionalConfig.videoUrl) || null,
    batchCount,
    totalCount: (optionalConfig && optionalConfig.totalCount) || TOTAL_COUNT,
    viewDuration: (optionalConfig && optionalConfig.viewDuration) || VIEW_DURATION,
    viewActionCount: (optionalConfig && optionalConfig.viewActionCount) || VIEW_ACTION_COUNT,
    pageDefaultTimeout: (optionalConfig && optionalConfig.pageDefaultTimeout) || PAGE_DEFAULT_TIMEOUT,
    startPort: portStart,
  };

  const abortSignal = { aborted: false };

  const agentObj = {
    name: agentName,
    status: 'running',
    startTime: new Date(),
    endTime: null,
    abortSignal,
    promise: null,
    config,
    currentRound: 0,
    totalRounds: Math.ceil(config.totalCount / config.batchCount),
    completedViews: 0,
    totalViews: config.totalCount,
    videoTitle: null,
    torExitIps: [],
    viewsSucceeded: 0,
    viewsFailed: 0,
    viewCounts: {},
    currentViewDuration: null,
    currentViewStartTime: null,
  };

  agents.set(agentName, agentObj);

  // Fetch video title asynchronously (best-effort)
  const videoUrl = config.videoUrl;
  if (videoUrl) {
    fetchVideoTitle(videoUrl).then((title) => {
      const agent = agents.get(agentName);
      if (agent) agent.videoTitle = title;
    });
  }

  const promise = runAgentTask(agentName, abortSignal, config)
      .then(() => {
        const agent = agents.get(agentName);
        if (agent) {
          agent.status = agent.status === 'stopping' ? 'stopped' : 'completed';
          agent.endTime = new Date();
          agent.currentViewDuration = null;
          agent.currentViewStartTime = null;
          logger.info(`[${agentName}] Finished (${agent.status})`);
        }
      })
      .catch((err) => {
        const agent = agents.get(agentName);
        if (agent) {
          agent.status = 'failed';
          agent.endTime = new Date();
          agent.currentViewDuration = null;
          agent.currentViewStartTime = null;
        }
        logger.error(`[${agentName}] Failed: ${err.message || err}`);
      })
      .finally(() => {
        evictOldAgents();
        // Delay cleanup slightly so the agent status update is fully committed
        setTimeout(cleanupIfIdle, 5000);
      });

  agentObj.promise = promise;

  evictOldAgents();
  logger.info(`[${agentName}] Agent created and running`);
  return agentName;
}

function stopAgent(agentName) {
  const agent = agents.get(agentName);
  if (!agent) {
    return { success: false, message: `Agent '${agentName}' not found` };
  }
  if (agent.status !== 'running') {
    return { success: false, message: `Agent '${agentName}' is not running (status: ${agent.status})` };
  }
  agent.abortSignal.aborted = true;
  agent.status = 'stopping';
  logger.info(`[${agentName}] Stop requested — will stop after current round`);
  return { success: true, message: `Agent '${agentName}' will stop after current round completes` };
}

function removeAgent(agentName) {
  const agent = agents.get(agentName);
  if (!agent) {
    return { success: false, message: `Agent '${agentName}' not found` };
  }
  if (agent.status === 'running' || agent.status === 'stopping') {
    return { success: false, message: `Agent '${agentName}' is still active (status: ${agent.status})` };
  }
  agents.delete(agentName);
  return { success: true, message: `Agent '${agentName}' removed` };
}

function listAgents() {
  return Array.from(agents.values()).map((a) => {
    const sessionDuration = a.endTime ?
      Math.floor((a.endTime.getTime() - a.startTime.getTime()) / 1000) :
      null;

    return {
      name: a.name,
      status: a.status,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime ? a.endTime.toISOString() : null,
      config: {
        videoUrl: a.config.videoUrl,
        batchCount: a.config.batchCount,
        totalCount: a.config.totalCount,
        viewDuration: a.config.viewDuration,
        viewActionCount: a.config.viewActionCount,
        pageDefaultTimeout: a.config.pageDefaultTimeout,
      },
      currentRound: a.currentRound,
      totalRounds: a.totalRounds,
      completedViews: a.completedViews,
      totalViews: a.totalViews,
      videoTitle: a.videoTitle || null,
      torExitIps: a.torExitIps || [],
      viewsSucceeded: a.viewsSucceeded || 0,
      viewsFailed: a.viewsFailed || 0,
      viewCounts: a.viewCounts || {},
      sessionDuration,
      currentViewDuration: a.currentViewDuration || null,
      currentViewStartTime: a.currentViewStartTime || null,
    };
  });
}

function getAgent(agentName) {
  return agents.get(agentName) || null;
}

module.exports = { startAgent, stopAgent, removeAgent, listAgents, getAgent };
