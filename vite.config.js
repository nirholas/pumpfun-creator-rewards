const { defineConfig } = require('vite');
const { createApiHandler } = require('./lib/dev-handler.js');

module.exports = defineConfig({
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
