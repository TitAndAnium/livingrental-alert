import { Client, SFTPWrapper } from "ssh2";
import { connectSSH } from "./preflight";
import { nanoid } from "nanoid";

interface SSHConfig {
  host: string;
  username: string;
  privateKey: string;
}

interface DeployResult {
  success: boolean;
  message: string;
  logs: string[];
  services: {
    postgres: { running: boolean; healthy: boolean };
    n8n: { running: boolean; healthy: boolean; url?: string };
    ntfy: { running: boolean; healthy: boolean; url?: string };
    fetcher: { running: boolean; healthy: boolean; url?: string };
  };
}

async function execCommand(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let output = "";
      let errorOutput = "";
      stream.on("close", () => {
        resolve(output + errorOutput);
      });
      stream.on("data", (data: Buffer) => {
        output += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });
    });
  });
}

async function uploadFile(client: Client, content: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp: SFTPWrapper) => {
      if (err) {
        reject(err);
        return;
      }
      const stream = sftp.createWriteStream(remotePath);
      stream.on("close", () => resolve());
      stream.on("error", reject);
      stream.write(content);
      stream.end();
    });
  });
}

export function generateDockerCompose(ports: { postgres: number; n8n: number; ntfy: number; fetcher: number }): string {
  return `version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: rentalmonitor_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: rentalmonitor
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: rentalmonitor
    volumes:
      - rentalmonitor_postgres_data:/var/lib/postgresql/data
    networks:
      - rentalmonitor_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rentalmonitor"]
      interval: 10s
      timeout: 5s
      retries: 5

  n8n:
    image: n8nio/n8n:latest
    container_name: rentalmonitor_n8n
    restart: unless-stopped
    ports:
      - "127.0.0.1:${ports.n8n}:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=\${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=\${N8N_PASSWORD}
      - N8N_ENCRYPTION_KEY=\${N8N_ENCRYPTION_KEY}
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=rentalmonitor
      - DB_POSTGRESDB_USER=rentalmonitor
      - DB_POSTGRESDB_PASSWORD=\${POSTGRES_PASSWORD}
      - GENERIC_TIMEZONE=Europe/Amsterdam
      - N8N_HOST=\${N8N_HOST}
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=\${WEBHOOK_URL}
    volumes:
      - rentalmonitor_n8n_data:/home/node/.n8n
    networks:
      - rentalmonitor_net
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5678/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  ntfy:
    image: binwiederhier/ntfy:latest
    container_name: rentalmonitor_ntfy
    restart: unless-stopped
    ports:
      - "127.0.0.1:${ports.ntfy}:80"
    command:
      - serve
    volumes:
      - rentalmonitor_ntfy_cache:/var/cache/ntfy
      - rentalmonitor_ntfy_data:/var/lib/ntfy
    networks:
      - rentalmonitor_net
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:80/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  fetcher:
    build:
      context: ./fetcher
      dockerfile: Dockerfile
    container_name: rentalmonitor_fetcher
    restart: unless-stopped
    ports:
      - "127.0.0.1:${ports.fetcher}:3001"
    environment:
      - X_FETCHER_SECRET=\${FETCHER_SECRET}
      - PORT=3001
    networks:
      - rentalmonitor_net
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  rentalmonitor_postgres_data:
  rentalmonitor_n8n_data:
  rentalmonitor_ntfy_cache:
  rentalmonitor_ntfy_data:

networks:
  rentalmonitor_net:
    name: rentalmonitor_net
    driver: bridge
`;
}

export function generateEnvExample(): string {
  return `# LivingRental Alert - Environment Configuration
# Copy this to .env and fill in real values

# Postgres
POSTGRES_PASSWORD=your_secure_postgres_password

# n8n Configuration
N8N_USER=admin
N8N_PASSWORD=your_secure_n8n_password
N8N_ENCRYPTION_KEY=your_32_char_encryption_key_here
N8N_HOST=n8n.yourdomain.com
WEBHOOK_URL=https://n8n.yourdomain.com

# Fetcher Service
FETCHER_SECRET=your_fetcher_api_secret_here
`;
}

export function generateEnvFile(): string {
  const postgresPassword = nanoid(32);
  const n8nPassword = nanoid(24);
  const encryptionKey = nanoid(32);
  const fetcherSecret = nanoid(32);

  return `# LivingRental Alert - Environment Configuration
# Generated: ${new Date().toISOString()}

# Postgres
POSTGRES_PASSWORD=${postgresPassword}

# n8n Configuration
N8N_USER=admin
N8N_PASSWORD=${n8nPassword}
N8N_ENCRYPTION_KEY=${encryptionKey}
N8N_HOST=localhost
WEBHOOK_URL=http://localhost:5678

# Fetcher Service
FETCHER_SECRET=${fetcherSecret}
`;
}

export function generateFetcherDockerfile(): string {
  return `FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
`;
}

export function generateFetcherPackageJson(): string {
  return JSON.stringify({
    name: "rentalmonitor-fetcher",
    version: "1.0.0",
    description: "Rental monitor fetcher microservice with Playwright support",
    main: "index.js",
    scripts: {
      start: "node index.js"
    },
    dependencies: {
      express: "^4.18.2",
      playwright: "^1.40.0"
    }
  }, null, 2);
}

export function generateFetcherService(): string {
  return `const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

const FETCHER_SECRET = process.env.X_FETCHER_SECRET || '';
const ALLOWED_URL_PREFIXES = process.env.ALLOWED_URL_PREFIXES 
  ? process.env.ALLOWED_URL_PREFIXES.split(',').map(p => p.trim())
  : null;
const PORT = process.env.PORT || 3001;

// Middleware to check secret - STRICT: reject if secret missing or wrong
function checkSecret(req, res, next) {
  if (!FETCHER_SECRET) {
    return res.status(500).json({ error: 'FETCHER_SECRET not configured - access denied' });
  }
  
  const secret = req.headers['x-fetcher-secret'];
  if (!secret || secret !== FETCHER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized - invalid or missing secret' });
  }
  
  next();
}

// Optional SSRF protection - check URL against allowlist
function checkUrlAllowed(url) {
  if (!ALLOWED_URL_PREFIXES) return true;
  return ALLOWED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'rentalmonitor-fetcher'
  });
});

// Fetch endpoint
app.post('/fetch', checkSecret, async (req, res) => {
  const startTime = Date.now();
  const { url, mode = 'http', timeout = 30000, waitForSelector, screenshot = false } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  // SSRF protection
  if (!checkUrlAllowed(url)) {
    return res.status(403).json({ error: 'URL not in allowed prefixes list' });
  }

  try {
    let result;

    if (mode === 'browser') {
      // Use Playwright for JS-heavy pages
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      const page = await context.newPage();
      
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout 
      });

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: timeout / 2 });
      }

      const html = await page.content();
      const text = await page.evaluate(() => document.body.innerText);
      const finalUrl = page.url();

      let screenshotBase64;
      if (screenshot) {
        const buffer = await page.screenshot({ fullPage: true });
        screenshotBase64 = buffer.toString('base64');
      }

      await browser.close();

      result = {
        status: 200,
        finalUrl,
        html,
        text,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        ...(screenshotBase64 && { screenshotBase64 })
      };
    } else {
      // Use plain HTTP fetch
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(timeout)
      });

      const html = await response.text();
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();

      result = {
        status: response.status,
        finalUrl: response.url,
        html,
        text,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime
      };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Fetcher service running on port \${PORT}\`);
});
`;
}

export async function deployToVPS(
  config: SSHConfig,
  ports: { postgres: number; n8n: number; ntfy: number; fetcher: number }
): Promise<DeployResult> {
  const logs: string[] = [];
  const client = await connectSSH(config);

  try {
    logs.push("Connected to VPS");

    // Create directory structure
    logs.push("Creating directory structure...");
    await execCommand(client, "mkdir -p /opt/rentalmonitor/{fetcher,logs}");

    // Upload Docker Compose file
    logs.push("Uploading docker-compose.yml...");
    await uploadFile(client, generateDockerCompose(ports), "/opt/rentalmonitor/docker-compose.yml");

    // Upload .env.example
    logs.push("Uploading .env.example...");
    await uploadFile(client, generateEnvExample(), "/opt/rentalmonitor/.env.example");

    // Check if .env exists, if not create with generated secrets
    const envExists = await execCommand(client, "test -f /opt/rentalmonitor/.env && echo 'exists' || echo 'missing'");
    if (envExists.trim() === "missing") {
      logs.push("Creating .env with generated secrets...");
      await uploadFile(client, generateEnvFile(), "/opt/rentalmonitor/.env");
    } else {
      logs.push(".env already exists, keeping existing configuration");
    }

    // Upload fetcher service files
    logs.push("Uploading fetcher service...");
    await uploadFile(client, generateFetcherDockerfile(), "/opt/rentalmonitor/fetcher/Dockerfile");
    await uploadFile(client, generateFetcherPackageJson(), "/opt/rentalmonitor/fetcher/package.json");
    await uploadFile(client, generateFetcherService(), "/opt/rentalmonitor/fetcher/index.js");

    // Create README
    logs.push("Creating README...");
    const readme = generateReadme(ports);
    await uploadFile(client, readme, "/opt/rentalmonitor/README.md");

    // Start the stack
    logs.push("Starting Docker Compose stack...");
    const composeOutput = await execCommand(client, "cd /opt/rentalmonitor && docker compose up -d --build 2>&1");
    logs.push(composeOutput);

    // Wait for services to start
    logs.push("Waiting for services to start...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Check service health
    logs.push("Checking service health...");
    const psOutput = await execCommand(client, "cd /opt/rentalmonitor && docker compose ps --format json 2>/dev/null || docker compose ps");
    logs.push(psOutput);

    // Test fetcher health endpoint
    const fetcherHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.fetcher}/health 2>/dev/null || echo 'failed'`);
    const fetcherRunning = fetcherHealth.includes("ok");

    // Test ntfy health
    const ntfyHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.ntfy}/v1/health 2>/dev/null || echo 'failed'`);
    const ntfyRunning = ntfyHealth.includes("healthy") || !ntfyHealth.includes("failed");

    // Check n8n
    const n8nHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.n8n}/healthz 2>/dev/null || echo 'failed'`);
    const n8nRunning = !n8nHealth.includes("failed");

    // Check postgres
    const postgresCheck = await execCommand(client, "docker exec rentalmonitor_postgres pg_isready -U rentalmonitor 2>/dev/null || echo 'failed'");
    const postgresRunning = postgresCheck.includes("accepting connections");

    client.end();

    return {
      success: true,
      message: "Deployment completed successfully",
      logs,
      services: {
        postgres: { running: postgresRunning, healthy: postgresRunning },
        n8n: { running: n8nRunning, healthy: n8nRunning, url: `http://127.0.0.1:${ports.n8n}` },
        ntfy: { running: ntfyRunning, healthy: ntfyRunning, url: `http://127.0.0.1:${ports.ntfy}` },
        fetcher: { running: fetcherRunning, healthy: fetcherRunning, url: `http://127.0.0.1:${ports.fetcher}` },
      },
    };
  } catch (error) {
    client.end();
    logs.push(`Error: ${(error as Error).message}`);
    return {
      success: false,
      message: (error as Error).message,
      logs,
      services: {
        postgres: { running: false, healthy: false },
        n8n: { running: false, healthy: false },
        ntfy: { running: false, healthy: false },
        fetcher: { running: false, healthy: false },
      },
    };
  }
}

function generateReadme(ports: { postgres: number; n8n: number; ntfy: number; fetcher: number }): string {
  return `# LivingRental Alert - VPS Infrastructure

## Services

| Service | Local Port | Description |
|---------|------------|-------------|
| Postgres | Internal | Database for n8n workflows |
| n8n | ${ports.n8n} | Workflow automation |
| ntfy | ${ports.ntfy} | Push notifications |
| Fetcher | ${ports.fetcher} | Web scraping microservice |

## Quick Start

1. Configure your reverse proxy (see config snippet in dashboard)
2. Test ntfy: \`curl -d "Hello" http://127.0.0.1:${ports.ntfy}/strijps\`
3. Subscribe on iPhone/iPad: ntfy app → Add topic → "strijps"
4. Access n8n: http://127.0.0.1:${ports.n8n} (user: admin)

## Fetcher API

\`\`\`bash
# Health check
curl http://127.0.0.1:${ports.fetcher}/health

# Fetch with HTTP
curl -X POST http://127.0.0.1:${ports.fetcher}/fetch \\
  -H "Content-Type: application/json" \\
  -H "X-Fetcher-Secret: YOUR_SECRET" \\
  -d '{"url": "https://example.com", "mode": "http"}'

# Fetch with browser (Playwright)
curl -X POST http://127.0.0.1:${ports.fetcher}/fetch \\
  -H "Content-Type: application/json" \\
  -H "X-Fetcher-Secret: YOUR_SECRET" \\
  -d '{"url": "https://example.com", "mode": "browser"}'
\`\`\`

## Logs

\`\`\`bash
docker compose logs -f
\`\`\`

## Stop/Start

\`\`\`bash
cd /opt/rentalmonitor
docker compose stop
docker compose start
\`\`\`

Generated: ${new Date().toISOString()}
`;
}

export async function checkVPSServices(
  config: SSHConfig,
  ports: { postgres: number; n8n: number; ntfy: number; fetcher: number }
): Promise<DeployResult["services"]> {
  const client = await connectSSH(config);

  try {
    // Test fetcher health endpoint
    const fetcherHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.fetcher}/health 2>/dev/null || echo 'failed'`);
    const fetcherRunning = fetcherHealth.includes("ok");

    // Test ntfy health
    const ntfyHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.ntfy}/v1/health 2>/dev/null || echo 'failed'`);
    const ntfyRunning = ntfyHealth.includes("healthy") || !ntfyHealth.includes("failed");

    // Check n8n
    const n8nHealth = await execCommand(client, `curl -s http://127.0.0.1:${ports.n8n}/healthz 2>/dev/null || echo 'failed'`);
    const n8nRunning = !n8nHealth.includes("failed");

    // Check postgres
    const postgresCheck = await execCommand(client, "docker exec rentalmonitor_postgres pg_isready -U rentalmonitor 2>/dev/null || echo 'failed'");
    const postgresRunning = postgresCheck.includes("accepting connections");

    client.end();

    return {
      postgres: { running: postgresRunning, healthy: postgresRunning },
      n8n: { running: n8nRunning, healthy: n8nRunning, url: `http://127.0.0.1:${ports.n8n}` },
      ntfy: { running: ntfyRunning, healthy: ntfyRunning, url: `http://127.0.0.1:${ports.ntfy}` },
      fetcher: { running: fetcherRunning, healthy: fetcherRunning, url: `http://127.0.0.1:${ports.fetcher}` },
    };
  } catch (error) {
    client.end();
    throw error;
  }
}
