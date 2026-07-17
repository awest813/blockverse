import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: the page can POST a data-URL to /__snap and it lands in
// .snapshots/ on disk. Used for automated visual verification in headless
// or hidden-tab environments. No effect on production builds.
function snapshotPlugin() {
  return {
    name: 'snapshot-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'POST' && req.url?.startsWith('/__snap')) {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            try {
              const name = new URL(req.url, 'http://x').searchParams.get('name') || 'snap';
              const b64 = body.replace(/^data:image\/\w+;base64,/, '');
              const dir = path.resolve('.snapshots');
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, `${name.replace(/[^\w-]/g, '')}.jpg`), Buffer.from(b64, 'base64'));
              res.end('ok');
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works on GitHub Pages project sites.
  base: './',
  plugins: [snapshotPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
