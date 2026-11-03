// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'generated/**',
      '**/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: {
          // tsconfig 的 include 只有 src/** 与 test/**/*.ts；仓库里还有被 tracked 的
          // 运维脚本（备份、种子、隔离上游探测）。不放进程序时 typed lint 只能报
          // parsing error，这些文件就永远没有静态检查。
          allowDefaultProject: [
            '.db-backup.ts',
            '.tmp-inspect-mail.mjs',
            'prisma/*.ts',
            'test/*.cjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files:['src/**/*.ts'],
    ignores:['src/http/transport.ts','src/**/*.spec.ts'],
    rules:{'no-restricted-globals':['error',{name:'fetch',message:'业务服务通过上游客户端调用统一传输层。'}]},
  },
  {
    files:['src/http/**/*.ts','src/auth/**/*.ts'],
    rules:{'@typescript-eslint/no-floating-promises':'error'},
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // 隔离上游探测脚本：CJS 用 require() 动态加载 TS 源码，类型一律拿不到。
    files: ['test/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
