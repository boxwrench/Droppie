import { createServer } from 'vite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Keep review/tests stable while code is being edited in another window.
// A separate dependency cache also avoids sharing a running Vite dev cache.
const server = await createServer({
  cacheDir: join(tmpdir(), 'droppie-pool-preview-vite'),
  server: {host: '127.0.0.1', port: Number(process.env.POOL_PREVIEW_PORT || 5180), strictPort: true, hmr: false},
});
await server.listen();
server.printUrls();
