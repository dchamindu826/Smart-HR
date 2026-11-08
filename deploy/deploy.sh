#!/usr/bin/env bash
# Pull, build and restart SmartHR on the VPS.   ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ pulling"
git pull --ff-only

echo "→ backend"
cd backend
npm ci
npx prisma migrate deploy        # never 'migrate dev' on the server
npm run build
cd ..

echo "→ frontend"
cd frontend
npm ci
npm run build
# the standalone server needs the static files and public folder next to it
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cd ..

echo "→ restart"
pm2 reload deploy/ecosystem.config.cjs --update-env
pm2 save
echo "✓ deployed"
