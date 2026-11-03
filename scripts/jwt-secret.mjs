// 脚本用 JWT 签发密钥：优先环境变量，其次读 backend/.env（本机开发）。
// 不再内置兜底默认值——那个串一旦留在仓库里就等于公开密钥。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function scriptJwtSecret() {
  const fromEnv = String(process.env.JWT_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync(join(root, "backend/.env"), "utf8")
      .split(/\r?\n/)
      .find((item) => item.startsWith("JWT_SECRET="));
    const value = String(line?.slice("JWT_SECRET=".length) || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  } catch {
    // 落到下面的统一报错
  }
  throw new Error(
    "未找到 JWT_SECRET：请设置环境变量 JWT_SECRET，或配置 backend/.env",
  );
}
