-- RPA 代理口令改成密文落库（与登录口令同一套 AES-256-GCM 密钥）。
--
-- 旧的 proxy_password 列存明文，而且账号列表 / 详情接口会把它原样回显到浏览器，
-- 属于凭据泄露面，所以整列下线而不是改名保留：库里可能已存在的明文一律清除，
-- 由账号归属人重新录入（新写入走 proxy_password_cipher，接口只回「是否已保存」）。
-- 开发库实测该列两条记录全是空串，没有业务数据受损。
-- 幂等写法：既支持全新库从零建表，也支持已用 db push 建过的库补齐缺失对象。

-- 安全检查：如果 proxy_password 列里已有非空值，说明有真实明文口令需要迁移，
-- 不能直接 DROP。先让人导出并通知账号归属人重新录入，再继续。
DO $$
DECLARE
    has_data boolean;
    col_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rpa_accounts' AND column_name = 'proxy_password'
    ) INTO col_exists;

    IF col_exists THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM rpa_accounts WHERE proxy_password IS NOT NULL AND proxy_password <> '''')' INTO has_data;
        IF has_data THEN
            RAISE EXCEPTION 'rpa_accounts.proxy_password 仍有非空明文口令，请先通知账号归属人重新录入后再跑迁移';
        END IF;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "rpa_accounts"
    ADD COLUMN IF NOT EXISTS "proxy_password_cipher" TEXT NOT NULL DEFAULT '';
ALTER TABLE "rpa_accounts" DROP COLUMN IF EXISTS "proxy_password";
