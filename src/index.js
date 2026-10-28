import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv, config } from './config.js';
import { Store } from './store.js';
import { GarminClient } from './garmin.js';
import { DemoClient } from './demo.js';
import { TrainingService } from './service.js';
import { createMcpServer } from './server.js';
import { createHttpApp } from './http.js';

async function main() {
  loadEnv();
  const settings = config();
  const store = new Store(settings.dataDir);
  const client = settings.demo ? new DemoClient(settings.timeZone) : new GarminClient(settings);
  const service = new TrainingService({ ...settings, client, store });
  let connection;
  const shutdown = async () => {
    if (connection?.close) await new Promise(resolve => connection.close(resolve));
    store.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (process.argv.includes('--http')) {
    const app = await createHttpApp(settings, service);
    connection = app.listen(settings.port, settings.host, () => {
      console.error(`Garmin MCP ${settings.demo ? 'DEMO ' : ''}HTTP: http://${settings.host}:${settings.port}/mcp`);
    });
    connection.on('error', () => { console.error('Nie można uruchomić HTTP; sprawdź HOST/PORT.'); store.close(); process.exit(1); });
  } else {
    const server = createMcpServer(service);
    await server.connect(new StdioServerTransport());
    process.stdin.once('end', () => { store.close(); });
    console.error(`Garmin MCP ${settings.demo ? 'DEMO ' : ''}gotowy (stdio).`);
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });
