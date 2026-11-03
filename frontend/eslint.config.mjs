import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files:["src/**/*.ts","src/**/*.tsx"],
    ignores:["src/api/http.ts"],
    rules:{"no-restricted-imports":["error",{patterns:[{group:["@/lib/api","**/backend/src/**","**/generated/prisma/**"],message:"使用共享契约、具名业务 API 和查询 Hook。"}]}],"no-restricted-globals":["error",{name:"fetch",message:"通过业务 API 和统一 HTTP 客户端发送请求。"}]},
  },
  {
    files:["src/**/*.{ts,tsx}"],
    languageOptions:{parserOptions:{projectService:true,tsconfigRootDir:import.meta.dirname}},
    rules:{"@typescript-eslint/no-floating-promises":"error"},
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
