const path = require('path');
const fs = require('fs');
const express = require('express');
const agentManager = require('../agentManager');
const { logBuffer, logEmitter } = require('../utils/logger');
const { getContainerDirectIp } = require('../services/tor.service');
const {
  TOR_ENABLED, TOR_HOST, START_PORT, BATCH_COUNT,
  TUNNEL_ENABLED, VPS_IP, VPS_WG_PORT,
} = require('../utils/constants');

const startTime = Date.now();

// Cache the HTML file at startup
const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function startWebServer(port) {
  const app = express();
  app.use(express.json());

  // ── Serve single HTML page ──────────────────────────────────────────
  app.get('/', (req, res) => {
    res.type('html').send(htmlContent);
  });

  // ── GET /api/status ─────────────────────────────────────────────────
  app.get('/api/status', (req, res) => {
    const agents = agentManager.listAgents();
    const activeAgents = agents.filter((a) => a.status === 'running' || a.status === 'stopping').length;
    res.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeAgents,
      totalAgents: agents.length,
    });
  });

  // ── GET /api/connection-status ──────────────────────────────────────
  app.get('/api/connection-status', (req, res) => {
    const routingPath = TUNNEL_ENABLED ?
      'ytviewer → tor → WireGuard → VPS → Internet' :
      'ytviewer → tor → Internet';
    res.json({
      torEnabled: TOR_ENABLED,
      torHost: TOR_HOST,
      torStartPort: START_PORT,
      socksPortCount: BATCH_COUNT,
      tunnelEnabled: TUNNEL_ENABLED,
      vpsIp: VPS_IP || null,
      vpsWgPort: VPS_WG_PORT,
      containerIp: getContainerDirectIp() || 'check-failed (not yet fetched)',
      routingPath,
    });
  });

  // ── GET /api/agents ─────────────────────────────────────────────────
  app.get('/api/agents', (req, res) => {
    res.json(agentManager.listAgents());
  });

  // ── POST /api/agents ────────────────────────────────────────────────
  app.post('/api/agents', (req, res) => {
    try {
      const body = req.body || {};
      const config = {};
      if (body.name) config.name = String(body.name);
      if (body.videoUrl || body.youtubeUrl) config.videoUrl = String(body.videoUrl || body.youtubeUrl);
      if (body.batchCount) config.batchCount = parseInt(body.batchCount, 10);
      if (body.totalCount) config.totalCount = parseInt(body.totalCount, 10);
      if (body.viewDuration) config.viewDuration = parseInt(body.viewDuration, 10);
      if (body.viewActionCount) config.viewActionCount = parseInt(body.viewActionCount, 10);
      if (body.pageDefaultTimeout) config.pageDefaultTimeout = parseInt(body.pageDefaultTimeout, 10);

      const name = agentManager.startAgent(Object.keys(config).length > 0 ? config : undefined);
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Failed to create agent' });
    }
  });

  // ── POST /api/agents/:name/stop ─────────────────────────────────────
  app.post('/api/agents/:name/stop', (req, res) => {
    const result = agentManager.stopAgent(req.params.name);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  });

  // ── DELETE /api/agents/:name ────────────────────────────────────────
  app.delete('/api/agents/:name', (req, res) => {
    const result = agentManager.removeAgent(req.params.name);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  });

  // ── GET /api/logs/stream (SSE) ──────────────────────────────────────
  app.get('/api/logs/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Replay last 200 entries from buffer
    const replayCount = Math.min(logBuffer.length, 200);
    const replayStart = logBuffer.length - replayCount;
    for (let i = replayStart; i < logBuffer.length; i += 1) {
      res.write('data: ' + JSON.stringify(logBuffer[i]) + '\n\n');
    }

    // Stream new entries
    const onLog = (entry) => {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    };
    logEmitter.on('log', onLog);

    // Keep-alive ping every 25s
    const pingInterval = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    // Cleanup on disconnect
    const cleanup = () => {
      logEmitter.removeListener('log', onLog);
      clearInterval(pingInterval);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  // ── Start listening ─────────────────────────────────────────────────
  const server = app.listen(port, '0.0.0.0', () => {
    const { logger } = require('../utils');
    logger.info(`Web dashboard listening on http://0.0.0.0:${port}`);
  });

  server.on('error', (err) => {
    const { logger } = require('../utils');
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use — web server could not start`);
    } else {
      logger.error(`Web server error: ${err.message}`);
    }
  });

  return server;
}

module.exports = { startWebServer };
