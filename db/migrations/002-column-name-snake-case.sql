-- Migration: Rename camelCase columns to snake_case
-- Issue: #117
-- Run: sqlite3 db/app.db < db/migrations/002-column-name-snake-case.sql

-- teams
ALTER TABLE teams RENAME COLUMN logoUrl TO logo_url;

-- deploy_tokens
ALTER TABLE deploy_tokens RENAME COLUMN tokenPrefix TO token_prefix;
ALTER TABLE deploy_tokens RENAME COLUMN tokenHash TO token_hash;
ALTER TABLE deploy_tokens RENAME COLUMN lastUsedAt TO last_used_at;
ALTER TABLE deploy_tokens RENAME COLUMN lastUsedIp TO last_used_ip;
ALTER TABLE deploy_tokens RENAME COLUMN usageCount TO usage_count;
ALTER TABLE deploy_tokens RENAME COLUMN expiresAt TO expires_at;
ALTER TABLE deploy_tokens RENAME COLUMN isActive TO is_active;
ALTER TABLE deploy_tokens RENAME COLUMN revokedAt TO revoked_at;
ALTER TABLE deploy_tokens RENAME COLUMN revokedBy TO revoked_by;
ALTER TABLE deploy_tokens RENAME COLUMN createdBy TO created_by;

-- git_providers
ALTER TABLE git_providers RENAME COLUMN clientId TO client_id;
ALTER TABLE git_providers RENAME COLUMN clientSecret TO client_secret;
ALTER TABLE git_providers RENAME COLUMN appId TO app_id;
ALTER TABLE git_providers RENAME COLUMN privateKey TO private_key;
ALTER TABLE git_providers RENAME COLUMN installationId TO installation_id;
ALTER TABLE git_providers RENAME COLUMN apiUrl TO api_url;
ALTER TABLE git_providers RENAME COLUMN baseUrl TO base_url;
ALTER TABLE git_providers RENAME COLUMN isActive TO is_active;

-- git_repositories
ALTER TABLE git_repositories RENAME COLUMN externalId TO external_id;
ALTER TABLE git_repositories RENAME COLUMN fullName TO full_name;
ALTER TABLE git_repositories RENAME COLUMN cloneUrl TO clone_url;
ALTER TABLE git_repositories RENAME COLUMN htmlUrl TO html_url;
ALTER TABLE git_repositories RENAME COLUMN defaultBranch TO default_branch;
ALTER TABLE git_repositories RENAME COLUMN isPrivate TO is_private;
ALTER TABLE git_repositories RENAME COLUMN deployKeyId TO deploy_key_id;
ALTER TABLE git_repositories RENAME COLUMN deployKeyPublic TO deploy_key_public;
ALTER TABLE git_repositories RENAME COLUMN deployKeyPrivate TO deploy_key_private;
ALTER TABLE git_repositories RENAME COLUMN webhookId TO webhook_id;
ALTER TABLE git_repositories RENAME COLUMN webhookSecret TO webhook_secret;
ALTER TABLE git_repositories RENAME COLUMN webhookUrl TO webhook_url;
ALTER TABLE git_repositories RENAME COLUMN branchMappings TO branch_mappings;
ALTER TABLE git_repositories RENAME COLUMN autoDeploy TO auto_deploy;
ALTER TABLE git_repositories RENAME COLUMN autoDeployPreviews TO auto_deploy_previews;
