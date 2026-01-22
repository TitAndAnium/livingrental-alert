import { Client } from "ssh2";
import type { PreflightResult } from "@shared/schema";

interface SSHConfig {
  host: string;
  username: string;
  privateKey: string;
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
        resolve(output || errorOutput);
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

export async function connectSSH(config: SSHConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", reject);
    client.connect({
      host: config.host,
      port: 22,
      username: config.username,
      privateKey: config.privateKey,
    });
  });
}

export async function runPreflightScan(config: SSHConfig): Promise<PreflightResult> {
  const client = await connectSSH(config);

  try {
    // Get OS info
    const [distro, kernel, hostname] = await Promise.all([
      execCommand(client, "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'"),
      execCommand(client, "uname -r"),
      execCommand(client, "hostname"),
    ]);

    // Get listening ports
    const portsRaw = await execCommand(client, "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null");
    const ports = parseListeningPorts(portsRaw);

    // Check Docker
    const dockerVersion = await execCommand(client, "docker --version 2>/dev/null || echo 'not installed'");
    const dockerComposeVersion = await execCommand(client, "docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo 'not installed'");
    const dockerInstalled = !dockerVersion.includes("not installed");

    let containers: Array<{ name: string; image: string; status: string; ports: string }> = [];
    let networks: string[] = [];
    let volumes: string[] = [];

    if (dockerInstalled) {
      const containersRaw = await execCommand(client, 'docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"');
      containers = containersRaw.trim().split("\n").filter(Boolean).map((line) => {
        const [name, image, status, ports] = line.split("|");
        return { name: name || "", image: image || "", status: status || "", ports: ports || "" };
      });

      const networksRaw = await execCommand(client, "docker network ls --format '{{.Name}}'");
      networks = networksRaw.trim().split("\n").filter(Boolean);

      const volumesRaw = await execCommand(client, "docker volume ls --format '{{.Name}}'");
      volumes = volumesRaw.trim().split("\n").filter(Boolean);
    }

    // Detect reverse proxy
    const [nginxCheck, caddyCheck, traefikCheck] = await Promise.all([
      execCommand(client, "which nginx 2>/dev/null && nginx -t 2>&1 || docker ps --filter name=nginx --format '{{.Names}}' 2>/dev/null"),
      execCommand(client, "which caddy 2>/dev/null || docker ps --filter name=caddy --format '{{.Names}}' 2>/dev/null"),
      execCommand(client, "docker ps --filter name=traefik --format '{{.Names}}' 2>/dev/null"),
    ]);

    let proxyType: "nginx" | "caddy" | "traefik" | "none" = "none";
    let proxyConfigPath: string | undefined;

    if (nginxCheck.trim()) {
      proxyType = "nginx";
      proxyConfigPath = "/etc/nginx/sites-available/";
    } else if (caddyCheck.trim()) {
      proxyType = "caddy";
      proxyConfigPath = "/etc/caddy/Caddyfile";
    } else if (traefikCheck.trim()) {
      proxyType = "traefik";
    }

    // Check existing services
    const containerNames = containers.map((c) => c.name.toLowerCase());
    const existingServices = {
      n8n: containerNames.some((n) => n.includes("n8n")),
      postgres: containerNames.some((n) => n.includes("postgres") || n.includes("postgresql")),
      ntfy: containerNames.some((n) => n.includes("ntfy")),
      playwright: containerNames.some((n) => n.includes("playwright") || n.includes("fetcher")),
    };

    // Get resources
    const [diskInfo, memInfo] = await Promise.all([
      execCommand(client, "df -h / | tail -1 | awk '{print $4\"|\"$2}'"),
      execCommand(client, "free -h | grep Mem | awk '{print $4\"|\"$2}'"),
    ]);

    const [diskFree, diskTotal] = diskInfo.trim().split("|");
    const [memoryFree, memoryTotal] = memInfo.trim().split("|");

    // Calculate safe ports
    const usedPorts = ports.map((p) => p.port);
    const safePorts = {
      postgres: findSafePort(5432, usedPorts),
      n8n: findSafePort(5678, usedPorts),
      ntfy: findSafePort(8080, usedPorts),
      fetcher: findSafePort(3001, usedPorts),
    };

    // Check if ports 80/443 are free
    const port80Used = usedPorts.includes(80);
    const port443Used = usedPorts.includes(443);

    const warnings: string[] = [];
    if (port80Used) warnings.push("Port 80 is in use - will bind to localhost only");
    if (port443Used) warnings.push("Port 443 is in use - will bind to localhost only");
    if (existingServices.n8n) warnings.push("n8n already exists - will use different container name");
    if (existingServices.postgres) warnings.push("Postgres already exists - consider reusing");

    // Generate proxy config snippet if needed
    let proxyConfigSnippet: string | undefined;
    if (proxyType === "nginx") {
      proxyConfigSnippet = generateNginxConfig(safePorts);
    } else if (proxyType === "caddy") {
      proxyConfigSnippet = generateCaddyConfig(safePorts);
    }

    client.end();

    return {
      timestamp: new Date().toISOString(),
      osInfo: {
        distro: distro.trim(),
        kernel: kernel.trim(),
        hostname: hostname.trim(),
      },
      ports,
      docker: {
        installed: dockerInstalled,
        version: dockerInstalled ? dockerVersion.trim() : undefined,
        composeVersion: !dockerComposeVersion.includes("not installed") ? dockerComposeVersion.trim() : undefined,
        containers,
        networks,
        volumes,
      },
      reverseProxy: {
        detected: proxyType !== "none",
        type: proxyType,
        configPath: proxyConfigPath,
      },
      existingServices,
      resources: {
        diskFree: diskFree || "unknown",
        diskTotal: diskTotal || "unknown",
        memoryFree: memoryFree || "unknown",
        memoryTotal: memoryTotal || "unknown",
      },
      safePlan: {
        portsToUse: safePorts,
        reuseExistingProxy: proxyType !== "none",
        proxyConfigSnippet,
        warnings,
        readyToDeploy: dockerInstalled,
      },
    };
  } catch (error) {
    client.end();
    throw error;
  }
}

function parseListeningPorts(raw: string): Array<{ port: number; protocol: string; process: string; state: string }> {
  const lines = raw.trim().split("\n").slice(1); // Skip header
  const ports: Array<{ port: number; protocol: string; process: string; state: string }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      const localAddr = parts[3] || parts[4];
      if (localAddr) {
        const portMatch = localAddr.match(/:(\d+)$/);
        if (portMatch) {
          ports.push({
            port: parseInt(portMatch[1], 10),
            protocol: parts[0] || "tcp",
            process: parts[parts.length - 1] || "unknown",
            state: "LISTEN",
          });
        }
      }
    }
  }

  return ports;
}

function findSafePort(preferred: number, usedPorts: number[]): number {
  if (!usedPorts.includes(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 100; p++) {
    if (!usedPorts.includes(p)) return p;
  }
  return preferred + 1000;
}

function generateNginxConfig(ports: { n8n: number; ntfy: number; fetcher: number }): string {
  return `# LivingRental Alert - Nginx reverse proxy configuration
# Add this to /etc/nginx/sites-available/rentalmonitor.conf
# Then: sudo ln -s /etc/nginx/sites-available/rentalmonitor.conf /etc/nginx/sites-enabled/
# And: sudo nginx -t && sudo systemctl reload nginx

# Main rental alert app - rentalert.sellsiren.com
server {
    listen 80;
    server_name rentalert.sellsiren.com;

    # n8n workflow automation
    location /n8n/ {
        proxy_pass http://127.0.0.1:${ports.n8n}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ntfy push notifications
    location /ntfy/ {
        proxy_pass http://127.0.0.1:${ports.ntfy}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Fetcher microservice (protect with secret header)
    location /fetcher/ {
        proxy_pass http://127.0.0.1:${ports.fetcher}/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Alternative: Subdomain configuration (requires DNS A records for each subdomain)
# n8n.sellsiren.com, ntfy.sellsiren.com, fetcher.sellsiren.com

# server {
#     listen 80;
#     server_name n8n.sellsiren.com;
#     location / {
#         proxy_pass http://127.0.0.1:${ports.n8n};
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection "upgrade";
#         proxy_set_header Host $host;
#     }
# }

# server {
#     listen 80;
#     server_name ntfy.sellsiren.com;
#     location / {
#         proxy_pass http://127.0.0.1:${ports.ntfy};
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection "upgrade";
#         proxy_set_header Host $host;
#     }
# }
`;
}

function generateCaddyConfig(ports: { n8n: number; ntfy: number; fetcher: number }): string {
  return `# LivingRental Alert - Caddy reverse proxy configuration
# Add this to your Caddyfile

rentalert.sellsiren.com {
    # n8n workflow automation
    handle_path /n8n/* {
        reverse_proxy 127.0.0.1:${ports.n8n}
    }

    # ntfy push notifications
    handle_path /ntfy/* {
        reverse_proxy 127.0.0.1:${ports.ntfy}
    }

    # Fetcher microservice
    handle_path /fetcher/* {
        reverse_proxy 127.0.0.1:${ports.fetcher}
    }
}

# Alternative: Subdomain configuration (requires DNS A records)
# n8n.sellsiren.com {
#     reverse_proxy 127.0.0.1:${ports.n8n}
# }
# ntfy.sellsiren.com {
#     reverse_proxy 127.0.0.1:${ports.ntfy}
# }
`;
}
