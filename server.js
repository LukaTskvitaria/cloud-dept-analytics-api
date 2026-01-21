/**
 * Cloud Dept. Analytics API Server
 * Collects and stores visitor analytics data
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const useragent = require('useragent');
const geoip = require('geoip-lite');

const app = express();
// Railway and Render use PORT env variable, fallback to 3001 for local
const PORT = process.env.PORT || 3001;

// Middleware
const corsOptions = {
    origin: process.env.CORS_ORIGINS 
        ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
        : ['https://clouddept.io', 'https://www.clouddept.io'], // Default allowed origins
    credentials: false, // Set to false since we don't need cookies/auth
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());

// Database setup
// Use relative path for Railway deployment
const dbPath = path.join(__dirname, 'database', 'analytics.db');
const db = new Database(dbPath);

// Initialize database schema
const fs = require('fs');
// Try both paths: Railway deployment (database/) and local development (../database/)
let schemaPath = path.join(__dirname, 'database', 'schema.sql');
if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, '../database/schema.sql');
}
if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
}

// Helper functions
function getDeviceType(userAgent) {
    const agent = useragent.parse(userAgent);
    if (agent.device.family === 'Spider' || agent.device.family === 'Other') {
        return 'desktop';
    }
    if (agent.device.family.toLowerCase().includes('mobile') || 
        agent.device.family.toLowerCase().includes('phone')) {
        return 'mobile';
    }
    if (agent.device.family.toLowerCase().includes('tablet') || 
        agent.device.family.toLowerCase().includes('ipad')) {
        return 'tablet';
    }
    return 'desktop';
}

function getGeoLocation(ip) {
    // Skip localhost and private IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return null;
    }
    return geoip.lookup(ip);
}

// API Routes

// Root path - API info
app.get('/', (req, res) => {
    res.json({
        service: 'Cloud Dept. Analytics API',
        version: '1.0.0',
        endpoints: {
            health: '/api/health',
            track: '/api/track',
            stats: '/api/stats',
            visitors: '/api/visitors'
        },
        status: 'online'
    });
});

// Track endpoint - receives analytics data
app.post('/api/track', (req, res) => {
    try {
        const data = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        
        // Extract visitor info
        const visitorId = data.visitorId;
        const sessionId = data.sessionId;
        const isNewSession = data.isNewSession || false;
        
        // Get or create visitor
        let visitor = db.prepare('SELECT * FROM visitors WHERE visitor_id = ?').get(visitorId);
        if (!visitor) {
            db.prepare(`
                INSERT INTO visitors (visitor_id, ip_address, user_agent, created_at, last_seen)
                VALUES (?, ?, ?, datetime('now'), datetime('now'))
            `).run(visitorId, ip, data.browser?.userAgent || '');
        } else {
            db.prepare('UPDATE visitors SET last_seen = datetime("now") WHERE visitor_id = ?').run(visitorId);
        }
        
        // Create or update session
        if (isNewSession) {
            db.prepare(`
                INSERT INTO sessions (visitor_id, session_id, started_at, referrer, referrer_domain)
                VALUES (?, ?, datetime('now'), ?, ?)
            `).run(
                visitorId,
                sessionId,
                data.page?.referrer || null,
                data.page?.referrer ? new URL(data.page.referrer).hostname : null
            );
        }
        
        // Track page view
        if (data.type === 'pageview') {
            db.prepare(`
                INSERT INTO page_views (session_id, visitor_id, page_path, page_title, viewed_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `).run(sessionId, visitorId, data.page?.path || '/', data.page?.title || '');
            
            // Update session page views count
            db.prepare('UPDATE sessions SET page_views = page_views + 1 WHERE session_id = ?').run(sessionId);
        }
        
        // Update visitor details
        const geo = getGeoLocation(ip);
        const agent = useragent.parse(data.browser?.userAgent || '');
        
        db.prepare(`
            INSERT OR REPLACE INTO visitor_details 
            (visitor_id, country, country_code, city, region, browser, device_type, os, 
             screen_width, screen_height, language, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            visitorId,
            geo?.country || null,
            geo?.country || null,
            geo?.city || null,
            geo?.region || null,
            agent.family || null,
            getDeviceType(data.browser?.userAgent || ''),
            agent.os.family || null,
            data.screen?.width || null,
            data.screen?.height || null,
            data.browser?.language || null
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Tracking error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get statistics endpoint
app.get('/api/stats', (req, res) => {
    try {
        const period = req.query.period || '24h'; // 24h, 7d, 30d, all
        
        let timeFilter = '';
        if (period === '24h') {
            timeFilter = "AND datetime(started_at) > datetime('now', '-1 day')";
        } else if (period === '7d') {
            timeFilter = "AND datetime(started_at) > datetime('now', '-7 days')";
        } else if (period === '30d') {
            timeFilter = "AND datetime(started_at) > datetime('now', '-30 days')";
        }
        
        // Total visitors
        const totalVisitors = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as count 
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        // Total sessions
        const totalSessions = db.prepare(`
            SELECT COUNT(*) as count 
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        // Total page views
        const totalPageViews = db.prepare(`
            SELECT COUNT(*) as count 
            FROM page_views 
            WHERE 1=1 ${timeFilter.replace('started_at', 'viewed_at')}
        `).get();
        
        // Unique visitors today
        const uniqueToday = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as count 
            FROM sessions 
            WHERE date(started_at) = date('now')
        `).get();
        
        // Top pages
        const topPages = db.prepare(`
            SELECT page_path, COUNT(*) as views 
            FROM page_views 
            WHERE 1=1 ${timeFilter.replace('started_at', 'viewed_at')}
            GROUP BY page_path 
            ORDER BY views DESC 
            LIMIT 10
        `).all();
        
        // Top countries
        const topCountries = db.prepare(`
            SELECT country, COUNT(DISTINCT visitor_id) as visitors 
            FROM visitor_details 
            WHERE country IS NOT NULL 
            GROUP BY country 
            ORDER BY visitors DESC 
            LIMIT 10
        `).all();
        
        // Top browsers
        const topBrowsers = db.prepare(`
            SELECT browser, COUNT(DISTINCT visitor_id) as visitors 
            FROM visitor_details 
            WHERE browser IS NOT NULL 
            GROUP BY browser 
            ORDER BY visitors DESC 
            LIMIT 10
        `).all();
        
        // Device types
        const deviceTypes = db.prepare(`
            SELECT device_type, COUNT(DISTINCT visitor_id) as visitors 
            FROM visitor_details 
            WHERE device_type IS NOT NULL 
            GROUP BY device_type
        `).all();
        
        res.json({
            totalVisitors: totalVisitors.count,
            totalSessions: totalSessions.count,
            totalPageViews: totalPageViews.count,
            uniqueToday: uniqueToday.count,
            topPages,
            topCountries,
            topBrowsers,
            deviceTypes
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get recent visitors
app.get('/api/visitors', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        
        const visitors = db.prepare(`
            SELECT 
                v.visitor_id,
                v.ip_address,
                v.last_seen,
                vd.country,
                vd.city,
                vd.browser,
                vd.device_type,
                vd.os,
                COUNT(DISTINCT s.id) as session_count,
                SUM(s.page_views) as total_page_views
            FROM visitors v
            LEFT JOIN visitor_details vd ON v.visitor_id = vd.visitor_id
            LEFT JOIN sessions s ON v.visitor_id = s.visitor_id
            GROUP BY v.visitor_id
            ORDER BY v.last_seen DESC
            LIMIT ?
        `).all(limit);
        
        res.json(visitors);
    } catch (error) {
        console.error('Visitors error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`Analytics API server running on port ${PORT}`);
    console.log(`Database: ${dbPath}`);
});
