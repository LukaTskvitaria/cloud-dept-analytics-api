-- Cloud Dept. Analytics Database Schema
-- SQLite Database (can be migrated to PostgreSQL later)

-- Visitors Table
CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT UNIQUE NOT NULL, -- Unique visitor identifier (cookie-based)
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    session_id TEXT UNIQUE NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    duration INTEGER, -- Duration in seconds
    page_views INTEGER DEFAULT 1,
    referrer TEXT,
    referrer_domain TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
);

-- Page Views Table
CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    page_path TEXT NOT NULL,
    page_title TEXT,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_bounce BOOLEAN DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
);

-- Visitor Details Table (geolocation, device info)
CREATE TABLE IF NOT EXISTS visitor_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    country TEXT,
    country_code TEXT,
    city TEXT,
    region TEXT,
    latitude REAL,
    longitude REAL,
    timezone TEXT,
    browser TEXT,
    browser_version TEXT,
    device_type TEXT, -- desktop, mobile, tablet
    device_brand TEXT,
    device_model TEXT,
    os TEXT,
    os_version TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    language TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
);

-- Events Table (custom events, clicks, etc.)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- click, scroll, form_submit, etc.
    event_name TEXT,
    event_data TEXT, -- JSON data
    page_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_visitors_visitor_id ON visitors(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor_id ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_page_views_session_id ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_visitor_details_visitor_id ON visitor_details(visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
