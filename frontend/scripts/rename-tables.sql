-- Rename all ai-calling-ui tables to use fwai_aicall_ prefix
-- This prevents collisions with other apps sharing the same database (e.g. Go Nature gn_* tables)

-- 1. users
ALTER TABLE IF EXISTS users RENAME TO fwai_aicall_users;

-- 2. organizations
ALTER TABLE IF EXISTS organizations RENAME TO fwai_aicall_organizations;

-- 3. leads
ALTER TABLE IF EXISTS leads RENAME TO fwai_aicall_leads;
ALTER INDEX IF EXISTS idx_leads_org RENAME TO idx_fwai_aicall_leads_org;
ALTER INDEX IF EXISTS idx_leads_org_created RENAME TO idx_fwai_aicall_leads_org_created;
ALTER INDEX IF EXISTS idx_leads_ghl RENAME TO idx_fwai_aicall_leads_ghl;

-- 4. ui_calls -> fwai_aicall_calls
ALTER TABLE IF EXISTS ui_calls RENAME TO fwai_aicall_calls;
ALTER INDEX IF EXISTS idx_ui_calls_org RENAME TO idx_fwai_aicall_calls_org;
ALTER INDEX IF EXISTS idx_ui_calls_org_initiated RENAME TO idx_fwai_aicall_calls_org_initiated;
ALTER INDEX IF EXISTS idx_ui_calls_uuid RENAME TO idx_fwai_aicall_calls_uuid;
ALTER INDEX IF EXISTS idx_ui_calls_org_active RENAME TO idx_fwai_aicall_calls_org_active;

-- 5. bot_configs
ALTER TABLE IF EXISTS bot_configs RENAME TO fwai_aicall_bot_configs;
ALTER INDEX IF EXISTS idx_bot_configs_org RENAME TO idx_fwai_aicall_bot_configs_org;
ALTER INDEX IF EXISTS idx_bot_configs_active RENAME TO idx_fwai_aicall_bot_configs_active;

-- 6. personas
ALTER TABLE IF EXISTS personas RENAME TO fwai_aicall_personas;
ALTER INDEX IF EXISTS idx_personas_org RENAME TO idx_fwai_aicall_personas_org;
ALTER INDEX IF EXISTS idx_personas_bot_config RENAME TO idx_fwai_aicall_personas_bot_config;

-- 7. situations
ALTER TABLE IF EXISTS situations RENAME TO fwai_aicall_situations;
ALTER INDEX IF EXISTS idx_situations_org RENAME TO idx_fwai_aicall_situations_org;
ALTER INDEX IF EXISTS idx_situations_bot_config RENAME TO idx_fwai_aicall_situations_bot_config;

-- 8. product_sections
ALTER TABLE IF EXISTS product_sections RENAME TO fwai_aicall_product_sections;
ALTER INDEX IF EXISTS idx_product_sections_org RENAME TO idx_fwai_aicall_product_sections_org;
ALTER INDEX IF EXISTS idx_product_sections_bot_config RENAME TO idx_fwai_aicall_product_sections_bot_config;

-- 9. social proof: companies
ALTER TABLE IF EXISTS ui_social_proof_companies RENAME TO fwai_aicall_social_proof_companies;
ALTER INDEX IF EXISTS idx_ui_sp_companies_org RENAME TO idx_fwai_aicall_sp_companies_org;
ALTER INDEX IF EXISTS idx_ui_sp_companies_bot_config RENAME TO idx_fwai_aicall_sp_companies_bot_config;

-- 10. social proof: cities
ALTER TABLE IF EXISTS ui_social_proof_cities RENAME TO fwai_aicall_social_proof_cities;
ALTER INDEX IF EXISTS idx_ui_sp_cities_org RENAME TO idx_fwai_aicall_sp_cities_org;
ALTER INDEX IF EXISTS idx_ui_sp_cities_bot_config RENAME TO idx_fwai_aicall_sp_cities_bot_config;

-- 11. social proof: roles
ALTER TABLE IF EXISTS ui_social_proof_roles RENAME TO fwai_aicall_social_proof_roles;
ALTER INDEX IF EXISTS idx_ui_sp_roles_org RENAME TO idx_fwai_aicall_sp_roles_org;
ALTER INDEX IF EXISTS idx_ui_sp_roles_bot_config RENAME TO idx_fwai_aicall_sp_roles_bot_config;

-- 12. invites
ALTER TABLE IF EXISTS invites RENAME TO fwai_aicall_invites;
ALTER INDEX IF EXISTS idx_invites_email RENAME TO idx_fwai_aicall_invites_email;

-- 13. usage
ALTER TABLE IF EXISTS usage RENAME TO fwai_aicall_usage;

-- 14. campaigns
ALTER TABLE IF EXISTS campaigns RENAME TO fwai_aicall_campaigns;
ALTER INDEX IF EXISTS idx_campaigns_org RENAME TO idx_fwai_aicall_campaigns_org;
ALTER INDEX IF EXISTS idx_campaigns_org_status RENAME TO idx_fwai_aicall_campaigns_org_status;

-- 15. campaign_leads
ALTER TABLE IF EXISTS campaign_leads RENAME TO fwai_aicall_campaign_leads;
ALTER INDEX IF EXISTS idx_cl_campaign RENAME TO idx_fwai_aicall_cl_campaign;
ALTER INDEX IF EXISTS idx_cl_campaign_status RENAME TO idx_fwai_aicall_cl_campaign_status;
ALTER INDEX IF EXISTS idx_cl_call_uuid RENAME TO idx_fwai_aicall_cl_call_uuid;

-- 16. call_queue
ALTER TABLE IF EXISTS call_queue RENAME TO fwai_aicall_call_queue;
ALTER INDEX IF EXISTS idx_call_queue_org_status RENAME TO idx_fwai_aicall_call_queue_org_status;
