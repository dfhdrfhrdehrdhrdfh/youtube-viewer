const { execSync } = require('child_process');

const startViewingHandler = require('./handlers/startViewing.handler');
const { logger, urlReader } = require('./utils');
const {
  IS_PROD, START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION,
} = require('./utils/constants');

const agents = new Map();
let nextAgentId = 1;

// Interval handle for the idle resource monitor
let idleCheckInterval = null;
// How often to check for idle state (ms)
const IDLE_CHECK_INTERVAL_MS = 30000;
// Delay before cleanup after going idle (ms) — avoids cleanup between quick restarts
const IDLE_CLEANUP_DELAY_MS = 10000;
let idleCleanupTimer = null;

function getTargetUrls() {
  if (process.env.VIDEO_URLS) {
    const urls = process.env.VIDEO_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return urlReader('urls.txt');
}

/**
 * Return true when no agent is in 'running' or 'stopping' state.
 * @return {boolean} true if idle
 */
function isIdle() {
  for (const agent of agents.values()) {
    if (agent.status === 'running' || agent.status === 'stopping') return false;
  }
  return true;
}

/**
 * Purge completed / stopped / failed agents from the map so their closures
 * and references can be garbage-collected.
 */
function purgeFinishedAgents() {
  const before = agents.size;
  for (const [name, agent] of agents) {
    if (agent.status !== 'running' && agent.status !== 'stopping') {
      agents.delete(name);
    }
  }
  const purged = before - agents.size;
  if (purged > 0) {
    logger.info(`Purged ${purged} finished agent(s) from memory`);
  }
}

/**
 * Kill any orphaned chromium-browser processes that may have survived a
 * browser.close() call. Only runs in production (inside the container).
 */
function killOrphanedChromium() {
  if (!IS_PROD) return;
  try {
    // Find chromium processes not owned by PID 1 (init) — the node process is PID 1 in Docker
    const output = execSync('pgrep -f chromium-browser 2>/dev/null || true', { encoding: 'utf8' }).trim();
    if (output) {
      const pids = output.split('\n').filter(Boolean);
      logger.info(`Cleaning up ${pids.length} orphaned chromium process(es)`);
      pids.forEach((pid) => {
        try {
          process.kill(parseInt(pid, 10), 'SIGKILL');
        } catch (_) {
          // already dead
        }
      });
    }
  } catch (_) {
    // pgrep not available or no processes
  }
}

/**
 * Run cleanup: purge finished agents, kill orphaned browsers, hint GC.
 */
function runIdleCleanup() {
  logger.info('All agents idle — running resource cleanup...');
  purgeFinishedAgents();
  killOrphanedChromium();

  // Hint V8 to run garbage collection if --expose-gc flag is set
  if (global.gc) {
    global.gc();
    logger.info('Forced garbage collection');
  }

  logger.info('Idle cleanup complete');
}

/**
 * Called periodically. When all agents are done, schedule a cleanup.
 * The short delay prevents cleanup from firing between rapid start/stop cycles.
 */
function checkIdleState() {
  if (isIdle() && agents.size > 0) {
    if (!idleCleanupTimer) {
      idleCleanupTimer = setTimeout(() => {
        idleCleanupTimer = null;
        if (isIdle()) runIdleCleanup();
      }, IDLE_CLEANUP_DELAY_MS);
    }
  } else if (!isIdle() && idleCleanupTimer) {
    clearTimeout(idleCleanupTimer);
    idleCleanupTimer = null;
  }
}

/**
 * Start the periodic idle resource monitor (called once from index.js init).
 */
function startIdleMonitor() {
  if (idleCheckInterval) return;
  idleCheckInterval = setInterval(checkIdleState, IDLE_CHECK_INTERVAL_MS);
  // Don't keep the process alive just for the idle monitor
  if (idleCheckInterval.unref) idleCheckInterval.unref();
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
      // Trigger idle check immediately so cleanup doesn't wait for the next interval
      checkIdleState();
    })
    .catch((err) => {
      const agent = agents.get(agentName);
      if (agent) agent.status = 'failed';
      logger.error(`[${agentName}] Failed: ${err.message || err}`);
      checkIdleState();
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

module.exports = { startAgent, stopAgent, listAgents, startIdleMonitor };
