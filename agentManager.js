const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION,
  VIEW_ACTION_COUNT, PAGE_DEFAULT_TIMEOUT,
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

function getTargetUrls(youtubeUrl) {
  if (youtubeUrl) return [youtubeUrl];
  if (process.env.YOUTUBE_URLS) {
    const urls = process.env.YOUTUBE_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return urlReader('urls.txt');
}

async function runAgentTask(agentName, abortSignal, config) {
  const agent = agents.get(agentName);
  const targetUrls = getTargetUrls(config.youtubeUrl);
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
    const result = await startViewingHandler({
      targetUrls,
      durationInSeconds: config.viewDuration,
      batchCount: config.batchCount,
      startPort: config.startPort,
      viewActionCount: config.viewActionCount,
      pageDefaultTimeout: config.pageDefaultTimeout,
    }, i);
    if (agent && result) {
      agent.completedViews += result.successes;
    }
  }

  logger.success(`[${agentName}] All ${totalRounds} rounds completed`);
}

function startAgent(optionalConfig) {
  const agentName = `agent${nextAgentId}`;
  nextAgentId += 1;

  const requestedBatch = (optionalConfig && optionalConfig.batchCount) || BATCH_COUNT;
  const batchCount = Math.min(requestedBatch, BATCH_COUNT);
  const portStart = allocatePortBlock();

  const config = {
    youtubeUrl: (optionalConfig && optionalConfig.youtubeUrl) || null,
    batchCount,
    totalCount: (optionalConfig && optionalConfig.totalCount) || TOTAL_COUNT,
    viewDuration: (optionalConfig && optionalConfig.viewDuration) || VIEW_DURATION,
    viewActionCount: (optionalConfig && optionalConfig.viewActionCount) || VIEW_ACTION_COUNT,
    pageDefaultTimeout: (optionalConfig && optionalConfig.pageDefaultTimeout) || PAGE_DEFAULT_TIMEOUT,
    startPort: portStart,
  };

  const abortSignal = { aborted: false };

  const promise = runAgentTask(agentName, abortSignal, config)
    .then(() => {
      const agent = agents.get(agentName);
      if (agent) {
        agent.status = agent.status === 'stopping' ? 'stopped' : 'completed';
        logger.info(`[${agentName}] Finished (${agent.status})`);
      }
    })
    .catch((err) => {
      const agent = agents.get(agentName);
      if (agent) agent.status = 'failed';
      logger.error(`[${agentName}] Failed: ${err.message || err}`);
    })
    .finally(() => {
      evictOldAgents();
    });

  agents.set(agentName, {
    name: agentName,
    status: 'running',
    startTime: new Date(),
    abortSignal,
    promise,
    config,
    currentRound: 0,
    totalRounds: Math.ceil(config.totalCount / config.batchCount),
    completedViews: 0,
    totalViews: config.totalCount,
  });

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
  return Array.from(agents.values()).map((a) => ({
    name: a.name,
    status: a.status,
    startTime: a.startTime.toISOString(),
    config: {
      youtubeUrl: a.config.youtubeUrl,
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
  }));
}

function getAgent(agentName) {
  return agents.get(agentName) || null;
}

module.exports = { startAgent, stopAgent, removeAgent, listAgents, getAgent };
