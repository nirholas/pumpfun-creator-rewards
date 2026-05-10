import { defineConfig } from 'vite';
import { createApiHandler } from './lib/dev-handler.js';

export default defineConfig({
  server: {
    port: 3000,
    host: true,
  },
  plugins: [
    {
      name: 'pumpfees-api-dev',
      configureServer(server) {
        server.middlewares.use('/api/fees', createApiHandler());
      },
    },
  ],
});
