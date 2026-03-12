const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION,
} = require('./utils/constants');

const agents = new Map();
let nextAgentId = 1;

function getTargetUrls() {
  if (process.env.YOUTUBE_URLS) {
    const urls = process.env.YOUTUBE_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return urlReader('urls.txt');
}

async function runAgentTask(agentName, abortSignal) {
  const targetUrls = getTargetUrls();
  const totalRounds = Math.ceil(TOTAL_COUNT / BATCH_COUNT);

  logger.info(`[${agentName}] Starting — ${TOTAL_COUNT} views (${BATCH_COUNT} parallel × ${totalRounds} rounds)`);
  logger.info(`[${agentName}] Target URL(s): ${targetUrls.join(', ')}`);

  for (let i = 0; i < totalRounds; i += 1) {
    if (abortSignal.aborted) {
      logger.info(`[${agentName}] Stopped by user after round ${i}`);
      return;
    }
    logger.info(`[${agentName}] ── Round ${i + 1} of ${totalRounds} ──`);
    await startViewingHandler({
      targetUrls,
      durationInSeconds: VIEW_DURATION,
      batchCount: BATCH_COUNT,
      startPort: START_PORT,
    }, i);
  }

  logger.success(`[${agentName}] All ${totalRounds} rounds completed`);
}

function startAgent() {
  const agentName = `agent${nextAgentId}`;
  nextAgentId += 1;

  const abortSignal = { aborted: false };

  const promise = runAgentTask(agentName, abortSignal)
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
    });

  agents.set(agentName, {
    name: agentName,
    status: 'running',
    startTime: new Date(),
    abortSignal,
    promise,
  });

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

function listAgents() {
  return Array.from(agents.values()).map((a) => ({
    name: a.name,
    status: a.status,
    startTime: a.startTime.toISOString(),
  }));
}

module.exports = { startAgent, stopAgent, listAgents };
