# VPS deploy

Recommended target: Ubuntu 22.04/24.04 VPS.

## 1. Install runtime

Fast path:

```bash
sudo bash /opt/artemgpt/deploy/setup-vps.sh
```

Manual path:

```bash
sudo apt update
sudo apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Optional Ollama:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:1b
```

## 2. Create app user and folder

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin artemgpt
sudo mkdir -p /opt/artemgpt
sudo chown -R artemgpt:artemgpt /opt/artemgpt
```

## 3. Copy project

From your Mac:

```bash
rsync -av --exclude node_modules --exclude dist --exclude data --exclude .git \
  /Users/nikitapodrezov/Project/ArtemGPT/ root@YOUR_VPS_IP:/opt/artemgpt/
```

On VPS:

```bash
sudo chown -R artemgpt:artemgpt /opt/artemgpt
cd /opt/artemgpt
sudo -u artemgpt npm ci
sudo -u artemgpt npm run build
```

## 4. Configure env

```bash
sudo -u artemgpt cp /opt/artemgpt/.env.example /opt/artemgpt/.env
sudo -u artemgpt nano /opt/artemgpt/.env
```

For a small VPS, start with:

```env
OLLAMA_MODEL=llama3.2:1b
OLLAMA_TIMEOUT_MS=30000
LLM_ENABLED=true
FAST_COMMON_REPLIES_ENABLED=true
DIRECT_REPLY_ENABLED=true
REPLY_LEARNING_ENABLED=true
```

If VPS is too weak for Ollama:

```env
LLM_ENABLED=false
```

The bot will still learn and answer from reply bank/manual rules.

## 5. Install systemd service

```bash
sudo cp /opt/artemgpt/deploy/artemgpt.service.example /etc/systemd/system/artemgpt.service
sudo systemctl daemon-reload
sudo systemctl enable artemgpt
sudo systemctl start artemgpt
```

Logs:

```bash
journalctl -u artemgpt -f
```

Restart after changes:

```bash
sudo systemctl restart artemgpt
```

## 6. Keep database safe

SQLite database lives at:

```text
/opt/artemgpt/data/artemgpt.sqlite
```

Back it up:

```bash
sudo tar -czf /root/artemgpt-data-backup.tgz /opt/artemgpt/data
```

## 7. Auto deploy from GitHub

The repository includes:

```text
.github/workflows/deploy.yml
```

On every push to `main`, GitHub Actions will:

1. copy the project to the VPS;
2. keep `.env` and `data/` untouched;
3. run `npm ci`;
4. run `npm run build`;
5. restart `artemgpt.service`.

Create an SSH key on your Mac:

```bash
ssh-keygen -t ed25519 -C "artemgpt-deploy" -f ~/.ssh/artemgpt_deploy
```

Add the public key to VPS:

```bash
ssh-copy-id -i ~/.ssh/artemgpt_deploy.pub root@YOUR_VPS_IP
```

If deploy user is not `root`, it needs passwordless restart permission:

```bash
sudo visudo
```

Add:

```text
deployuser ALL=NOPASSWD: /bin/systemctl restart artemgpt
```

In GitHub repo settings, add `Settings -> Secrets and variables -> Actions -> New repository secret`:

```text
VPS_HOST=YOUR_VPS_IP
VPS_USER=root
VPS_PATH=/opt/artemgpt
VPS_SSH_KEY=<contents of ~/.ssh/artemgpt_deploy>
```

Push to `main`, then watch:

```text
GitHub repo -> Actions -> Deploy
```

On the VPS:

```bash
journalctl -u artemgpt -f
```
