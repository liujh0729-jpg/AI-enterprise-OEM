import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import {
  DirectMailClient,
  DirectMailError,
  type DmReceiver,
} from './directmail.client';
import {
  AliyunMailService,
  chunkRows,
  emailOf,
  hashEmail,
  maskEmail,
  requirePositiveId,
} from './aliyun-mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { AliyunMailCrypto } from './aliyun-mail-crypto';
import type { DataTableService } from '../data-table/data-table.service';
import { stub } from '../../test/doubles';

/**
 * 邮件推送的本地口径单测：不连阿里云、不连库，用桩件验证
 * 「邮箱归一 / 打码 / 台账判重 / 变量校验 / 容量与上限 / 500 条切批」。
 *
 * 列表目录相关的调用统一打桩在 DirectMailClient.prototype 上，
 * 因此这些用例也覆盖了「新建模式要查列表数量上限」这一前置依赖。
 */

const user = new CurrentUser('user-mail-unit', 'unit', 'user');

const FIELDS = [
  { fieldKey: 'email', name: '邮箱', fieldType: 'email' },
  { fieldKey: 'name', name: '姓名', fieldType: 'text' },
  { fieldKey: 'city', name: '城市', fieldType: 'text' },
];

type Row = Record<string, unknown>;

function setup(
  options: {
    rows?: Row[];
    rowCount?: number;
    lists?: DmReceiver[];
    contacts?: string[];
  } = {},
) {
  const rows = options.rows ?? [];
  const lists = options.lists ?? [];
  const contacts = options.contacts ?? [];
  const prisma = {
    aliyunMailSetting: {
      findUnique: jest.fn().mockResolvedValue({
        userId: user.userId,
        accessKeyId: 'LTAI5tUnitTestKey',
        accessKeySecretCipher: 'iv:tag:payload',
        region: 'cn-hangzhou',
        defaultReceiverId: '',
        defaultReceiverName: '',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    },
    aliyunMailContact: {
      findMany: jest.fn(async () =>
        contacts.map((emailHash) => ({ emailHash })),
      ),
    },
  };
  const identity = { audit: jest.fn().mockResolvedValue(undefined) };
  const crypto = {
    encrypt: (value: string) => `enc(${value})`,
    decrypt: () => 'unit-test-secret',
  };
  const dataTable = {
    get: jest.fn().mockResolvedValue({
      id: 7,
      name: '单元测试表',
      owner: true,
      fields: FIELDS,
      rowCount: options.rowCount ?? rows.length,
    }),
    listRowsByOffset: jest.fn(
      async (
        _user: CurrentUser,
        _tableId: number,
        size: number,
        offset: number,
      ) =>
        offset === 0
          ? rows.slice(0, size).map((data, index) => ({ id: index + 1, data }))
          : [],
    ),
  };
  const service = new AliyunMailService(
    stub<PrismaService>(prisma),
    stub<IdentityService>(identity),
    stub<AliyunMailCrypto>(crypto),
    stub<DataTableService>(dataTable),
  );
  const listsMock = jest
    .spyOn(DirectMailClient.prototype, 'listReceivers')
    .mockResolvedValue(lists);
  return { service, prisma, dataTable, listsMock };
}

function newBody(
  mapping: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    tableId: 7,
    mode: 'new',
    receiverName: '单元测试列表',
    receiverAlias: 'unit@example.com',
    mapping,
    ...extra,
  };
}

const mapping = {
  emailFieldKey: 'email',
  variables: [{ key: 'UserName', fieldKey: 'name' }],
};

afterEach(() => jest.restoreAllMocks());

describe('邮箱口径', () => {
  it('全角转半角、trim、小写后判格式', () => {
    expect(emailOf('  ＡＢＣ＠ＥＸＡＭＰＬＥ．ＣＯＭ ')).toEqual({
      email: 'abc@example.com',
      message: '',
    });
    expect(emailOf('a b@example.com').email).toBe('');
    expect(emailOf('a b@example.com').message).toBe('邮箱格式不正确');
    expect(emailOf('')).toEqual({ email: '', message: '邮箱为空' });
  });

  it('打码只保留前两位与域名', () => {
    expect(maskEmail('abcd@example.com')).toBe('ab****@example.com');
    expect(maskEmail('a@example.com')).toBe('a****@example.com');
    expect(maskEmail('')).toBe('');
  });

  it('哈希是稳定的 64 位十六进制', () => {
    expect(hashEmail('a@example.com')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail('a@example.com')).toBe(hashEmail('a@example.com'));
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });

  it('表 ID 必须是正整数', () => {
    expect(requirePositiveId('12', '请选择多维表格')).toBe(12);
    expect(() => requirePositiveId(0, '请选择多维表格')).toThrow(
      '请选择多维表格',
    );
  });
});

describe('预览：行状态与容量', () => {
  it('按有效 / 重复 / 无效统计，并给出打码与变量取值', async () => {
    const { service } = setup({
      rows: [
        { email: 'A@Example.com', name: '张三', city: '杭州' },
        { email: 'a@example.com', name: '重复', city: '杭州' },
        { email: 'not-an-email', name: '坏地址', city: '北京' },
        { email: '', name: '空邮箱', city: '广州' },
        { email: 'b@example.com', name: '李四', city: '上海' },
      ],
    });
    const preview = await service.preview(user, newBody(mapping));
    expect(preview).toMatchObject({
      totalRows: 5,
      validRows: 2,
      duplicateRows: 1,
      invalidRows: 2,
      existingRows: 0,
      overflowRows: 0,
      currentCount: 0,
      capacity: 10000,
      errors: [],
    });
    expect(preview.sample[0]).toMatchObject({
      emailMasked: 'a****@example.com',
      variables: [{ key: 'UserName', value: '张三' }],
      status: 'ok',
    });
    expect(preview.sample[1].message).toContain('表内重复');
    expect(preview.sample[2].message).toBe('邮箱格式不正确');
    expect(preview.sample[3].message).toBe('邮箱为空');
  });

  it('缺省变量单元格不写入 CustomData（不产生空字符串变量）', async () => {
    const { service } = setup({
      rows: [{ email: 'a@example.com', city: '杭州' }],
    });
    const preview = await service.preview(user, newBody(mapping));
    expect(preview.sample[0].variables).toEqual([]);
  });

  it('标准变量超长与 CustomData 超 6k 都算无效行，不静默截断', async () => {
    const long = setup({
      rows: [{ email: 'a@example.com', name: '名'.repeat(76) }],
    });
    const longPreview = await long.service.preview(user, newBody(mapping));
    expect(longPreview.invalidRows).toBe(1);
    expect(longPreview.sample[0].message).toBe('变量 UserName 超过 75 个字符');

    const huge = setup({
      rows: [{ email: 'b@example.com', name: 'x'.repeat(6000) }],
    });
    const hugePreview = await huge.service.preview(
      user,
      newBody({
        emailFieldKey: 'email',
        variables: [{ key: 'Note', fieldKey: 'name' }],
      }),
    );
    expect(hugePreview.invalidRows).toBe(1);
    expect(hugePreview.sample[0].message).toBe('模板变量内容超过 6000 字节');
  });

  it('追加模式用台账跳过已推送邮箱，并回读列表当前人数', async () => {
    const { service } = setup({
      rows: [
        { email: 'a@example.com', name: '已有' },
        { email: 'b@example.com', name: '新增' },
      ],
      lists: [
        {
          receiverId: 'r1',
          receiverName: '已有列表',
          receiverAlias: 'list@example.com',
          count: 10,
          createTime: '',
        },
      ],
      contacts: [hashEmail('a@example.com')],
    });
    const preview = await service.preview(user, {
      tableId: 7,
      mode: 'append',
      receiverId: 'r1',
      mapping,
    });
    expect(preview).toMatchObject({
      validRows: 1,
      existingRows: 1,
      currentCount: 10,
      errors: [],
    });
    expect(preview.sample[0].message).toBe('该列表已推送过该邮箱，已跳过');
  });

  it('按列表剩余容量截断；已满时报阻断错误', async () => {
    const rows = [
      { email: 'a@example.com', name: 'A' },
      { email: 'b@example.com', name: 'B' },
    ];
    const nearlyFull = setup({
      rows,
      lists: [
        {
          receiverId: 'r1',
          receiverName: '快满',
          receiverAlias: 'list@example.com',
          count: 9999,
          createTime: '',
        },
      ],
    });
    const partial = await nearlyFull.service.preview(user, {
      tableId: 7,
      mode: 'append',
      receiverId: 'r1',
      mapping,
    });
    expect(partial).toMatchObject({
      validRows: 1,
      overflowRows: 1,
      currentCount: 9999,
      errors: [],
    });

    const full = setup({
      rows,
      lists: [
        {
          receiverId: 'r1',
          receiverName: '已满',
          receiverAlias: 'list@example.com',
          count: 10000,
          createTime: '',
        },
      ],
    });
    const blocked = await full.service.preview(user, {
      tableId: 7,
      mode: 'append',
      receiverId: 'r1',
      mapping,
    });
    expect(blocked).toMatchObject({ validRows: 0, overflowRows: 2 });
    expect(blocked.errors).toEqual([
      '该列表已有 10000 人，达到 10000 上限，请新建一个收件人列表',
    ]);
  });

  it('全部行都被台账跳过时报「没有可同步的邮箱」', async () => {
    const { service } = setup({
      rows: [
        { email: 'a@example.com', name: 'A' },
        { email: 'b@example.com', name: 'B' },
      ],
      lists: [
        {
          receiverId: 'r1',
          receiverName: '已有列表',
          receiverAlias: 'list@example.com',
          count: 2,
          createTime: '',
        },
      ],
      contacts: [hashEmail('a@example.com'), hashEmail('b@example.com')],
    });
    const preview = await service.preview(user, {
      tableId: 7,
      mode: 'append',
      receiverId: 'r1',
      mapping,
    });
    expect(preview).toMatchObject({ validRows: 0, existingRows: 2 });
    expect(preview.errors).toEqual([
      '没有可同步的邮箱（全部为空、重复或已推送过）',
    ]);
  });

  it('超过单次 10000 行上限直接阻断', async () => {
    const { service } = setup({ rows: [], rowCount: 10001 });
    const preview = await service.preview(user, newBody(mapping));
    expect(preview.errors).toEqual([
      '名单共 10001 行，超过单次 10000 行上限，请先在多维表格里筛选或拆分后再同步',
    ]);
  });
});

describe('映射校验', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['未选邮箱列', { emailFieldKey: '', variables: [] }, '请选择邮箱列'],
    [
      '邮箱列不属于这张表',
      { emailFieldKey: 'not_exists', variables: [] },
      '邮箱列不属于这张表，请刷新后重选',
    ],
    [
      '变量名只能是英文字母',
      {
        emailFieldKey: 'email',
        variables: [{ key: 'User1', fieldKey: 'name' }],
      },
      '模板变量名「User1」不合法（只能用英文字母，如 UserName）',
    ],
    [
      '变量名不允许重复',
      {
        emailFieldKey: 'email',
        variables: [
          { key: 'UserName', fieldKey: 'name' },
          { key: 'UserName', fieldKey: 'city' },
        ],
      },
      '模板变量名「UserName」重复',
    ],
    [
      '变量来源列必须属于这张表',
      {
        emailFieldKey: 'email',
        variables: [{ key: 'City', fieldKey: 'not_exists' }],
      },
      '变量 City 的来源列不属于这张表，请刷新后重选',
    ],
    [
      '变量最多 50 个',
      {
        emailFieldKey: 'email',
        variables: Array.from({ length: 51 }, (_, index) => ({
          key: `V${index}`,
          fieldKey: 'name',
        })),
      },
      '模板变量最多 50 个',
    ],
  ];

  it.each(cases)('%s', async (_name, badMapping, message) => {
    const { service } = setup({ rows: [{ email: 'a@example.com' }] });
    const error = await service
      .preview(user, newBody(badMapping))
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).message).toBe(message);
    expect((error as BusinessException).getStatus()).toBe(400);
  });

  it('新建模式必须填列表名与合法别称', async () => {
    const { service } = setup({ rows: [{ email: 'a@example.com' }] });
    await expect(
      service.preview(user, newBody(mapping, { receiverName: '' })),
    ).rejects.toThrow('请填写收件人列表名称（1–30 个字符）');
    await expect(
      service.preview(
        user,
        newBody(mapping, { receiverAlias: 'not-an-email' }),
      ),
    ).rejects.toThrow('列表别称必须是邮箱地址且不超过 30 个字符');
  });

  it('列表已满 10 个时不允许再新建', async () => {
    const lists: DmReceiver[] = Array.from({ length: 10 }, (_, index) => ({
      receiverId: `r${index}`,
      receiverName: `列表${index}`,
      receiverAlias: `l${index}@example.com`,
      count: 0,
      createTime: '',
    }));
    const { service } = setup({ rows: [{ email: 'a@example.com' }], lists });
    await expect(service.preview(user, newBody(mapping))).rejects.toThrow(
      '账号下收件人列表已达 10 个上限，请先在阿里云控制台删除不用的列表',
    );
  });
});

describe('上游错误桥接', () => {
  it('错 Key 只回中文提示，不带上游错误码', async () => {
    const { service } = setup();
    const upstream = new DirectMailError(
      'InvalidAccessKeyId.NotFound',
      'Specified access key is not found.',
    );
    const listMock = jest
      .spyOn(DirectMailClient.prototype, 'listReceivers')
      .mockRejectedValue(upstream);
    const error = await service
      .receiverLists(user, '')
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getStatus()).toBe(503);
    expect((error as BusinessException).message).toBe(
      '阿里云 AccessKey 不正确或已失效，请到「邮件设置」重新保存',
    );
    expect((error as BusinessException).message).not.toContain(
      'InvalidAccessKeyId',
    );

    const result = await service.test(user);
    expect(result).toEqual({
      ok: false,
      receiverCount: 0,
      messages: ['阿里云 AccessKey 不正确或已失效，请到「邮件设置」重新保存'],
    });
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('测试连通在列表为空时给出新建引导', async () => {
    const { service } = setup({ lists: [] });
    expect(await service.test(user)).toEqual({
      ok: true,
      receiverCount: 0,
      messages: ['当前账号下还没有收件人列表，可在「同步名单」里新建'],
    });
  });
});

describe('500 条切批', () => {
  it('按 500 一段，末段保留余数', () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({
      id: index + 1,
    }));
    expect(chunkRows(rows).map((chunk) => chunk.length)).toEqual([
      500, 500, 201,
    ]);
    expect(chunkRows([])).toEqual([]);
    expect(chunkRows([{ id: 1 }]).map((chunk) => chunk.length)).toEqual([1]);
  });
});
