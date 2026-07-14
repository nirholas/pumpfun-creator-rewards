const { defineConfig } = require('vite');
const { createApiMiddleware } = require('./lib/node-adapter.js');

module.exports = defineConfig({
  server: {
    port: 3000,
    host: true,
  },
  plugins: [
    {
      name: 'pumpfees-api-dev',
      configureServer(server) {
        // The same adapter the production server mounts, so /api/fees,
        // /api/timeline and /api/xid all behave identically in dev.
        server.middlewares.use(createApiMiddleware());
      },
    },
  ],
});
