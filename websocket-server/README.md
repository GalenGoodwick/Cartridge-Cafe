# Unity Chant WebSocket Server

Real-time multiplayer position sync for World mode.

## Features

- ✅ Spatial culling - only broadcasts to nearby players (2000 unit radius)
- ✅ 10fps position updates (configurable to 30fps)
- ✅ Auto-cleanup of stale connections
- ✅ Health check endpoint for monitoring
- ✅ Lightweight - handles 1000+ concurrent players on small instance

## Local Development

```bash
npm install
npm start
# Server runs on http://localhost:8080
```

## Railway Deployment

### One-time setup:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Link to Railway project (creates new project)
railway link
```

### Deploy:

```bash
railway up
```

### Environment Variables (set in Railway dashboard):

- `PORT` - Auto-set by Railway (don't override)

### Get your WebSocket URL:

```bash
railway domain
# Example: unionchant-ws.up.railway.app
```

Then set in web/.env.local:
```
NEXT_PUBLIC_WS_URL=wss://unionchant-ws.up.railway.app
```

## Scaling

**Free tier:** Handles ~500 concurrent players
**$5/month:** Handles ~5000 concurrent players with spatial culling

To increase update rate to 30fps, change `BROADCAST_INTERVAL` to `33` in server.js.

## Health Check

GET `/health` returns:
```json
{
  "status": "ok",
  "players": 42,
  "timestamp": 1234567890
}
```
