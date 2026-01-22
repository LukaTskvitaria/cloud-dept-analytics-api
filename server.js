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
        : [
            'https://clouddept.io', 
            'https://www.clouddept.io',
            'https://analytics.clouddept.io',
            'http://localhost:3000'
          ], // Default allowed origins
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
        let sessionId = data.sessionId;
        const isNewSession = data.isNewSession || false;
        
        // Validate required fields
        if (!visitorId) {
            return res.status(400).json({ success: false, error: 'visitorId is required' });
        }
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'sessionId is required' });
        }
        
        // Get or create visitor
        let visitor = db.prepare('SELECT * FROM visitors WHERE visitor_id = ?').get(visitorId);
        if (!visitor) {
            db.prepare(`
                INSERT INTO visitors (visitor_id, ip_address, user_agent, created_at, last_seen)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(visitorId, ip, data.browser?.userAgent || '');
        } else {
            db.prepare('UPDATE visitors SET last_seen = CURRENT_TIMESTAMP WHERE visitor_id = ?').run(visitorId);
        }
        
        // Ensure session exists (create if it doesn't exist)
        let session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
        if (!session) {
            // Session doesn't exist, create it
            let referrer = data.page?.referrer || null;
            let referrerDomain = null;
            
            // Safely extract referrer domain
            if (referrer && referrer.trim() !== '') {
                try {
                    const referrerUrl = new URL(referrer);
                    referrerDomain = referrerUrl.hostname;
                } catch (err) {
                    // Invalid URL, keep referrerDomain as null
                    console.error('Invalid referrer URL:', referrer);
                }
            }
            
            try {
                db.prepare(`
                    INSERT INTO sessions (visitor_id, session_id, started_at, referrer, referrer_domain)
                    VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
                `).run(
                    visitorId,
                    sessionId,
                    referrer,
                    referrerDomain
                );
            } catch (err) {
                // If session creation fails, log error but continue
                console.error('Session creation error:', err);
            }
        }
        
        // Track page view
        if (data.type === 'pageview') {
            db.prepare(`
                INSERT INTO page_views (session_id, visitor_id, page_path, page_title, viewed_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(sessionId, visitorId, data.page?.path || '/', data.page?.title || '');
            
            // Update session page views count
            db.prepare('UPDATE sessions SET page_views = page_views + 1 WHERE session_id = ?').run(sessionId);
        }
        
        // Update visitor details
        try {
            const geo = getGeoLocation(ip);
            const userAgentString = data.browser?.userAgent || '';
            const agent = useragent.parse(userAgentString);
            
            db.prepare(`
                INSERT OR REPLACE INTO visitor_details 
                (visitor_id, country, country_code, city, region, browser, device_type, os, 
                 screen_width, screen_height, language, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                visitorId,
                geo?.country || null,
                geo?.country || null,
                geo?.city || null,
                geo?.region || null,
                agent.family || null,
                getDeviceType(userAgentString),
                agent.os?.family || null,
                data.screen?.width || null,
                data.screen?.height || null,
                data.browser?.language || null
            );
        } catch (err) {
            // Log error but don't fail the request
            console.error('Visitor details update error:', err);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Tracking error:', error);
        console.error('Error stack:', error.stack);
        console.error('Request data:', JSON.stringify(req.body, null, 2));
        res.status(500).json({ success: false, error: error.message, details: process.env.NODE_ENV === 'development' ? error.stack : undefined });
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

// Enhanced statistics endpoint with all metrics
app.get('/api/stats/enhanced', (req, res) => {
    try {
        const period = req.query.period || '24h';
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        let timeFilter = '';
        let pageViewFilter = '';
        
        if (startDate && endDate) {
            timeFilter = `AND datetime(started_at) >= datetime('${startDate}') AND datetime(started_at) <= datetime('${endDate}')`;
            pageViewFilter = `AND datetime(viewed_at) >= datetime('${startDate}') AND datetime(viewed_at) <= datetime('${endDate}')`;
        } else {
            if (period === '24h') {
                timeFilter = "AND datetime(started_at) > datetime('now', '-1 day')";
                pageViewFilter = "AND datetime(viewed_at) > datetime('now', '-1 day')";
            } else if (period === '7d') {
                timeFilter = "AND datetime(started_at) > datetime('now', '-7 days')";
                pageViewFilter = "AND datetime(viewed_at) > datetime('now', '-7 days')";
            } else if (period === '30d') {
                timeFilter = "AND datetime(started_at) > datetime('now', '-30 days')";
                pageViewFilter = "AND datetime(viewed_at) > datetime('now', '-30 days')";
            }
        }
        
        // Basic metrics
        const totalVisitors = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as count 
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        const totalSessions = db.prepare(`
            SELECT COUNT(*) as count 
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        const totalPageViews = db.prepare(`
            SELECT COUNT(*) as count 
            FROM page_views 
            WHERE 1=1 ${pageViewFilter}
        `).get();
        
        // Bounce rate (sessions with only 1 page view)
        const bounceRate = db.prepare(`
            SELECT 
                COUNT(CASE WHEN page_views = 1 THEN 1 END) * 100.0 / COUNT(*) as rate
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        // Average session duration
        const avgDuration = db.prepare(`
            SELECT AVG(duration) as avg 
            FROM sessions 
            WHERE duration IS NOT NULL AND 1=1 ${timeFilter}
        `).get();
        
        // Average pages per session
        const avgPagesPerSession = db.prepare(`
            SELECT AVG(page_views) as avg 
            FROM sessions 
            WHERE 1=1 ${timeFilter}
        `).get();
        
        // Return visitors vs new visitors
        const returnVisitors = db.prepare(`
            SELECT COUNT(DISTINCT visitor_id) as count
            FROM sessions s1
            WHERE EXISTS (
                SELECT 1 FROM sessions s2 
                WHERE s2.visitor_id = s1.visitor_id 
                AND s2.started_at < s1.started_at
            ) AND 1=1 ${timeFilter}
        `).get();
        
        const newVisitors = totalVisitors.count - returnVisitors.count;
        
        // Hourly trends (last 24 hours)
        const hourlyTrends = db.prepare(`
            SELECT 
                strftime('%H', started_at) as hour,
                COUNT(*) as sessions,
                COUNT(DISTINCT visitor_id) as visitors
            FROM sessions 
            WHERE datetime(started_at) > datetime('now', '-24 hours')
            GROUP BY hour
            ORDER BY hour
        `).all();
        
        // Daily trends (last 30 days)
        const dailyTrends = db.prepare(`
            SELECT 
                date(started_at) as date,
                COUNT(*) as sessions,
                COUNT(DISTINCT visitor_id) as visitors,
                (SELECT COUNT(*) FROM page_views pv WHERE date(pv.viewed_at) = date(s.started_at)) as page_views_count
            FROM sessions s
            WHERE datetime(started_at) > datetime('now', '-30 days')
            GROUP BY date
            ORDER BY date
        `).all();
        
        // Top pages with bounce rate
        const topPages = db.prepare(`
            SELECT 
                p.page_path,
                COUNT(*) as views,
                COUNT(DISTINCT p.session_id) as sessions,
                COUNT(CASE WHEN s.page_views = 1 THEN 1 END) * 100.0 / COUNT(DISTINCT p.session_id) as bounce_rate
            FROM page_views p
            JOIN sessions s ON p.session_id = s.session_id
            WHERE 1=1 ${pageViewFilter}
            GROUP BY p.page_path 
            ORDER BY views DESC 
            LIMIT 20
        `).all();
        
        // Entry pages
        const entryPages = db.prepare(`
            SELECT 
                p.page_path,
                COUNT(*) as entries
            FROM page_views p
            JOIN (
                SELECT session_id, MIN(viewed_at) as first_view
                FROM page_views
                WHERE 1=1 ${pageViewFilter}
                GROUP BY session_id
            ) first ON p.session_id = first.session_id AND p.viewed_at = first.first_view
            GROUP BY p.page_path
            ORDER BY entries DESC
            LIMIT 10
        `).all();
        
        // Exit pages
        const exitPages = db.prepare(`
            SELECT 
                p.page_path,
                COUNT(*) as exits
            FROM page_views p
            JOIN (
                SELECT session_id, MAX(viewed_at) as last_view
                FROM page_views
                WHERE 1=1 ${pageViewFilter}
                GROUP BY session_id
            ) last ON p.session_id = last.session_id AND p.viewed_at = last.last_view
            GROUP BY p.page_path
            ORDER BY exits DESC
            LIMIT 10
        `).all();
        
        // Referrer analysis
        const referrers = db.prepare(`
            SELECT 
                CASE 
                    WHEN referrer_domain IS NULL OR referrer_domain = '' THEN 'Direct'
                    WHEN referrer_domain LIKE '%google%' THEN 'Google'
                    WHEN referrer_domain LIKE '%bing%' THEN 'Bing'
                    WHEN referrer_domain LIKE '%yahoo%' THEN 'Yahoo'
                    WHEN referrer_domain LIKE '%facebook%' THEN 'Facebook'
                    WHEN referrer_domain LIKE '%twitter%' OR referrer_domain LIKE '%x.com%' THEN 'Twitter/X'
                    WHEN referrer_domain LIKE '%linkedin%' THEN 'LinkedIn'
                    WHEN referrer_domain LIKE '%instagram%' THEN 'Instagram'
                    ELSE referrer_domain
                END as source,
                COUNT(*) as sessions,
                COUNT(DISTINCT visitor_id) as visitors
            FROM sessions 
            WHERE 1=1 ${timeFilter}
            GROUP BY source
            ORDER BY sessions DESC
            LIMIT 15
        `).all();
        
        // UTM tracking
        const utmSources = db.prepare(`
            SELECT 
                COALESCE(utm_source, 'none') as source,
                COUNT(*) as sessions
            FROM sessions 
            WHERE 1=1 ${timeFilter}
            GROUP BY source
            ORDER BY sessions DESC
            LIMIT 10
        `).all();
        
        const utmMediums = db.prepare(`
            SELECT 
                COALESCE(utm_medium, 'none') as medium,
                COUNT(*) as sessions
            FROM sessions 
            WHERE 1=1 ${timeFilter}
            GROUP BY medium
            ORDER BY sessions DESC
            LIMIT 10
        `).all();
        
        // Top countries with cities
        const topCountries = db.prepare(`
            SELECT 
                country,
                country_code,
                COUNT(DISTINCT visitor_id) as visitors,
                COUNT(DISTINCT city) as cities
            FROM visitor_details 
            WHERE country IS NOT NULL 
            GROUP BY country, country_code
            ORDER BY visitors DESC 
            LIMIT 20
        `).all();
        
        // Top cities
        const topCities = db.prepare(`
            SELECT 
                city,
                country,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE city IS NOT NULL 
            GROUP BY city, country
            ORDER BY visitors DESC 
            LIMIT 20
        `).all();
        
        // Device details
        const deviceBrands = db.prepare(`
            SELECT 
                device_brand,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE device_brand IS NOT NULL 
            GROUP BY device_brand
            ORDER BY visitors DESC
            LIMIT 10
        `).all();
        
        const deviceModels = db.prepare(`
            SELECT 
                device_brand,
                device_model,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE device_model IS NOT NULL 
            GROUP BY device_brand, device_model
            ORDER BY visitors DESC
            LIMIT 15
        `).all();
        
        // OS versions
        const osVersions = db.prepare(`
            SELECT 
                os,
                os_version,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE os IS NOT NULL AND os_version IS NOT NULL
            GROUP BY os, os_version
            ORDER BY visitors DESC
            LIMIT 15
        `).all();
        
        // Browser versions
        const browserVersions = db.prepare(`
            SELECT 
                browser,
                browser_version,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE browser IS NOT NULL AND browser_version IS NOT NULL
            GROUP BY browser, browser_version
            ORDER BY visitors DESC
            LIMIT 15
        `).all();
        
        // Screen resolutions
        const screenResolutions = db.prepare(`
            SELECT 
                screen_width || 'x' || screen_height as resolution,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE screen_width IS NOT NULL AND screen_height IS NOT NULL
            GROUP BY resolution
            ORDER BY visitors DESC
            LIMIT 15
        `).all();
        
        // Languages
        const languages = db.prepare(`
            SELECT 
                language,
                COUNT(DISTINCT visitor_id) as visitors
            FROM visitor_details 
            WHERE language IS NOT NULL
            GROUP BY language
            ORDER BY visitors DESC
            LIMIT 15
        `).all();
        
        // Real-time active sessions (last 5 minutes)
        const activeSessions = db.prepare(`
            SELECT COUNT(DISTINCT session_id) as count
            FROM page_views
            WHERE datetime(viewed_at) > datetime('now', '-5 minutes')
        `).get();
        
        // Peak hours (all time)
        const peakHours = db.prepare(`
            SELECT 
                strftime('%H', started_at) as hour,
                COUNT(*) as sessions
            FROM sessions
            GROUP BY hour
            ORDER BY sessions DESC
            LIMIT 5
        `).all();
        
        // Device types
        const deviceTypes = db.prepare(`
            SELECT device_type, COUNT(DISTINCT visitor_id) as visitors 
            FROM visitor_details 
            WHERE device_type IS NOT NULL 
            GROUP BY device_type
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
        
        res.json({
            // Basic metrics
            totalVisitors: totalVisitors.count,
            totalSessions: totalSessions.count,
            totalPageViews: totalPageViews.count,
            uniqueToday: db.prepare(`SELECT COUNT(DISTINCT visitor_id) as count FROM sessions WHERE date(started_at) = date('now')`).get().count,
            
            // Advanced metrics
            bounceRate: bounceRate.rate || 0,
            avgSessionDuration: avgDuration.avg || 0,
            avgPagesPerSession: avgPagesPerSession.avg || 0,
            returnVisitors: returnVisitors.count,
            newVisitors: newVisitors,
            
            // Trends
            hourlyTrends,
            dailyTrends,
            
            // Pages
            topPages,
            entryPages,
            exitPages,
            
            // Referrers & Marketing
            referrers,
            utmSources,
            utmMediums,
            
            // Geographic
            topCountries,
            topCities,
            
            // Devices & Technology
            deviceTypes,
            deviceBrands,
            deviceModels,
            osVersions,
            browserVersions,
            topBrowsers,
            screenResolutions,
            languages,
            
            // Real-time
            activeSessions: activeSessions.count,
            
            // Insights
            peakHours
        });
    } catch (error) {
        console.error('Enhanced stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Real-time visitors endpoint
app.get('/api/realtime', (req, res) => {
    try {
        const activeVisitors = db.prepare(`
            SELECT 
                v.visitor_id,
                vd.country,
                vd.city,
                vd.browser,
                vd.device_type,
                p.page_path,
                p.viewed_at
            FROM page_views p
            JOIN visitors v ON p.visitor_id = v.visitor_id
            LEFT JOIN visitor_details vd ON v.visitor_id = vd.visitor_id
            WHERE datetime(p.viewed_at) > datetime('now', '-5 minutes')
            ORDER BY p.viewed_at DESC
            LIMIT 50
        `).all();
        
        res.json({
            count: activeVisitors.length,
            visitors: activeVisitors
        });
    } catch (error) {
        console.error('Realtime error:', error);
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
