-- 数字分身加强：分身可挂默认知识范围与执行模型；长期记忆可按分身隔离；助理渠道可绑定分身。
ALTER TABLE `content_agent_personas`
  ADD COLUMN `space_id` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `library_ids` JSON NULL,
  ADD COLUMN `channel_id` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `model` VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE `content_agent_assistant_channels`
  ADD COLUMN `persona_id` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `content_agent_memories`
  ADD COLUMN `persona_id` INTEGER NOT NULL DEFAULT 0;

DROP INDEX `content_agent_memories_user_id_normalized_key` ON `content_agent_memories`;
CREATE UNIQUE INDEX `content_agent_memories_user_id_persona_id_normalized_key`
  ON `content_agent_memories`(`user_id`, `persona_id`, `normalized`);
