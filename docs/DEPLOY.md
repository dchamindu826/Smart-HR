# Deploy to the Ubuntu VPS

Ubuntu 24.04, one VPS. Nginx in front, PM2 runs three processes:
`smarthr-api` (port 4000), `smarthr-worker` (scheduled jobs), `smarthr-web` (port 3000).

## 1. Prepare the server (once)

```bash
# Node 22, PostgreSQL 16, Nginx, Certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx git
sudo npm i -g pm2

# firewall
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable

# database
sudo -u postgres psql -c "CREATE USER smarthr WITH PASSWORD 'choose-a-long-password';"
sudo -u postgres psql -c "CREATE DATABASE smarthr OWNER smarthr;"

# a deploy user and the folder
sudo adduser --disabled-password deploy
sudo mkdir -p /var/www/smarthr && sudo chown deploy:deploy /var/www/smarthr
```

## 2. Get the code and configure

```bash
sudo -iu deploy
git clone <your-repo-url> /var/www/smarthr
cd /var/www/smarthr

cp backend/.env.example backend/.env
nano backend/.env
#   NODE_ENV=production
#   DATABASE_URL="postgresql://smarthr:choose-a-long-password@127.0.0.1:5432/smarthr?schema=public"
#   JWT_SECRET / PLATFORM_JWT_SECRET  → openssl rand -base64 48 (two different values)
#   APP_URL="https://app.example.lk"
#   COOKIE_SECURE=true
#   UPLOAD_DIR="/var/www/smarthr/backend/storage"
#   SMTP_* for emails (optional), PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD

cp frontend/.env.example frontend/.env.local    # BACKEND_URL=http://127.0.0.1:4000
```

## 3. First build

```bash
cd /var/www/smarthr/backend
npm ci
npx prisma migrate deploy
npm run db:seed            # platform admin, plans, tax table — NOT the demo company
npm run build

cd ../frontend
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

cd ..
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup                # run the command it prints, as root
```

## 4. Nginx and HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/smarthr
sudo nano /etc/nginx/sites-available/smarthr      # set your domain
sudo ln -s /etc/nginx/sites-available/smarthr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.lk
```

Open `https://app.example.lk/admin/login`, change the admin password and turn
on two-factor login. Then create the first company under **Companies**.

## 5. Backups — before the first customer

```bash
sudo cp deploy/backup.sh /etc/cron.daily/smarthr-backup
sudo chmod +x /etc/cron.daily/smarthr-backup
sudo /etc/cron.daily/smarthr-backup        # run once now
```

Copy `/var/backups/smarthr` off the server every night (another VPS, or an
S3-compatible bucket with `rclone`). **Restore a backup into a scratch database
once a month.** A backup that has never been restored does not count.

## 6. Every later release

```bash
sudo -iu deploy
cd /var/www/smarthr && ./deploy/deploy.sh
```

## 7. Health and logs

```bash
curl -s https://app.example.lk/api/health      # database ok + last day close
pm2 status
pm2 logs smarthr-api --lines 100
pm2 logs smarthr-worker --lines 100
```

Point an uptime monitor (UptimeRobot, BetterStack) at `/api/health`.

## Notes

- Never run `prisma migrate dev` or `db:reset` on the server.
- Only one worker process. It records every job in the `JobRun` table so a job
  never runs twice and catches up after downtime.
- Uploaded files live in `UPLOAD_DIR` and are served only through logged-in API
  routes — never as public files.
- Push notifications: create a Firebase project, download the service-account
  JSON to the server and set `FCM_SERVICE_ACCOUNT_FILE`.
