import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { runPreflightScan } from "./vps/preflight";
import { deployToVPS, checkVPSServices } from "./vps/deploy";
import { getGitHubUser, createRepository, getRepositories, checkRepositoryExists, syncToGitHub, getLastCommit } from "./github";
import type { PreflightResult, DeploymentStatus } from "@shared/schema";

// Auth middleware - requires X-Admin-Key header
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const adminKey = process.env.ADMIN_API_KEY;
  const providedKey = req.headers['x-admin-key'] as string;
  
  if (!adminKey) {
    return res.status(500).json({ error: "ADMIN_API_KEY not configured on server" });
  }
  
  if (!providedKey || providedKey !== adminKey) {
    return res.status(401).json({ error: "Unauthorized - invalid or missing admin key" });
  }
  
  next();
}

// Rate limiter for GitHub sync (max 1 per 10 minutes)
let lastGitHubSync: number = 0;
const SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function rateLimitGitHubSync(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const timeSinceLastSync = now - lastGitHubSync;
  
  if (lastGitHubSync > 0 && timeSinceLastSync < SYNC_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((SYNC_COOLDOWN_MS - timeSinceLastSync) / 1000);
    return res.status(429).json({ 
      error: `Rate limited. Please wait ${waitSeconds} seconds before syncing again.`,
      retryAfter: waitSeconds
    });
  }
  
  next();
}

// In-memory state
let lastPreflightResult: PreflightResult | null = null;
let deploymentStatus: DeploymentStatus = {
  status: "idle",
  message: "Ready to scan VPS",
};

function getSSHConfig() {
  const host = process.env.VPS_PERSONAL_IP;
  const username = process.env.VPS_PERSONAL_USER;
  const privateKey = process.env.VPS_SSH_PRIVATE_KEY;

  if (!host || !username || !privateKey) {
    const missing = [];
    if (!host) missing.push("VPS_PERSONAL_IP");
    if (!username) missing.push("VPS_PERSONAL_USER");
    if (!privateKey) missing.push("VPS_SSH_PRIVATE_KEY");
    throw new Error(`Missing required secrets: ${missing.join(", ")}`);
  }

  return { host, username, privateKey };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Apply admin auth to all /api routes except health
  app.use("/api", (req, res, next) => {
    // Skip auth for public health check
    if (req.path === "/health") {
      return next();
    }
    requireAdminAuth(req, res, next);
  });

  // Public health check (no auth required)
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Get deployment status
  app.get("/api/status", (req, res) => {
    res.json({
      deploymentStatus,
      lastPreflightResult,
      secretsConfigured: Boolean(
        process.env.VPS_PERSONAL_IP &&
        process.env.VPS_PERSONAL_USER &&
        process.env.VPS_SSH_PRIVATE_KEY
      ),
    });
  });

  // Run preflight scan
  app.post("/api/preflight", async (req, res) => {
    try {
      const config = getSSHConfig();
      
      deploymentStatus = {
        status: "scanning",
        message: "Running preflight scan...",
      };

      const result = await runPreflightScan(config);
      lastPreflightResult = result;

      deploymentStatus = {
        status: "idle",
        message: "Preflight scan completed",
        lastScan: result.timestamp,
      };

      res.json(result);
    } catch (error) {
      deploymentStatus = {
        status: "error",
        message: (error as Error).message,
      };
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Deploy to VPS
  app.post("/api/deploy", async (req, res) => {
    try {
      if (!lastPreflightResult) {
        return res.status(400).json({ error: "Run preflight scan first" });
      }

      if (!lastPreflightResult.safePlan.readyToDeploy) {
        return res.status(400).json({ error: "VPS is not ready for deployment. Docker may not be installed." });
      }

      const config = getSSHConfig();
      
      deploymentStatus = {
        status: "deploying",
        message: "Deploying services to VPS...",
      };

      const result = await deployToVPS(config, lastPreflightResult.safePlan.portsToUse);

      deploymentStatus = {
        status: result.success ? "success" : "error",
        message: result.message,
        lastDeploy: new Date().toISOString(),
        services: result.services,
      };

      res.json(result);
    } catch (error) {
      deploymentStatus = {
        status: "error",
        message: (error as Error).message,
      };
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Check service health
  app.get("/api/health-check", async (req, res) => {
    try {
      if (!lastPreflightResult) {
        return res.status(400).json({ error: "Run preflight scan first" });
      }

      const config = getSSHConfig();
      const services = await checkVPSServices(config, lastPreflightResult.safePlan.portsToUse);

      deploymentStatus = {
        ...deploymentStatus,
        services,
      };

      res.json({ services });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Test ntfy notification
  app.post("/api/test-ntfy", async (req, res) => {
    try {
      if (!lastPreflightResult) {
        return res.status(400).json({ error: "Run preflight scan first" });
      }

      const { topic = "strijps", message = "Test notification from LivingRental Alert" } = req.body;
      const config = getSSHConfig();
      
      // We'll use the VPS to send the test notification via curl
      const { Client } = await import("ssh2");
      const client = new Client();
      
      await new Promise<void>((resolve, reject) => {
        client.on("ready", () => resolve());
        client.on("error", reject);
        client.connect({
          host: config.host,
          port: 22,
          username: config.username,
          privateKey: config.privateKey,
        });
      });

      const ntfyPort = lastPreflightResult.safePlan.portsToUse.ntfy;
      
      const result = await new Promise<string>((resolve, reject) => {
        client.exec(`curl -s -d "${message}" http://127.0.0.1:${ntfyPort}/${topic}`, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let output = "";
          stream.on("close", () => resolve(output));
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
        });
      });

      client.end();
      
      res.json({ success: true, result, topic });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get proxy config snippet
  app.get("/api/proxy-config", (req, res) => {
    if (!lastPreflightResult) {
      return res.status(400).json({ error: "Run preflight scan first" });
    }

    res.json({
      proxyType: lastPreflightResult.reverseProxy.type,
      configSnippet: lastPreflightResult.safePlan.proxyConfigSnippet,
    });
  });

  // GitHub API routes
  app.get("/api/github/user", async (req, res) => {
    try {
      const user = await getGitHubUser();
      res.json({ user });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/github/repos", async (req, res) => {
    try {
      const repos = await getRepositories();
      res.json({ repos });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/github/create-repo", async (req, res) => {
    try {
      const { name, description, isPrivate } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "Repository name is required" });
      }

      const repo = await createRepository(
        name,
        description || "LivingRental Alert - VPS Infrastructure Manager",
        isPrivate ?? false
      );

      res.json({ 
        success: true, 
        repo: {
          name: repo.name,
          full_name: repo.full_name,
          html_url: repo.html_url,
          clone_url: repo.clone_url,
          ssh_url: repo.ssh_url,
        }
      });
    } catch (error: any) {
      if (error.status === 422) {
        res.status(422).json({ error: "Repository already exists or name is invalid" });
      } else {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  app.get("/api/github/check-repo/:owner/:repo", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const exists = await checkRepositoryExists(owner, repo);
      res.json({ exists });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Sync project to GitHub (with rate limiting)
  app.post("/api/github/sync", rateLimitGitHubSync, async (req, res) => {
    try {
      const result = await syncToGitHub();
      lastGitHubSync = Date.now(); // Update timestamp after successful sync
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get last commit info
  app.get("/api/github/last-commit", async (req, res) => {
    try {
      const commit = await getLastCommit();
      res.json({ commit });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return httpServer;
}
