# LivingRental Alert - VPS Infrastructure Manager

## Overview

LivingRental Alert is a rental listing monitor platform (Phase 1). This Replit app serves as a control dashboard for managing VPS infrastructure that runs:

- **PostgreSQL** - Database for n8n workflows
- **n8n** - Workflow automation platform  
- **ntfy** - Push notification server for iPhone/iPad alerts
- **Fetcher** - Playwright-based web scraping microservice

## VPS Domain

- **Domain:** rentalert.sellsiren.com
- **VPS IP:** 69.62.118.231

### Service URLs (after proxy setup)
- n8n: https://rentalert.sellsiren.com/n8n/
- ntfy: https://rentalert.sellsiren.com/ntfy/
- Fetcher: https://rentalert.sellsiren.com/fetcher/

## Project Structure

```
├── client/                    # React frontend
│   ├── src/
│   │   ├── pages/
│   │   │   └── Dashboard.tsx  # Main dashboard UI
│   │   └── index.css          # Theme colors
│   └── index.html
├── server/
│   ├── routes.ts              # API endpoints
│   ├── github.ts              # GitHub integration
│   ├── vps/
│   │   ├── preflight.ts       # VPS scanning via SSH
│   │   └── deploy.ts          # Docker deployment
│   └── index.ts
├── shared/
│   └── schema.ts              # TypeScript types
└── replit.md                  # This file
```

## Secrets Required

- VPS_PERSONAL_IP - VPS IP address
- VPS_PERSONAL_USER - SSH username (usually root)
- VPS_SSH_PRIVATE_KEY - SSH private key for authentication

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/status | GET | Current deployment status and preflight results |
| /api/preflight | POST | Run VPS scan (detects Docker, ports, services) |
| /api/deploy | POST | Deploy Docker stack to VPS |
| /api/health-check | GET | Check health of deployed services |
| /api/test-ntfy | POST | Send test push notification |
| /api/proxy-config | GET | Get reverse proxy config snippet |

## Dashboard Features

1. **Overview Tab** - Service status cards, quick actions
2. **Services Tab** - Detailed view of each service
3. **Preflight Tab** - VPS system info, Docker containers, resources
4. **Config Tab** - Reverse proxy configuration snippets

## VPS Deployment

The deployment creates files at /opt/rentalmonitor/ on the VPS:

- docker-compose.yml - Stack configuration
- .env - Auto-generated secrets
- fetcher/ - Playwright microservice
- README.md - Quick reference

## Fetcher Microservice

Endpoints on the VPS:
- GET /health - Health check
- POST /fetch - Fetch URL with mode: "http" or mode: "browser"

Protected by X-Fetcher-Secret header.

## Phase 1 Complete

- [x] VPS preflight scan
- [x] Docker Compose stack
- [x] Playwright fetcher microservice
- [x] ntfy push notifications
- [x] n8n workflow platform
- [x] Replit dashboard
- [x] GitHub integration

## GitHub Repository

Repository: https://github.com/TitAndAnium/livingrental-alert

### Sync Instructions
1. Open the Git panel in Replit's sidebar
2. Connect to the livingrental-alert repository
3. Push changes to sync with GitHub

### GitHub API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/github/user | GET | Get authenticated GitHub user |
| /api/github/repos | GET | List user's repositories |
| /api/github/create-repo | POST | Create new repository |

## Future Phases

- Phase 2: n8n workflows for realtime ping and morning digest
- Phase 3: Replit web dashboard for multi-device control
- Phase 4: Source adapters and optional AI extraction
- Phase 5: Optional login support with encrypted credentials
