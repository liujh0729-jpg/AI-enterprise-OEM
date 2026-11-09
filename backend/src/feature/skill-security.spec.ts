import {
  formatSecurityFailure,
  parseSkillSecurityMeta,
  runUploadSecurityGate,
  scanRuntimeContent,
} from './skill-security';

const FRONTMATTER = (body: string) =>
  `---\nname: demo\ndescription: 演示技能\n${body}\n---\n正文`;

describe('parseSkillSecurityMeta', () => {
  it('解析 frontmatter 里的 category 与四类权限（嵌套块写法）', () => {
    const meta = parseSkillSecurityMeta(
      FRONTMATTER(
        [
          'category: dev-programming',
          'permissions:',
          '  network:',
          '    - api.github.com',
          '  fs:',
          '    - read:data/',
          '  exec:',
          '    - node',
          '  secrets:',
          '    - MY_API_KEY',
        ].join('\n'),
      ),
    );
    expect(meta.category).toBe('dev-programming');
    expect(meta.declared).toBe(true);
    expect(meta.permissions).toEqual({
      network: ['api.github.com'],
      fs: ['read:data/'],
      exec: ['node'],
      secrets: ['MY_API_KEY'],
    });
  });

  it('插件清单的 category / permissions 也认，并提示声明来源', () => {
    const meta = parseSkillSecurityMeta('# 插件说明', {
      manifest: {
        category: 'office-efficiency',
        permissions: { network: ['docs.example.com'] },
      },
    });
    expect(meta.category).toBe('office-efficiency');
    expect(meta.permissions.network).toEqual(['docs.example.com']);
    expect(meta.warnings.join('')).toContain('插件清单');
  });

  it('未声明权限时按空集收敛并给出默认拒绝告警', () => {
    const meta = parseSkillSecurityMeta(FRONTMATTER(''));
    expect(meta.declared).toBe(false);
    expect(meta.permissions).toEqual({
      network: [],
      fs: [],
      exec: [],
      secrets: [],
    });
    expect(meta.warnings.join('')).toContain('默认拒绝');
  });
});

describe('runUploadSecurityGate 串行四组检查', () => {
  const base = {
    mainPath: 'SKILL.md',
    content: FRONTMATTER('category: writing'),
    files: [] as { path: string; content: string }[],
  };

  it('1.1 恶意代码命中即拒绝，后续组不再执行', () => {
    const result = runUploadSecurityGate({
      ...base,
      content: `${base.content}\n用 xmrig 挖矿：stratum+tcp://pool.example.com`,
    });
    expect(result.passed).toBe(false);
    expect(result.firstFailure?.key).toBe('malicious');
    expect(result.groups.map((group) => group.key)).toEqual(['malicious']);
    expect(formatSecurityFailure(result)).toContain('1.1');
    expect(formatSecurityFailure(result)).toContain('未入库');
  });

  it('1.2 内容类技能声明网络权限属于越权（能力基线外）', () => {
    const result = runUploadSecurityGate({
      ...base,
      content: FRONTMATTER(
        [
          'category: text_summarize',
          'permissions:',
          '  network:',
          '    - api.example.com',
        ].join('\n'),
      ),
    });
    expect(result.passed).toBe(false);
    expect(result.firstFailure?.key).toBe('permissions');
    expect(result.firstFailure?.findings.map((item) => item.rule)).toContain(
      'r1.2-network-outside-baseline',
    );
  });

  it('1.2 平台保留密钥不允许声明', () => {
    const result = runUploadSecurityGate({
      ...base,
      content: FRONTMATTER(
        [
          'category: dev-programming',
          'permissions:',
          '  secrets:',
          '    - DATABASE_URL',
        ].join('\n'),
      ),
    });
    expect(result.passed).toBe(false);
    expect(result.firstFailure?.findings.map((item) => item.rule)).toContain(
      'r1.2-secret-reserved',
    );
  });

  it('1.3 通配符、内网与云元数据地址一律拒绝', () => {
    for (const entry of [
      '*.example.com',
      'localhost',
      '169.254.169.254',
      '10.0.0.8',
    ]) {
      const result = runUploadSecurityGate({
        ...base,
        content: FRONTMATTER(
          [
            'category: dev-programming',
            'permissions:',
            '  network:',
            `    - ${entry}`,
          ].join('\n'),
        ),
      });
      expect(result.passed).toBe(false);
      expect(result.firstFailure?.key).toBe('network');
    }
  });

  it('1.4 包内高危命令命中即拒绝', () => {
    const result = runUploadSecurityGate({
      ...base,
      files: [
        {
          path: 'scripts/setup.md',
          content: '执行 rm -rf / 清理环境',
        },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.firstFailure?.key).toBe('commands');
    expect(result.firstFailure?.findings.map((item) => item.rule)).toContain(
      'r1.4-rm-rf',
    );
  });

  it('合法声明且内容干净的包通过四组检查', () => {
    const result = runUploadSecurityGate({
      ...base,
      content: FRONTMATTER(
        [
          'category: dev-programming',
          'permissions:',
          '  network:',
          '    - api.github.com',
        ].join('\n'),
      ),
    });
    expect(result.passed).toBe(true);
    expect(result.firstFailure).toBeNull();
    expect(result.groups.map((group) => group.key)).toEqual([
      'malicious',
      'permissions',
      'network',
      'commands',
    ]);
  });
});

describe('scanRuntimeContent', () => {
  it('运行期只查代码/命令/外联风险，不重复校验权限元数据', () => {
    const hits = scanRuntimeContent([
      { path: 'SKILL.md', content: FRONTMATTER('category: writing') },
      { path: 'notes.md', content: '执行 rm -rf /tmp/cache' },
    ]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((item) => item.group !== 'permissions')).toBe(true);
    expect(hits.map((item) => item.rule)).toContain('r1.4-rm-rf');
  });
});
