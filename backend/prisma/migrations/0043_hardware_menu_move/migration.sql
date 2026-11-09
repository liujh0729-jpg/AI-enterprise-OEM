-- 智能硬件整组移入「开放集成」子分组，菜单 MCP / API 更名硬件MCP / 硬件API（与 routes.ts / FEATURE_SEED 同构）。
-- 新库由 ensureSeed 直接按新种子插入；这里只修正存量行。标题带旧值条件，保留管理员自定义改名。
UPDATE feature_catalog SET parent_code = 'open-integration', sort_order = 60 WHERE code = 'hardware';
UPDATE feature_catalog SET title = '硬件MCP' WHERE code = 'hardware-mcp' AND title = 'MCP';
UPDATE feature_catalog SET title = '硬件API' WHERE code = 'hardware-api' AND title = 'API';