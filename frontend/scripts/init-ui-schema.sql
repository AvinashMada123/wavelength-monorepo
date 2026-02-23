-- UI Schema for ai-calling-ui (PostgreSQL)
-- Tables prefixed with ui_ where they conflict with Python backend tables.

-- 1. users
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'client_admin',
    org_id TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    invited_by TEXT
);

-- 2. organizations
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT,
    slug TEXT,
    plan TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    webhook_url TEXT DEFAULT '',
    settings JSONB DEFAULT '{}',
    usage JSONB DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. leads
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    phone_number TEXT,
    contact_name TEXT,
    email TEXT,
    company TEXT,
    location TEXT,
    tags JSONB DEFAULT '[]',
    status TEXT DEFAULT 'new',
    call_count INTEGER DEFAULT 0,
    last_call_date TEXT,
    source TEXT DEFAULT 'manual',
    ghl_contact_id TEXT,
    qualification_level TEXT,
    qualification_confidence DOUBLE PRECISION,
    last_qualified_at TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_created ON leads(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ghl ON leads(org_id, ghl_contact_id);

-- 4. ui_calls
CREATE TABLE IF NOT EXISTS ui_calls (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    call_uuid TEXT,
    lead_id TEXT,
    request JSONB DEFAULT '{}',
    response JSONB,
    status TEXT DEFAULT 'initiating',
    initiated_at TIMESTAMPTZ DEFAULT NOW(),
    initiated_by TEXT,
    ended_data JSONB,
    duration_seconds DOUBLE PRECISION,
    interest_level TEXT,
    completion_rate DOUBLE PRECISION,
    call_summary TEXT,
    qualification JSONB,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ui_calls_org ON ui_calls(org_id);
CREATE INDEX IF NOT EXISTS idx_ui_calls_org_initiated ON ui_calls(org_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ui_calls_uuid ON ui_calls(org_id, call_uuid);

-- 5. bot_configs
CREATE TABLE IF NOT EXISTS bot_configs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT,
    is_active BOOLEAN DEFAULT false,
    prompt TEXT,
    questions JSONB DEFAULT '[]',
    objections JSONB DEFAULT '[]',
    objection_keywords JSONB DEFAULT '{}',
    context_variables JSONB DEFAULT '{}',
    qualification_criteria JSONB DEFAULT '{}',
    persona_engine_enabled BOOLEAN DEFAULT false,
    product_intelligence_enabled BOOLEAN DEFAULT false,
    social_proof_enabled BOOLEAN DEFAULT false,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_configs_org ON bot_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_bot_configs_active ON bot_configs(org_id, is_active);

-- 6. personas
CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    phrases JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personas_org ON personas(org_id);

-- 7. situations
CREATE TABLE IF NOT EXISTS situations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    hint TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_situations_org ON situations(org_id);

-- 8. product_sections
CREATE TABLE IF NOT EXISTS product_sections (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_sections_org ON product_sections(org_id);

-- 9. social proof: companies
CREATE TABLE IF NOT EXISTS ui_social_proof_companies (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    company_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    notable_outcomes TEXT,
    trending BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_companies_org ON ui_social_proof_companies(org_id);

-- 10. social proof: cities
CREATE TABLE IF NOT EXISTS ui_social_proof_cities (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    city_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    trending BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_cities_org ON ui_social_proof_cities(org_id);

-- 11. social proof: roles
CREATE TABLE IF NOT EXISTS ui_social_proof_roles (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    role_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    success_stories TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_roles_org ON ui_social_proof_roles(org_id);

-- 12. invites
CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    email TEXT,
    org_id TEXT,
    org_name TEXT,
    role TEXT DEFAULT 'client_user',
    invited_by TEXT,
    status TEXT DEFAULT 'pending',
    accepted_at TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

-- 13. usage
CREATE TABLE IF NOT EXISTS usage (
    org_id TEXT NOT NULL,
    period TEXT NOT NULL,
    total_calls INTEGER DEFAULT 0,
    completed_calls INTEGER DEFAULT 0,
    failed_calls INTEGER DEFAULT 0,
    total_seconds DOUBLE PRECISION DEFAULT 0,
    total_minutes DOUBLE PRECISION DEFAULT 0,
    hot_leads INTEGER DEFAULT 0,
    warm_leads INTEGER DEFAULT 0,
    cold_leads INTEGER DEFAULT 0,
    daily_breakdown JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (org_id, period)
);
