-- 邮箱服务：多邮箱账号（收信 + 发信凭据）、场景话术、最小处理台账
-- 邮件正文、主题、附件一律不落库；台账只记去重键与结果，供幂等与「今日/本月」统计

CREATE TABLE "mail_accounts" (
    "id"                SERIAL          NOT NULL,
    "user_id"           VARCHAR(64)     NOT NULL,
    "address"           VARCHAR(160)    NOT NULL,
    "display_name"      VARCHAR(80)     NOT NULL DEFAULT '',
    "protocol"          VARCHAR(8)      NOT NULL DEFAULT 'imap',
    "incoming_host"     VARCHAR(160)    NOT NULL,
    "incoming_port"     INTEGER         NOT NULL,
    "incoming_security" VARCHAR(10)     NOT NULL DEFAULT 'ssl',
    "incoming_username" VARCHAR(160)    NOT NULL,
    "incoming_secret"   VARCHAR(1000)   NOT NULL,
    "inbox_folder"      VARCHAR(80)     NOT NULL DEFAULT 'INBOX',
    "drafts_folder"     VARCHAR(80)     NOT NULL DEFAULT 'Drafts',
    "outgoing_host"     VARCHAR(160)    NOT NULL DEFAULT '',
    "outgoing_port"     INTEGER         NOT NULL DEFAULT 465,
    "outgoing_security" VARCHAR(10)     NOT NULL DEFAULT 'ssl',
    "outgoing_username" VARCHAR(160)    NOT NULL DEFAULT '',
    "outgoing_secret"   VARCHAR(1000)   NOT NULL DEFAULT '',
    "signature"         TEXT            NOT NULL DEFAULT '',
    "reply_mode"        VARCHAR(16)     NOT NULL DEFAULT 'draft_only',
    "max_per_run"       INTEGER         NOT NULL DEFAULT 10,
    "enabled"           BOOLEAN         NOT NULL DEFAULT true,
    "library_ids"       JSONB           NOT NULL DEFAULT '[]',
    "last_run_at"       TIMESTAMP(3),
    "last_error"        VARCHAR(500)    NOT NULL DEFAULT '',
    "created_at"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)    NOT NULL,
    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mail_accounts_user_id_address_key" ON "mail_accounts"("user_id", "address");
CREATE INDEX "mail_accounts_user_id_enabled_idx" ON "mail_accounts"("user_id", "enabled");

CREATE TABLE "mail_scripts" (
    "id"             SERIAL          NOT NULL,
    "mailbox_id"     INTEGER         NOT NULL,
    "user_id"        VARCHAR(64)     NOT NULL,
    "name"           VARCHAR(80)     NOT NULL,
    "keywords"       VARCHAR(300)    NOT NULL DEFAULT '',
    "sender_pattern" VARCHAR(160)    NOT NULL DEFAULT '',
    "priority"       INTEGER         NOT NULL DEFAULT 100,
    "content"        TEXT            NOT NULL,
    "enabled"        BOOLEAN         NOT NULL DEFAULT true,
    "created_at"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)    NOT NULL,
    CONSTRAINT "mail_scripts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mail_scripts_mailbox_id_enabled_priority_idx" ON "mail_scripts"("mailbox_id", "enabled", "priority");

CREATE TABLE "mail_handle_logs" (
    "id"           SERIAL          NOT NULL,
    "user_id"      VARCHAR(64)     NOT NULL,
    "mailbox_id"   INTEGER         NOT NULL,
    "message_key"  VARCHAR(255)    NOT NULL,
    "from_address" VARCHAR(160)    NOT NULL DEFAULT '',
    "result"       VARCHAR(16)     NOT NULL,
    "reason"       VARCHAR(300)    NOT NULL DEFAULT '',
    "handled_on"   DATE            NOT NULL,
    "created_at"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_handle_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mail_handle_logs_mailbox_id_message_key_key" ON "mail_handle_logs"("mailbox_id", "message_key");
CREATE INDEX "mail_handle_logs_user_id_handled_on_idx" ON "mail_handle_logs"("user_id", "handled_on");
CREATE INDEX "mail_handle_logs_mailbox_id_from_address_handled_on_idx" ON "mail_handle_logs"("mailbox_id", "from_address", "handled_on");

-- 定时任务：引用 MCP 连接器（可多个，0＝本站 MCP Server）与指定处理的邮箱
ALTER TABLE "content_agent_schedules"
    ADD COLUMN "connector_ids" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "mailbox_ids" JSONB NOT NULL DEFAULT '[]';
