const fs = require('fs');
const net = require('net');

const TorService = require('./services/tor.service');
const agentManager = require('./agentManager');
const { logger } = require('./utils');
const { startWebServer } = require('./web/server');
const {
  START_PORT, TOTAL_COUNT, BATCH_COUNT, VIEW_DURATION, TOR_ENABLED, TOR_HOST,
  TUNNEL_ENABLED,
} = require('./utils/constants');

const SOCKET_PATH = '/tmp/ytviewer.sock';

// ── IPC server for CLI commands (docker exec node cli.js ...) ────────────
function startIpcServer() {
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

  const server = net.createServer((connection) => {
    let buf = '';
    connection.on('data', (data) => {
      buf += data.toString();
    });
    connection.on('end', () => {
      try {
        const cmd = JSON.parse(buf);
        let response;

        switch (cmd.action) {
          case 'start': {
            const name = agentManager.startAgent();
            response = { success: true, message: `Started ${name}` };
            break;
          }
          case 'stop':
            response = agentManager.stopAgent(cmd.agentName);
            break;
          case 'list':
            response = { success: true, agents: agentManager.listAgents() };
            break;
          default:
            response = { success: false, message: `Unknown command: ${cmd.action}` };
        }

        connection.end(JSON.stringify(response));
      } catch (err) {
        connection.end(JSON.stringify({ success: false, message: err.message }));
      }
    });
  });

  server.listen(SOCKET_PATH, () => {
    logger.info('IPC server listening — use "node cli.js" to manage agents');
  });

  return server;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  try {
    // ── Startup banner ──────────────────────────────────────────────
    logger.info('=============================================');
    logger.info('  YouTube Viewer — Starting (Agent Mode)');
    logger.info('=============================================');
    logger.info(`Total views   : ${TOTAL_COUNT}  (${BATCH_COUNT} parallel × ${Math.ceil(TOTAL_COUNT / BATCH_COUNT)} rounds)`);
    logger.info(`View duration : ~${VIEW_DURATION}s (±16.6%)`);
    logger.info(`Tor enabled   : ${TOR_ENABLED}`);
    if (TOR_ENABLED) {
      logger.info(`Tor host      : ${TOR_HOST}`);
      logger.info(`SOCKS ports   : ${START_PORT}–${START_PORT + BATCH_COUNT - 1}`);
    }
    logger.info('─────────────────────────────────────────────');
    logger.info(`VPS tunnel    : ${TUNNEL_ENABLED ? 'ENABLED (WireGuard)' : 'DISABLED'}`);
    if (TUNNEL_ENABLED) {
      logger.info('Traffic route   : ytviewer → tor → WireGuard → VPS → Internet');
    } else {
      logger.info('Traffic route   : ytviewer → tor → Internet (direct)');
    }
    logger.info('=============================================');

    // ── Tor setup (once) ────────────────────────────────────────────
    await TorService.writeTorConfig(START_PORT, BATCH_COUNT);

    // ── IPC server for CLI management ───────────────────────────────
    startIpcServer();

    // ── Web server ──────────────────────────────────────────────────
    startWebServer(8093);

    // ── Auto-start first agent ──────────────────────────────────────
    logger.info('Auto-starting first agent...');
    agentManager.startAgent();

    logger.info('─────────────────────────────────────────────');
    logger.info('Container will keep running. Manage agents with:');
    logger.info('  docker exec youtube-viewer node cli.js start');
    logger.info('  docker exec youtube-viewer node cli.js stop <name>');
    logger.info('  docker exec youtube-viewer node cli.js list');
    logger.info('  Web dashboard: http://localhost:8093');
    logger.info('─────────────────────────────────────────────');
  } catch (error) {
    logger.error(`Failed to initialise: ${error.message || error}`);
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────
function shutdown(signal) {
  logger.info(`Received ${signal} — stopping all agents...`);
  const agentList = agentManager.listAgents();
  agentList.forEach((a) => {
    if (a.status === 'running') agentManager.stopAgent(a.name);
  });
  // Clean up socket
  try { fs.unlinkSync(SOCKET_PATH); } catch (_) { /* ignore */ }
  // Give agents a moment to finish their current round, then exit
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();
