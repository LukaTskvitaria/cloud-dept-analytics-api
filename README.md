# Cloud Dept. Analytics API

Analytics API server for Cloud Dept. website.

## Setup

```bash
npm install --production
```

## Run

```bash
node server.js
```

## Deploy to Railway

```bash
railway up
```

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/track` - Track visitor data
- `GET /api/stats` - Get statistics
- `GET /api/visitors` - Get visitor list

## Database

Uses SQLite. Database file is created automatically at `database/analytics.db`.
