import { readZipEntries } from './zip-read';

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

/** 手工拼一个只含一条 stored 条目的最小 zip：不依赖压缩库，也能把偏移量改成畸形值。 */
function oneEntryZip(
  overrides: { localOffset?: number; compressedSize?: number } = {},
) {
  const name = Buffer.from('SKILL.md', 'utf8');
  const body = Buffer.from('# skill', 'utf8');
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(body.length),
    u32(body.length),
    u16(name.length),
    u16(0),
    name,
    body,
  ]);
  const centralStart = local.length;
  const compressedSize = overrides.compressedSize ?? body.length;
  const central = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(compressedSize),
    u32(body.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(overrides.localOffset ?? 0),
    name,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(centralStart),
    u16(0),
  ]);
  return Buffer.concat([local, central, eocd]);
}

describe('readZipEntries', () => {
  it('读出 stored 条目的路径与正文', () => {
    const entries = readZipEntries(oneEntryZip());
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('SKILL.md');
    expect(Buffer.from(entries[0].bytes).toString('utf8')).toBe('# skill');
  });

  it.each([
    ['局部头偏移越出文件尾', { localOffset: 999_999 }],
    ['偏移指到别处（不是局部头签名）', { localOffset: 40 }],
    ['声明的压缩长度越出文件尾', { compressedSize: 999_999 }],
  ])('畸形条目按跳过处理（%s）', (_name, overrides) => {
    expect(() => readZipEntries(oneEntryZip(overrides))).not.toThrow();
    expect(readZipEntries(oneEntryZip(overrides))).toEqual([]);
  });

  it('尾部被截断的包报业务错误，不抛 RangeError', () => {
    const buffer = oneEntryZip().subarray(0, 20);
    expect(() => readZipEntries(buffer)).toThrow(/zip/i);
  });
});
