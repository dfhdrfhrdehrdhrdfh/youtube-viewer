const net = require('net');

const SOCKET_PATH = '/tmp/ytviewer.sock';

const args = process.argv.slice(2);
const action = args[0];

function printUsage() {
  console.log('YouTube Viewer — Agent Manager CLI');
  console.log('');
  console.log('Usage:');
  console.log('  node cli.js start          Start a new viewing agent');
  console.log('  node cli.js stop <name>    Stop an agent (e.g. node cli.js stop agent1)');
  console.log('  node cli.js list           List all agents and their status');
}

if (!action || !['start', 'stop', 'list'].includes(action)) {
  printUsage();
  process.exit(1);
}

const cmd = { action };

if (action === 'stop') {
  if (!args[1]) {
    console.log('Error: Agent name required.');
    console.log('Usage: node cli.js stop agent1');
    process.exit(1);
  }
  cmd.agentName = args[1];
}

const client = net.createConnection(SOCKET_PATH, () => {
  client.end(JSON.stringify(cmd));
});

client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString());

    if (action === 'list' && response.success) {
      if (response.agents.length === 0) {
        console.log('No agents found.');
      } else {
        console.log('Agents:');
        response.agents.forEach((a) => {
          const uptime = Math.round((Date.now() - new Date(a.startTime).getTime()) / 1000);
          console.log(`  ${a.name}  —  ${a.status}  (uptime: ${uptime}s)`);
        });
      }
    } else {
      console.log(response.message);
    }
  } catch (err) {
    console.log('Error parsing response:', data.toString());
  }
  client.end();
});

client.on('error', (err) => {
  if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
    console.log('Error: Cannot connect to YouTube Viewer process.');
    console.log('Make sure the main application is running (node index).');
  } else {
    console.log(`Connection error: ${err.message}`);
  }
  process.exit(1);
});
