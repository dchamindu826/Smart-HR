// PM2: three processes on the VPS.
//   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'smarthr-api',
      cwd: path.join(root, 'backend'),
      script: 'dist/index.js',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      time: true,
    },
    {
      name: 'smarthr-worker',
      cwd: path.join(root, 'backend'),
      script: 'dist/jobs/worker.js',
      instances: 1, // never more than one worker
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      time: true,
    },
    {
      name: 'smarthr-web',
      cwd: path.join(root, 'frontend'),
      script: '.next/standalone/server.js',
      env: { NODE_ENV: 'production', PORT: process.env.PORT || '3001', HOSTNAME: '127.0.0.1', BACKEND_URL: 'http://127.0.0.1:4000' },
      max_memory_restart: '600M',
      time: true,
    },
  ],
};
