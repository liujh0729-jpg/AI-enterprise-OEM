-- 连接器授权闸（智能硬件方案 8.5）：用户自建 MCP 连接器的工具此前无任何授权闸，
-- 模型选中即无条件执行。改为「按连接器授权」——连接器工具是远端运行时探测出来的，
-- 按工具名存授权会因远端改名而静默失效，且工具名由第三方控制，不能决定本站授权粒度。
--
-- scope_type=ACTION：沿用原有语义，action 存契约 operationId（存量行全部落在这里）。
-- scope_type=CONNECTOR：action 固定存 'CONNECTOR'，connector_id 指向 content_agent_mcp_connectors.id。
--
-- 唯一键必须从 (user_id, action) 扩成 (user_id, scope_type, action, connector_id)：
-- CONNECTOR 行的 action 是固定值，旧键会让同一账号只能有一条连接器授权。

ALTER TABLE `agent_action_grants`
  ADD COLUMN `scope_type` VARCHAR(16) NOT NULL DEFAULT 'ACTION',
  ADD COLUMN `connector_id` INT NOT NULL DEFAULT 0;

-- 存量行显式落为 ACTION：默认值已保证，这里再兜一次，避免历史导入数据带空值。
UPDATE `agent_action_grants` SET `scope_type` = 'ACTION' WHERE `scope_type` <> 'CONNECTOR';

-- 旧的 (user_id, action) 唯一键对新模型不适用：ACTION 行仍由新唯一键全量覆盖（scope_type、connector_id 为常量），
-- 唯一性没有放松，因此直接替换而不是保留两条。
ALTER TABLE `agent_action_grants`
  DROP INDEX `agent_action_grants_user_id_action_key`;

CREATE UNIQUE INDEX `agent_action_grants_scope_key`
  ON `agent_action_grants` (`user_id`, `scope_type`, `action`, `connector_id`);

CREATE INDEX `agent_action_grants_user_id_scope_type_idx`
  ON `agent_action_grants` (`user_id`, `scope_type`);
