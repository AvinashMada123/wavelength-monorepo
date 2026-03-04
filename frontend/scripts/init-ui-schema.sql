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
    custom_fields JSONB DEFAULT '{}',
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
    completed_at TIMESTAMPTZ,
    bot_config_id TEXT,
    bot_config_name TEXT
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
    social_proof_min_turn INTEGER DEFAULT 0,
    max_call_duration INTEGER DEFAULT 480,
    ghl_workflows JSONB DEFAULT '[]',
    micro_moments_config JSONB DEFAULT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bot_configs_org ON bot_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_bot_configs_active ON bot_configs(org_id, is_active);
-- Migration: add micro_moments_config column if missing
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS micro_moments_config JSONB DEFAULT NULL;
-- Migration: add social_proof_min_turn column if missing (minimum turns before social proof tool fires)
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS social_proof_min_turn INTEGER DEFAULT 0;
-- Migration: add pre_research and memory_recall flags
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS pre_research_enabled BOOLEAN DEFAULT false;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS memory_recall_enabled BOOLEAN DEFAULT false;

-- 6. personas
CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    phrases JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personas_org ON personas(org_id);
CREATE INDEX IF NOT EXISTS idx_personas_bot_config ON personas(bot_config_id);

-- 7. situations
CREATE TABLE IF NOT EXISTS situations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    hint TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_situations_org ON situations(org_id);
CREATE INDEX IF NOT EXISTS idx_situations_bot_config ON situations(bot_config_id);

-- 8. product_sections
CREATE TABLE IF NOT EXISTS product_sections (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    name TEXT,
    content TEXT,
    keywords JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_sections_org ON product_sections(org_id);
CREATE INDEX IF NOT EXISTS idx_product_sections_bot_config ON product_sections(bot_config_id);

-- 9. social proof: companies
CREATE TABLE IF NOT EXISTS ui_social_proof_companies (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    company_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    notable_outcomes TEXT,
    trending BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_companies_org ON ui_social_proof_companies(org_id);
CREATE INDEX IF NOT EXISTS idx_ui_sp_companies_bot_config ON ui_social_proof_companies(bot_config_id);

-- 10. social proof: cities
CREATE TABLE IF NOT EXISTS ui_social_proof_cities (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    city_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    trending BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_cities_org ON ui_social_proof_cities(org_id);
CREATE INDEX IF NOT EXISTS idx_ui_sp_cities_bot_config ON ui_social_proof_cities(bot_config_id);

-- 11. social proof: roles
CREATE TABLE IF NOT EXISTS ui_social_proof_roles (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    bot_config_id TEXT,
    role_name TEXT,
    enrollments_count INTEGER DEFAULT 0,
    success_stories TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ui_sp_roles_org ON ui_social_proof_roles(org_id);
CREATE INDEX IF NOT EXISTS idx_ui_sp_roles_bot_config ON ui_social_proof_roles(bot_config_id);

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

-- 14. campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    bot_config_id TEXT NOT NULL,
    bot_config_name TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    concurrency_limit INTEGER NOT NULL DEFAULT 100,
    total_leads INTEGER NOT NULL DEFAULT 0,
    completed_calls INTEGER NOT NULL DEFAULT 0,
    failed_calls INTEGER NOT NULL DEFAULT 0,
    no_answer_calls INTEGER NOT NULL DEFAULT 0,
    webhook_base_url TEXT NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON campaigns(org_id, status);

-- 15. campaign_leads
CREATE TABLE IF NOT EXISTS campaign_leads (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    call_uuid TEXT,
    position INTEGER NOT NULL,
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_cl_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cl_campaign_status ON campaign_leads(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_cl_call_uuid ON campaign_leads(call_uuid);

-- Migration: add bot_notes column to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bot_notes TEXT DEFAULT '';

-- Migrations: add bot config tracking to ui_calls
ALTER TABLE ui_calls ADD COLUMN IF NOT EXISTS bot_config_id TEXT;
ALTER TABLE ui_calls ADD COLUMN IF NOT EXISTS bot_config_name TEXT;

-- Migrations: retry support
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS retry_config JSONB;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Migrations: Twilio provider support (per bot config)
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS call_provider TEXT DEFAULT 'plivo';

-- 16. call_queue (webhook calls queued when at concurrency limit)
CREATE TABLE IF NOT EXISTS call_queue (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    status TEXT NOT NULL DEFAULT 'queued',
    lead_id TEXT,
    bot_config_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    call_uuid TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_queue_org_status ON call_queue(org_id, status, created_at);

-- Migration: add voice and call_provider if missing (were in CREATE TABLE but not as ALTER)
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS voice TEXT DEFAULT '';

-- Migration: add pipeline mode, language, TTS provider to bot configs
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS pipeline_mode TEXT DEFAULT 'live_api';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT '';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT '';

-- Fast counting of active calls for concurrency gate
CREATE INDEX IF NOT EXISTS idx_ui_calls_org_active ON ui_calls(org_id) WHERE status IN ('in-progress', 'initiating');
