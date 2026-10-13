-- Migración 001: esquema inicial
-- PostgreSQL 15+ recomendado. Requiere permisos para CREATE EXTENSION.
-- Ejecutar en una base de datos de desarrollo antes de cualquier entorno real.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('CITIZEN', 'ADMIN')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider VARCHAR(30) NOT NULL DEFAULT 'google',
    provider_subject VARCHAR(255) NOT NULL,
    email_private VARCHAR(320),
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject)
);
CREATE INDEX idx_auth_identities_user_id ON auth_identities(user_id);

CREATE TABLE citizen_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    alias VARCHAR(60) NOT NULL,
    administrative_code VARCHAR(40) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(alias)) > 0)
);
CREATE INDEX idx_citizen_profiles_alias ON citizen_profiles(alias);

CREATE TABLE admin_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    display_name VARCHAR(120) NOT NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);
CREATE UNIQUE INDEX uq_user_roles_active ON user_roles(user_id, role_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_user_roles_user_active ON user_roles(user_id) WHERE revoked_at IS NULL;

CREATE TABLE municipal_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL UNIQUE,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_unit_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    municipal_unit_id UUID NOT NULL REFERENCES municipal_units(id) ON DELETE RESTRICT,
    active_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_until TIMESTAMPTZ,
    CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE INDEX idx_admin_memberships_active ON admin_unit_memberships(user_id, municipal_unit_id)
    WHERE active_until IS NULL;

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE subcategories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    code VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (category_id, name),
    UNIQUE (id, category_id)
);
CREATE INDEX idx_subcategories_category ON subcategories(category_id, sort_order);

CREATE TABLE assignment_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    subcategory_id UUID NOT NULL,
    municipal_unit_id UUID NOT NULL REFERENCES municipal_units(id) ON DELETE RESTRICT,
    priority INTEGER NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (subcategory_id, category_id)
        REFERENCES subcategories(id, category_id) ON DELETE RESTRICT,
    UNIQUE (subcategory_id, municipal_unit_id)
);
CREATE INDEX idx_assignment_rules_lookup
    ON assignment_rules(category_id, subcategory_id, priority)
    WHERE active = TRUE;

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_code VARCHAR(24) NOT NULL UNIQUE,
    citizen_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    subcategory_id UUID NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    plus_code VARCHAR(32) NOT NULL,
    plus_code_source VARCHAR(20) NOT NULL
        CHECK (plus_code_source IN ('MANUAL', 'AUTOMATIC')),
    location_verified_at TIMESTAMPTZ,
    location_verification_method VARCHAR(30)
        CHECK (location_verification_method IN ('MATCH', 'CORRECTED', 'SERVER_RECALCULATED')),
    status VARCHAR(30) NOT NULL DEFAULT 'GRACE_PERIOD'
        CHECK (status IN ('GRACE_PERIOD', 'PENDING_REVIEW', 'REJECTED',
                          'ASSIGNED', 'IN_PROGRESS', 'SOLUTION_SUBMITTED', 'RESOLVED')),
    grace_remaining_seconds INTEGER NOT NULL DEFAULT 180
        CHECK (grace_remaining_seconds BETWEEN 0 AND 180),
    grace_running_since TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    formalized_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deletion_reason VARCHAR(100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (subcategory_id, category_id)
        REFERENCES subcategories(id, category_id) ON DELETE RESTRICT,
    CHECK (length(trim(title)) > 0),
    CHECK (length(trim(description)) > 0),
    CHECK (
      (location_verified_at IS NULL AND location_verification_method IS NULL)
      OR
      (location_verified_at IS NOT NULL AND location_verification_method IS NOT NULL)
    ),
    CHECK (status = 'GRACE_PERIOD' OR formalized_at IS NOT NULL)
);
CREATE INDEX idx_complaints_location ON complaints USING GIST(location);
CREATE INDEX idx_complaints_citizen_created ON complaints(citizen_user_id, created_at DESC);
CREATE INDEX idx_complaints_status_formalized ON complaints(status, formalized_at DESC);
CREATE INDEX idx_complaints_category_subcategory ON complaints(category_id, subcategory_id);
CREATE INDEX idx_complaints_not_deleted ON complaints(status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE complaint_grace_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    end_reason VARCHAR(30) CHECK (end_reason IN ('SAVED', 'CANCELLED', 'TIMEOUT', 'FORMALIZED')),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX uq_complaint_grace_session_open
    ON complaint_grace_sessions(complaint_id) WHERE ended_at IS NULL;

CREATE TABLE citizen_submission_limits (
    citizen_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    next_allowed_at TIMESTAMPTZ,
    last_formalized_complaint_id UUID REFERENCES complaints(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE complaint_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    changed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_complaint_status_history ON complaint_status_history(complaint_id, created_at);

CREATE TABLE complaint_solutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    status VARCHAR(25) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED', 'APPROVED', 'RETURNED')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    review_comment TEXT,
    CHECK (length(trim(description)) > 0),
    CHECK (
      (reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
      OR
      (reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
    )
);
CREATE INDEX idx_solutions_complaint ON complaint_solutions(complaint_id, submitted_at DESC);

CREATE TABLE media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID REFERENCES complaints(id) ON DELETE RESTRICT,
    solution_id UUID REFERENCES complaint_solutions(id) ON DELETE RESTRICT,
    media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('COMPLAINT_EVIDENCE', 'SOLUTION_EVIDENCE')),
    storage_key VARCHAR(700) NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    processing_status VARCHAR(25) NOT NULL DEFAULT 'PENDING'
        CHECK (processing_status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'DELETED')),
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (
      (complaint_id IS NOT NULL AND solution_id IS NULL AND purpose = 'COMPLAINT_EVIDENCE')
      OR
      (complaint_id IS NULL AND solution_id IS NOT NULL AND purpose = 'SOLUTION_EVIDENCE')
    )
);
CREATE INDEX idx_media_complaint ON media_assets(complaint_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_solution ON media_assets(solution_id) WHERE deleted_at IS NULL;

CREATE TABLE media_processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    status VARCHAR(25) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX idx_media_jobs_pending ON media_processing_jobs(status, created_at)
    WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE moderation_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    moderator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    rejection_reason TEXT,
    selected_unit_id UUID REFERENCES municipal_units(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (decision = 'REJECTED' AND rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0
       AND selected_unit_id IS NULL)
      OR
      (decision = 'APPROVED' AND rejection_reason IS NULL AND selected_unit_id IS NOT NULL)
    )
);
CREATE INDEX idx_moderation_complaint ON moderation_reviews(complaint_id, created_at DESC);

CREATE TABLE complaint_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE complaint_group_members (
    group_id UUID NOT NULL REFERENCES complaint_groups(id) ON DELETE RESTRICT,
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    added_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, complaint_id),
    UNIQUE (complaint_id, group_id)
);

CREATE TABLE duplicate_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    candidate_complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONFIRMED_GROUP', 'NOT_DUPLICATE', 'DISMISSED')),
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (complaint_id <> candidate_complaint_id),
    CHECK (
      (reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
      OR
      (reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX uq_duplicate_pair ON duplicate_proposals(
    LEAST(complaint_id, candidate_complaint_id),
    GREATEST(complaint_id, candidate_complaint_id)
);

CREATE TABLE complaint_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    municipal_unit_id UUID NOT NULL REFERENCES municipal_units(id) ON DELETE RESTRICT,
    assigned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    notes TEXT,
    CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);
CREATE UNIQUE INDEX uq_complaint_active_assignment
    ON complaint_assignments(complaint_id) WHERE ended_at IS NULL;
CREATE INDEX idx_assignments_unit_active ON complaint_assignments(municipal_unit_id, assigned_at)
    WHERE ended_at IS NULL;

CREATE TABLE violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    complaint_id UUID REFERENCES complaints(id) ON DELETE RESTRICT,
    moderator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(description)) > 0)
);

CREATE TABLE suspensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    violation_id UUID NOT NULL UNIQUE REFERENCES violations(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at = started_at + INTERVAL '168 hours')
);
CREATE UNIQUE INDEX uq_one_active_suspension_per_citizen
    ON suspensions(citizen_user_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_suspensions_expiry ON suspensions(ends_at) WHERE status = 'ACTIVE';

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type VARCHAR(60) NOT NULL,
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    related_complaint_id UUID REFERENCES complaints(id) ON DELETE RESTRICT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_unread ON notifications(recipient_user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE email_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    template_code VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'BOUNCED')),
    provider_message_id VARCHAR(255),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_log_status_created ON email_delivery_log(status, created_at);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, created_at DESC);

-- Función pequeña para mantener updated_at. Las reglas de negocio completas
-- (gracia efectiva, cooldown, RBAC, Plus Code, permisos) pertenecen al backend.
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_complaints_updated_at
BEFORE UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_submission_limits_updated_at
BEFORE UPDATE ON citizen_submission_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
