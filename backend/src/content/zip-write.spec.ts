import { readZipEntries } from './zip-read';
import { createZip } from './zip-write';

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

describe('createZip', () => {
  it('生成可被 readZipEntries 读回的技能包（stored + deflate 两种压缩）', () => {
    const longBody = Array.from(
      { length: 400 },
      (_, index) => `第 ${index} 行：MCP 动作说明与调用示例。`,
    ).join('\n');
    const zip = createZip(
      [
        {
          path: 'SKILL.md',
          content: '# 客户管理 MCP 助手\n\n用本系统 MCP 查询客户。',
        },
        { path: 'references/mcp-operations.md', content: longBody },
      ],
      new Date('2026-01-01T00:00:00Z'),
    );
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.path)).toEqual([
      'SKILL.md',
      'references/mcp-operations.md',
    ]);
    expect(text(entries[0].bytes)).toContain('客户管理 MCP 助手');
    expect(text(entries[1].bytes)).toBe(longBody);
  });

  it('支持二进制条目', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const entries = readZipEntries(
      createZip([{ path: 'assets/a.bin', content: bytes }], new Date()),
    );
    expect([...entries[0].bytes]).toEqual([...bytes]);
  });

  it.each(['/etc/passwd', 'C:/Windows/system.ini', '../escape.md', 'a//b.md'])(
    '拒绝不安全路径（%s）',
    (path) => {
      expect(() => createZip([{ path, content: 'x' }])).toThrow(/不安全/);
    },
  );

  it('空包直接报错，不产出无法解压的文件', () => {
    expect(() => createZip([])).toThrow(/至少需要/);
  });
});
