# ✅ Verify Files Before Upload

## Required Files Checklist

Before uploading to Railway, make sure these files exist:

### Core Files:
- [x] `server.js` - Main server file
- [x] `package.json` - Dependencies list
- [x] `Procfile` - Start command (optional but recommended)

### Database:
- [x] `database/schema.sql` - Database schema

### Config Files:
- [x] `railway.json` - Railway configuration (optional)
- [x] `.railwayignore` - Files to ignore (optional)

## File Structure Should Be:

```
api/
├── server.js
├── package.json
├── package-lock.json (auto-generated, optional)
├── Procfile
├── database/
│   └── schema.sql
├── railway.json (optional)
└── .railwayignore (optional)
```

## Start Command

Railway should use:
```
node server.js
```

This is set in:
- `Procfile` (contains: `web: node server.js`)
- Or set manually in Railway Settings → Deploy → Start Command

## After Upload

1. Railway auto-detects Node.js
2. Runs `npm install` automatically
3. Starts with `node server.js`
4. Service should go online ✅

## Troubleshooting

**If service stays offline:**
1. Check Logs tab for errors
2. Verify `package.json` exists
3. Verify `server.js` exists
4. Check Start Command is `node server.js`
