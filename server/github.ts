// GitHub Integration - Connected via Replit GitHub Connector
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

const REPO_OWNER = 'TitAndAnium';
const REPO_NAME = 'livingrental-alert';

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

export async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

export async function getGitHubUser() {
  const octokit = await getUncachableGitHubClient();
  const { data } = await octokit.rest.users.getAuthenticated();
  return data;
}

export async function createRepository(name: string, description: string, isPrivate: boolean = false) {
  const octokit = await getUncachableGitHubClient();
  const { data } = await octokit.rest.repos.createForAuthenticatedUser({
    name,
    description,
    private: isPrivate,
    auto_init: false,
  });
  return data;
}

export async function getRepositories() {
  const octokit = await getUncachableGitHubClient();
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: 100,
  });
  return data;
}

export async function checkRepositoryExists(owner: string, repo: string): Promise<boolean> {
  try {
    const octokit = await getUncachableGitHubClient();
    await octokit.rest.repos.get({ owner, repo });
    return true;
  } catch (error: any) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

// Files and directories to sync
const SYNC_PATHS = [
  'client/src',
  'client/index.html',
  'server',
  'shared',
  'replit.md',
  'package.json',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.js',
  'drizzle.config.ts',
  'vite.config.ts',
  'components.json',
];

// Files to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  '.replit',
  'replit.nix',
  '.upm',
  '.cache',
  '.config',
  'package-lock.json',
];

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some(pattern => filePath.includes(pattern));
}

function getAllFiles(dirPath: string, basePath: string = ''): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const stat = fs.statSync(dirPath);
  
  if (stat.isFile()) {
    const relativePath = basePath || path.basename(dirPath);
    if (!shouldIgnore(relativePath)) {
      try {
        const content = fs.readFileSync(dirPath, 'utf-8');
        files.push({ path: relativePath, content });
      } catch (e) {
        // Skip binary files or files that can't be read as utf-8
      }
    }
    return files;
  }

  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const relativePath = basePath ? path.join(basePath, item) : item;
    
    if (shouldIgnore(relativePath)) continue;
    
    const itemStat = fs.statSync(fullPath);
    
    if (itemStat.isDirectory()) {
      files.push(...getAllFiles(fullPath, relativePath));
    } else {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        files.push({ path: relativePath, content });
      } catch (e) {
        // Skip binary files
      }
    }
  }
  
  return files;
}

async function getFileSha(octokit: Octokit, filePath: string): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filePath,
    });
    
    if (!Array.isArray(data) && 'sha' in data) {
      return data.sha;
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function syncToGitHub(): Promise<{ success: boolean; message: string; filesUpdated: number; errors: string[] }> {
  const octokit = await getUncachableGitHubClient();
  const errors: string[] = [];
  let filesUpdated = 0;
  
  // Collect all files to sync
  const allFiles: { path: string; content: string }[] = [];
  const projectRoot = process.cwd();
  
  for (const syncPath of SYNC_PATHS) {
    const fullPath = path.join(projectRoot, syncPath);
    allFiles.push(...getAllFiles(fullPath, syncPath));
  }
  
  // Upload each file
  for (const file of allFiles) {
    try {
      const sha = await getFileSha(octokit, file.path);
      const content = Buffer.from(file.content).toString('base64');
      
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: file.path,
        message: `Sync: ${file.path}`,
        content,
        sha: sha || undefined,
      });
      
      filesUpdated++;
    } catch (error: any) {
      errors.push(`${file.path}: ${error.message}`);
    }
  }
  
  return {
    success: errors.length === 0,
    message: errors.length === 0 
      ? `Successfully synced ${filesUpdated} files to GitHub` 
      : `Synced ${filesUpdated} files with ${errors.length} errors`,
    filesUpdated,
    errors,
  };
}

export async function getLastCommit(): Promise<{ sha: string; message: string; date: string } | null> {
  try {
    const octokit = await getUncachableGitHubClient();
    const { data } = await octokit.rest.repos.listCommits({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      per_page: 1,
    });
    
    if (data.length > 0) {
      return {
        sha: data[0].sha.substring(0, 7),
        message: data[0].commit.message,
        date: data[0].commit.author?.date || '',
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}
