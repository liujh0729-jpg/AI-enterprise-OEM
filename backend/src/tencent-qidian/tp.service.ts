import {
  TP_ACTION_LABELS,
  TP_DATASET_LABELS,
  TP_PRODUCT_LABELS,
  TP_STATUS_LABELS,
  tpProducts,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { runInRequestContext } from '../common/request-context';
import { CrmReportService } from '../crm/crm.report.service';
import { DataTableService } from '../data-table/data-table.service';
import { buildDeliverableCsv, type DeliverableSink } from '../content/deliverable';
import { IdentityService } from '../identity/identity.service';
import { NotificationService } from '../notifications/notification.service';
import { TransportError } from '../http/transport';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  isTaskRecordDone,
  QidianClient,
  QidianError,
  TP_PATHS,
  TP_PROBE_PATHS,
  type QidianCreds,
} from './qidian.client';
import { TencentQidianCrypto } from './tp-crypto';

type Row = Record<string, unknown>;
/** 一行名单：来源行的标识（表格行ID 或分群里的序号）＋按映射投影出的报文。 */
type TpEntry = { rowId: number; entry: Row };
/** 凭据只有六个产品；融合分析（FA）挂在 CDP 的网关与凭据上。 */
type CredProduct = (typeof tpProducts)[number];

/** 单次批量动作的名单上限：发券、发积分、群发、RTA 上传、写 CRM 共用这一个闸。 */
export const TP_MAX_ROWS = 10_000;
/** 逐次提交给企点的行批量。 */
const UPSTREAM_BATCH = 200;
/** 写入本系统 CRM 的单批上限（与 CRM 自己的导入服务一致）。 */
const CRM_BATCH = 500;
/** 多维表格单次批量写行的上限（与表格服务一致）。 */
const TABLE_ROW_BATCH = 200;
/** 异步任务的最长轮询：10 分钟还没结束就留给「刷新」和调度器。 */
const POLL_ROUNDS = 20;
const POLL_INTERVAL_MS = 30_000;
const DEFAULT_GATEWAY = 'https://tmc.qidian.qq.com';

const WRITE_BACK_FIELDS = [
  { fieldKey: 'tp_task_id', name: '企点任务' },
  { fieldKey: 'tp_submit_status', name: '企点提交状态' },
  { fieldKey: 'tp_error', name: '企点失败原因' },
];

/** 花钱或真实触达的动作：执行前必须二次确认，界面先显示名单人数与预估消耗。 */
const COST_GATED = new Set([
  'Tp_lmIssuePoints',
  'Tp_lmCouponIssue',
  'Tp_scrmSaveMassTask',
  'Tp_maMassSend',
  'Tp_rtaUploadAudience',
  'Tp_crmImport',
]);

/** 本系统的控制字段：不透传给企点。 */
const CONTROL_KEYS = [
  'accountId',
  'tableId',
  'tableName',
  'mapping',
  'confirmCost',
  'payload',
  'writeBack',
];

/** 名单行进入企点批量报文的键名；逐篇文档写法不一致，联调时只改这一处。 */
const UPSTREAM_LIST_KEY = 'dataList';
/** 企点异步任务ID在响应里的候选键名（同上，联调核对）。 */
const UPSTREAM_TASK_ID_KEYS = ['taskId', 'taskInstanceId', 'jobId', 'id'];

/** 只读清单接口登记表：产品凭据、上游路径、请求方式、路径 ID 的参数名。 */
const TP_READ_CALLS = {
  Tp_cdpProperties: {
    product: 'CDP',
    path: TP_PATHS.cdpPropertyList,
    method: 'GET',
  },
  Tp_cdpCustomerDetail: {
    product: 'CDP',
    path: TP_PATHS.cdpPropertyDetail,
    method: 'POST',
  },
  Tp_cdpCustomerTrace: {
    product: 'CDP',
    path: TP_PATHS.cdpBehaviorTrace,
    method: 'POST',
  },
  Tp_cdpCustomerTags: {
    product: 'CDP',
    path: TP_PATHS.cdpUserTags,
    method: 'POST',
  },
  Tp_cdpSegments: {
    product: 'CDP',
    path: TP_PATHS.cdpCrowdList,
    method: 'GET',
  },
  Tp_cdpSegmentDetail: {
    product: 'CDP',
    path: TP_PATHS.cdpCrowdDetail,
    method: 'GET',
    idKey: 'crowdId',
  },
  Tp_faBoards: { product: 'CDP', path: TP_PATHS.faPanels, method: 'GET' },
  Tp_faCards: {
    product: 'CDP',
    path: TP_PATHS.faCards,
    method: 'GET',
    idKey: 'boardId',
  },
  Tp_faCardResult: {
    product: 'CDP',
    path: TP_PATHS.faAnalysisQuery,
    method: 'POST',
  },
  Tp_faAsyncResult: {
    product: 'CDP',
    path: TP_PATHS.faAsyncResult,
    method: 'POST',
  },
  Tp_scrmCodes: { product: 'SCRM', path: TP_PATHS.scrmCodeList, method: 'GET' },
  Tp_scrmOrgs: { product: 'SCRM', path: TP_PATHS.scrmOrgList, method: 'POST' },
  Tp_scrmMassTasks: {
    product: 'SCRM',
    path: TP_PATHS.scrmMassList,
    method: 'GET',
  },
  Tp_scrmMassTaskStats: {
    product: 'SCRM',
    path: TP_PATHS.scrmMassStats,
    method: 'POST',
  },
  Tp_scrmMassTaskExecution: {
    product: 'SCRM',
    path: TP_PATHS.scrmMassExecution,
    method: 'POST',
  },
  Tp_scrmFollowups: {
    product: 'SCRM',
    path: TP_PATHS.scrmFollowupList,
    method: 'GET',
  },
  Tp_scrmFollowupCustomers: {
    product: 'SCRM',
    path: TP_PATHS.scrmFollowupCustomers,
    method: 'POST',
  },
  Tp_caMessages: {
    product: 'CA',
    path: TP_PATHS.caMessageList,
    method: 'POST',
  },
  Tp_caTagTasks: { product: 'CA', path: TP_PATHS.caTagTaskList, method: 'GET' },
  Tp_caTagDetail: {
    product: 'CA',
    path: TP_PATHS.caTagTaskDetail,
    method: 'GET',
    idKey: 'taskId',
  },
  Tp_caResponseStats: {
    product: 'CA',
    path: TP_PATHS.caResponseDuration,
    method: 'GET',
  },
  Tp_lmPrograms: { product: 'LM', path: TP_PATHS.lmProgramList, method: 'GET' },
  Tp_lmMembers: { product: 'LM', path: TP_PATHS.lmMemberList, method: 'POST' },
  Tp_lmPoints: { product: 'LM', path: TP_PATHS.lmPointRecord, method: 'POST' },
  Tp_lmCoupons: { product: 'LM', path: TP_PATHS.lmCouponList, method: 'GET' },
  Tp_maChannels: {
    product: 'MA',
    path: TP_PATHS.maSmsChannels,
    method: 'GET',
    pathByType: {
      sms: TP_PATHS.maSmsChannels,
      email: TP_PATHS.maEmailChannels,
    },
  },
  Tp_maSenders: { product: 'MA', path: TP_PATHS.maEmailSenders, method: 'GET' },
  Tp_maTemplates: {
    product: 'MA',
    path: TP_PATHS.maSmsTemplates,
    method: 'GET',
    pathByType: {
      sms: TP_PATHS.maSmsTemplates,
      email: TP_PATHS.maEmailTemplates,
    },
  },
  Tp_maShortLinks: { product: 'MA', path: TP_PATHS.maLinkList, method: 'GET' },
} satisfies Record<string, TpCall>;

/** 登记表里的键即支持的只读动作：动作名写错在编译期就会报错。 */
type ReadOp = keyof typeof TP_READ_CALLS;

type TpCall = {
  product: CredProduct;
  path: string;
  method: 'GET' | 'POST';
  /** 契约路径里的 `:id` 传给企点时用的参数名 */
  idKey?: string;
  /** 按 query/body 里的 `type` 在两条上游路径间切换（营销自动化的短信与邮件） */
  pathByType?: { sms: string; email: string };
};

/** 单对象写动作：路径由请求里的 ID / 类型决定，报文是用户填写的上游字段。 */
const TP_WRITE_CALLS = {
  Tp_cdpCreateTag: {
    product: 'CDP',
    build: () => ({ path: TP_PATHS.cdpTagCreate }),
  },
  Tp_scrmSaveCode: {
    product: 'SCRM',
    build: (body) => ({
      path: text(body.codeId).trim()
        ? TP_PATHS.scrmCodeUpdate
        : TP_PATHS.scrmCodeCreate,
    }),
  },
  Tp_scrmDeleteCode: {
    product: 'SCRM',
    build: () => ({ path: TP_PATHS.scrmCodeDelete }),
  },
  Tp_scrmWelcome: {
    product: 'SCRM',
    build: () => ({ path: TP_PATHS.scrmWelcome }),
  },
  Tp_scrmSaveMassTask: {
    product: 'SCRM',
    cost: true,
    build: (body) => ({
      path: text(body.taskId).trim()
        ? TP_PATHS.scrmMassUpdate
        : TP_PATHS.scrmMassCreate,
    }),
  },
  Tp_scrmControlMassTask: {
    product: 'SCRM',
    build: (body) => ({
      path:
        text(body.op).trim() === 'remind'
          ? TP_PATHS.scrmMassRemind
          : TP_PATHS.scrmMassStop,
      payload: { taskId: text(body.taskId).trim() },
    }),
  },
  Tp_scrmFollowupDone: {
    product: 'SCRM',
    build: (body) => ({
      path: TP_PATHS.scrmFollowupDone,
      payload: {
        taskId: text(body.taskId).trim(),
        customerId: text(body.customerId).trim(),
        staffId: text(body.staffId).trim(),
      },
    }),
  },
  Tp_lmSaveMember: {
    product: 'LM',
    build: (body) => ({
      path: text(body.memberId).trim()
        ? TP_PATHS.lmMemberUpdate
        : TP_PATHS.lmMemberCreate,
    }),
  },
  Tp_lmMemberStatus: {
    product: 'LM',
    build: (body) => ({
      path:
        text(body.op).trim() === 'inactivate'
          ? TP_PATHS.lmMemberInactivate
          : TP_PATHS.lmMemberActivate,
      payload: { memberId: text(body.memberId).trim() },
    }),
  },
  Tp_maCreateTemplate: {
    product: 'MA',
    build: (body) => ({
      path:
        text(body.type).trim() === 'email'
          ? TP_PATHS.maEmailTemplateCreate
          : TP_PATHS.maSmsTemplateCreate,
    }),
  },
  Tp_maSaveShortLink: {
    product: 'MA',
    build: (body) => ({
      path: text(body.uniqueId).trim()
        ? TP_PATHS.maLinkUpdate
        : TP_PATHS.maLinkCreate,
    }),
  },
  Tp_maDeleteShortLink: {
    product: 'MA',
    build: (body) => ({
      path: TP_PATHS.maLinkDelete,
      payload: { uniqueId: text(body.uniqueId).trim() },
    }),
  },
} satisfies Record<string, TpWriteCall>;

/** 登记表里的键即支持的单对象写动作。 */
type WriteOp = keyof typeof TP_WRITE_CALLS;

type TpWriteCall = {
  product: CredProduct;
  cost?: boolean;
  build: (body: Row) => { path: string; payload?: Row };
};

/** 名单表驱动的批量动作：读多维表格 → 按映射成行 → 分批提交企点。 */
const TP_BATCH_CALLS = {
  Tp_cdpImportCustomers: {
    product: 'CDP',
    dataset: 'cdp_customer_import',
    label: '客户写入名单',
    build: (body) => ({
      path:
        text(body.mode).trim() === 'update'
          ? TP_PATHS.cdpCustomerUpdate
          : TP_PATHS.cdpCustomerCreate,
      extra: {},
    }),
  },
  Tp_cdpApplyTags: {
    product: 'CDP',
    dataset: 'cdp_tag_apply',
    label: '打标名单',
    build: (body) => ({
      path: TP_PATHS.cdpTagOperate,
      extra: {
        tagId: text(body.tagId).trim(),
        entityKey: text(body.entityKey).trim() || 'oneid',
        opType: text(body.opType).trim() === 'remove' ? 'remove' : 'add',
      },
    }),
  },
  Tp_cdpCreateSegment: {
    product: 'CDP',
    dataset: 'cdp_segment_create',
    label: '分群名单',
    poll: true,
    build: (body) => ({
      path: TP_PATHS.cdpCrowdImport,
      extra: {
        crowdName: text(body.crowdName).trim(),
        identityId: text(body.identityId).trim(),
      },
    }),
  },
  Tp_lmIssuePoints: {
    product: 'LM',
    dataset: 'lm_point_issue',
    label: '积分发放名单',
    build: (body) => ({
      path: TP_PATHS.lmPointGrant,
      extra: {
        programId: text(body.programId).trim(),
        point: Number(body.point) || 0,
        eventName: text(body.eventName).trim() || '本系统发放',
      },
    }),
  },
  Tp_lmCouponIssue: {
    product: 'LM',
    dataset: 'lm_coupon_issue',
    label: '优惠券发放名单',
    build: (body) => ({
      path: TP_PATHS.lmCouponSend,
      extra: { couponId: text(body.couponId).trim() },
    }),
  },
  Tp_maMassSend: {
    product: 'MA',
    dataset: 'ma_mass_send',
    label: '群发名单',
    poll: true,
    build: (body) => ({
      path: TP_PATHS.maMassCreate,
      extra: {
        channelType: text(body.channelType).trim(),
        templateId: text(body.templateId).trim(),
        name: text(body.name).trim(),
      },
    }),
  },
  Tp_rtaUploadAudience: {
    product: 'RTA',
    dataset: 'rta_audience_upload',
    label: 'RTA人群名单',
    poll: true,
    build: (body) => ({
      path: TP_PATHS.rtaCrowdImport,
      extra: {
        crowdName: text(body.crowdName).trim(),
        dataType: text(body.dataType).trim() || 'mobile',
        ...(text(body.advertiserId).trim()
          ? { advertiserId: text(body.advertiserId).trim() }
          : {}),
      },
    }),
  },
} satisfies Record<string, TpBatchCall>;

/** 登记表里的键即支持的名单批量动作。 */
type BatchOp = keyof typeof TP_BATCH_CALLS;

type TpBatchCall = {
  product: CredProduct;
  dataset: string;
  /** 缺映射时界面提示里说的「名单」 */
  label: string;
  poll?: boolean;
  build: (body: Row) => { path: string; extra: Row };
};

const logger = new Logger('TencentQidianService');

/** 后台执行时用到的任务台账列（批量与导出共用一个形状，不再两处各自描述）。 */
type TaskRef = {
  id: number;
  userId: string;
  accountId: number;
  product: string;
  action: string;
  tableId: number;
  tableName: string;
  status: string;
  upstreamTaskId: string;
  totalRows: number;
  mappingJson: Prisma.JsonValue;
  params: Prisma.JsonValue;
};

/**
 * 腾讯企点营销云：凭据按登录账号归属，一个产品一套；
 * 清单类只读收口在一张登记表，写类动作按是否花钱分别走「同步返回」与「任务台账」。
 */
export class TencentQidianService {
  /** 产物登记通道（services.ts 装配）：分群导出结果 CSV 存自有 OSS 并入数字资产。 */
  deliverableSink?: DeliverableSink;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationService,
    private readonly crypto: TencentQidianCrypto,
    private readonly dataTable: DataTableService,
    private readonly crm: CrmReportService,
  ) {}

  // ---------- 凭据 ----------

  async accounts(user: CurrentUser) {
    const rows = await this.prisma.tpAccount.findMany({
      where: { userId: user.userId },
      orderBy: [{ product: 'asc' }, { id: 'asc' }],
    });
    return rows.map(accountView);
  }

  async saveAccount(user: CurrentUser, body: Row) {
    const id = Number(body.id) || 0;
    const product = text(body.product).trim();
    if (!(tpProducts as readonly string[]).includes(product)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择企点产品（客户数据平台 / 企微互动 / 会话分析 / 会员忠诚度 / 营销自动化 / 广告人群）',
      );
    }
    const corporationId = text(body.corporationId).trim();
    const bizId = text(body.bizId).trim();
    if (!corporationId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写企业ID');
    }
    if (!bizId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写空间ID（bizId），它决定能看到哪些数据',
      );
    }
    const gateway = text(body.gateway).trim() || DEFAULT_GATEWAY;
    if (!/^https?:\/\/[^\s]+$/.test(gateway)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企点网关地址不完整，请填形如 https://tmc.qidian.qq.com 的地址',
      );
    }
    const status =
      text(body.status).trim() === 'disabled' ? 'disabled' : 'active';
    const current = id
      ? await this.prisma.tpAccount.findFirst({
          where: { id, userId: user.userId },
        })
      : null;
    if (id && !current) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '企点凭据不存在或不属于当前账号',
      );
    }
    const secretInput = text(body.secretKey).trim();
    if (secretInput && (secretInput.length < 8 || secretInput.length > 256)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'secretKey 长度不正确，请原样复制控制台上的密钥',
      );
    }
    const secretKeyCipher = secretInput
      ? this.crypto.encrypt(secretInput)
      : current?.secretKeyCipher || '';
    if (!secretKeyCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 secretKey（已保存过可留空表示不修改）',
      );
    }
    const duplicated = await this.prisma.tpAccount.findFirst({
      where: {
        userId: user.userId,
        product,
        corporationId,
        bizId,
        NOT: id ? { id } : undefined,
      },
    });
    if (duplicated) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `该产品下这套「企业ID + 空间ID」已配置过（${duplicated.label || duplicated.id}），请直接修改那条`,
      );
    }
    const data = {
      userId: user.userId,
      product,
      label: text(body.label).trim().slice(0, 191),
      gateway,
      corporationId,
      secretId: text(body.secretId).trim().slice(0, 128),
      secretKeyCipher,
      bizId,
      status,
    };
    const row = current
      ? await this.prisma.tpAccount.update({ where: { id: current.id }, data })
      : await this.prisma.tpAccount.create({ data });
    await this.identity.audit(
      user.userId,
      current ? '修改企点凭据' : '新增企点凭据',
      `${TP_PRODUCT_LABELS[product] || product} · 企业ID ${corporationId} · 空间ID ${bizId}`,
    );
    return accountView(row);
  }

  async deleteAccount(user: CurrentUser, id: string) {
    const row = await this.prisma.tpAccount.findFirst({
      where: { id: positiveId(id, '企点凭据'), userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '企点凭据不存在或不属于当前账号',
      );
    }
    await this.prisma.tpAccount.delete({ where: { id: row.id } });
    await this.identity.audit(
      user.userId,
      '删除企点凭据',
      `${TP_PRODUCT_LABELS[row.product] || row.product} · ${row.label || row.corporationId}`,
    );
    return { id: row.id, deleted: true };
  }

  /** 连接测试：只调该产品的一个只读清单接口，结果写回凭据的 lastVerifiedAt/lastError。 */
  async testAccount(user: CurrentUser, id: string) {
    const account = await this.prisma.tpAccount.findFirst({
      where: { id: positiveId(id, '企点凭据'), userId: user.userId },
    });
    if (!account) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '企点凭据不存在或不属于当前账号',
      );
    }
    const probe = TP_PROBE_PATHS[account.product] || TP_PATHS.cdpPropertyList;
    const startedAt = Date.now();
    try {
      const client = this.clientOf(account);
      const result = await client.rows('GET', probe, { page: 1, pageSize: 1 });
      const message = result.rows.length
        ? `连接成功，读到 ${result.total || result.rows.length} 条数据`
        : '连接成功，该空间下暂时没有数据';
      await this.prisma.tpAccount.update({
        where: { id: account.id },
        data: { lastVerifiedAt: new Date(), lastError: '' },
      });
      await this.identity.audit(user.userId, '测试企点连接', message);
      return {
        ok: true,
        message,
        probe,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = this.mapError(error);
      await this.prisma.tpAccount
        .update({
          where: { id: account.id },
          data: {
            lastVerifiedAt: new Date(),
            lastError: message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      logger.warn({
        accountId: account.id,
        kind: 'probe-failed',
        error: this.errorInfo(error),
      });
      return {
        ok: false,
        message,
        probe,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  // ---------- 只读清单与详情 ----------

  cdpProperties(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_cdpProperties', query);
  }
  cdpCustomerDetail(user: CurrentUser, body: Row) {
    return this.readObject(user, 'Tp_cdpCustomerDetail', body);
  }
  cdpCustomerTrace(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_cdpCustomerTrace', body);
  }
  cdpCustomerTags(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_cdpCustomerTags', body);
  }
  cdpSegments(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_cdpSegments', query);
  }
  cdpSegmentDetail(user: CurrentUser, id: string, query: Row) {
    return this.readObject(user, 'Tp_cdpSegmentDetail', query, id);
  }
  async cdpTaskRecord(user: CurrentUser, taskId: string, query: Row) {
    const { client } = await this.clientFor(user, accountIdOf(query), 'CDP');
    return this.guard(() => client.taskRecord(taskId), 'cdp-task-record');
  }
  faBoards(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_faBoards', query);
  }
  faCards(user: CurrentUser, id: string, query: Row) {
    return this.readRows(user, 'Tp_faCards', query, id);
  }
  faCardResult(user: CurrentUser, body: Row) {
    return this.readObject(user, 'Tp_faCardResult', body);
  }
  faAsyncResult(user: CurrentUser, body: Row) {
    return this.readObject(user, 'Tp_faAsyncResult', body);
  }
  scrmCodes(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_scrmCodes', query);
  }
  scrmOrgs(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_scrmOrgs', body);
  }
  scrmMassTasks(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_scrmMassTasks', query);
  }
  scrmMassTaskStats(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_scrmMassTaskStats', body);
  }
  scrmMassTaskExecution(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_scrmMassTaskExecution', body);
  }
  scrmFollowups(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_scrmFollowups', query);
  }
  scrmFollowupCustomers(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_scrmFollowupCustomers', body);
  }
  caMessages(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_caMessages', body);
  }
  caTagTasks(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_caTagTasks', query);
  }
  caTagDetail(user: CurrentUser, id: string, query: Row) {
    return this.readRows(user, 'Tp_caTagDetail', query, id);
  }
  caResponseStats(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_caResponseStats', query);
  }
  lmPrograms(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_lmPrograms', query);
  }
  lmMembers(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_lmMembers', body);
  }
  lmPoints(user: CurrentUser, body: Row) {
    return this.readRows(user, 'Tp_lmPoints', body);
  }
  lmCoupons(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_lmCoupons', query);
  }
  maChannels(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_maChannels', query);
  }
  maSenders(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_maSenders', query);
  }
  maTemplates(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_maTemplates', query);
  }
  maShortLinks(user: CurrentUser, query: Row) {
    return this.readRows(user, 'Tp_maShortLinks', query);
  }

  // ---------- 单对象写动作 ----------

  cdpCreateTag(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_cdpCreateTag', body);
  }
  scrmSaveCode(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmSaveCode', body);
  }
  scrmDeleteCode(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmDeleteCode', body);
  }
  scrmWelcome(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmWelcome', body);
  }
  scrmSaveMassTask(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmSaveMassTask', body);
  }
  scrmControlMassTask(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmControlMassTask', body);
  }
  scrmFollowupDone(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_scrmFollowupDone', body);
  }
  lmSaveMember(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_lmSaveMember', body);
  }
  lmMemberStatus(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_lmMemberStatus', body);
  }
  maCreateTemplate(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_maCreateTemplate', body);
  }
  maSaveShortLink(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_maSaveShortLink', body);
  }
  maDeleteShortLink(user: CurrentUser, body: Row) {
    return this.writeObject(user, 'Tp_maDeleteShortLink', body);
  }

  // ---------- 名单表驱动的批量动作 ----------

  cdpImportCustomers(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_cdpImportCustomers', body);
  }
  cdpApplyTags(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_cdpApplyTags', body);
  }
  cdpCreateSegment(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_cdpCreateSegment', body);
  }
  lmIssuePoints(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_lmIssuePoints', body);
  }
  lmCouponIssue(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_lmCouponIssue', body);
  }
  maMassSend(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_maMassSend', body);
  }
  rtaUploadAudience(user: CurrentUser, body: Row) {
    return this.submitBatch(user, 'Tp_rtaUploadAudience', body);
  }

  /** 分群成员导出：结果落在哪张表由用户选，没有表就只留任务台账。 */
  async cdpExportSegment(user: CurrentUser, id: string, body: Row) {
    const crowdId = text(id).trim();
    if (!crowdId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少分群ID');
    }
    const tableId = optionalId(body.tableId, '结果表');
    const mapping = mapOf(body.mapping);
    if (tableId) {
      await this.dataTable.assertWritable(
        user,
        tableId,
        Object.keys(mapping),
        '分群导出结果表',
      );
    }
    const account = await this.resolveAccount(user, accountIdOf(body), 'CDP');
    const task = await this.prisma.tpTask.create({
      data: {
        userId: user.userId,
        accountId: account.id,
        product: 'CDP',
        action: 'Tp_cdpExportSegment',
        tableId,
        tableName: tableId ? text(body.tableName).trim() : '',
        mappingJson: mapping,
        params: {
          crowdId,
          exportSaKey: text(body.exportSaKey).trim() || 'oneid',
        },
      },
    });
    await this.event(task.id, 'info', `已提交分群导出：${crowdId}`);
    this.launch(task.id);
    return taskView(task);
  }

  /** 企点客户写入本系统 CRM：走 CRM 自己的预检与导入，重名按 CRM 口径跳过。 */
  async crmImport(user: CurrentUser, body: Row) {
    const mapping = mapOf(body.mapping);
    if (!Object.keys(mapping).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先设置 CRM 字段与名单列的对应关系',
      );
    }
    if (!mapping.name) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'CRM 的「客户名称」必须对应一列，否则无法建档',
      );
    }
    const unsupported = Object.keys(mapping).filter(
      (key) => !CRM_IMPORT_FIELDS.includes(key),
    );
    if (unsupported.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `CRM 客户导入只能落这些字段，其余请去掉：${unsupported.join('、')}`,
      );
    }
    const source = text(body.source).trim() || 'data_table';
    const tableId =
      source === 'cdp_segment' ? 0 : positiveId(body.tableId, '名单来源表');
    const entries =
      source === 'cdp_segment'
        ? await this.segmentRows(
            user,
            accountIdOf(body),
            text(body.crowdId).trim(),
            mapping,
          )
        : await this.sourceRows(user, tableId, mapping);
    if (!entries.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '名单里没有可写入 CRM 的行（每行至少要有一列对应「客户名称」）',
      );
    }
    if (entries.length > TP_MAX_ROWS) {
      throw tooManyRows(entries.length);
    }
    assertCostConfirmed('Tp_crmImport', body, entries.length);
    const account =
      source === 'cdp_segment'
        ? await this.resolveAccount(user, accountIdOf(body), 'CDP')
        : null;
    const task = await this.prisma.tpTask.create({
      data: {
        userId: user.userId,
        accountId: account?.id || 0,
        product: 'CRM',
        action: 'Tp_crmImport',
        tableId,
        tableName: text(body.tableName).trim().slice(0, 191),
        mappingJson: mapping,
        params: {
          source,
          crowdId: text(body.crowdId).trim(),
        },
        status: 'RUNNING',
        totalRows: entries.length,
        startedAt: new Date(),
      },
    });
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let batches = 0;
    for (let offset = 0; offset < entries.length; offset += CRM_BATCH) {
      const chunk = entries
        .slice(offset, offset + CRM_BATCH)
        .map((item) => item.entry);
      batches += 1;
      const precheck = await this.crm.precheck(user, {
        module: 'customers',
        rows: chunk,
      });
      failed += precheck.errors.length;
      const valid = precheck.rows as Row[];
      if (!valid.length) continue;
      const committed = await this.crm.importCommit(user, {
        module: 'customers',
        rows: valid,
        skipDuplicates: true,
      });
      created += Number(committed.created) || 0;
      skipped += Number(committed.skipped) || 0;
    }
    const status = failed
      ? created || skipped
        ? 'PARTIAL'
        : 'FAILED'
      : 'SUCCEEDED';
    const message = `写入 CRM：新建 ${created} 条、重名跳过 ${skipped} 条、校验失败 ${failed} 条`;
    await this.prisma.tpTask.update({
      where: { id: task.id },
      data: {
        status,
        successRows: created,
        skippedRows: skipped,
        failedRows: failed,
        errorMessage: failed ? `${failed} 行缺少名称或格式不正确` : '',
        errorCode: failed ? 'ROW_INVALID' : '',
        finishedAt: new Date(),
      },
    });
    await this.event(task.id, failed ? 'warn' : 'info', message);
    await this.rememberMapping(
      user,
      'crm_customer_import',
      tableId,
      task.tableName,
      mapping,
    );
    await this.identity.audit(user.userId, '企点客户写入 CRM', message);
    await this.notifyTask(
      user.userId,
      task.id,
      'Tp_crmImport',
      status,
      message,
    );
    return {
      taskId: task.id,
      total: entries.length,
      created,
      skipped,
      failed,
      batches,
      message,
    };
  }

  // ---------- 任务台账 ----------

  async tasks(user: CurrentUser, query: Row) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 200);
    const [rows, total] = await Promise.all([
      this.prisma.tpTask.findMany({
        where: { userId: user.userId },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tpTask.count({ where: { userId: user.userId } }),
    ]);
    return {
      list: rows.map(taskView),
      total,
      page,
      pageSize,
    };
  }

  /** 详情：仍在执行且上游给了任务ID的，顺手查一次状态（查不到只记日志，不影响返回）。 */
  async taskDetail(user: CurrentUser, id: string) {
    const task = await this.prisma.tpTask.findFirst({
      where: { id: positiveId(id, '企点任务'), userId: user.userId },
      include: {
        events: { orderBy: { id: 'desc' }, take: 100 },
      },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '企点任务不存在');
    }
    if (
      (task.status === 'RUNNING' || task.status === 'PENDING') &&
      task.upstreamTaskId
    ) {
      await this.refreshUpstream(task).catch(() => undefined);
    }
    const fresh = await this.prisma.tpTask.findUnique({
      where: { id: task.id },
    });
    return {
      ...taskView(fresh || task),
      params: asRow(fresh?.params ?? task.params),
      mapping: asRow(fresh?.mappingJson ?? task.mappingJson),
      events: task.events.map((event) => ({
        id: event.id,
        level: event.level,
        message: event.message,
        payload: asRow(event.payload),
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /** 重试＝按台账里的名单与映射重跑一次；仍在执行的任务不允许重复提交（避免二次花钱）。 */
  async retryTask(user: CurrentUser, id: string) {
    const task = await this.prisma.tpTask.findFirst({
      where: { id: positiveId(id, '企点任务'), userId: user.userId },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '企点任务不存在');
    }
    if (task.status === 'PENDING' || task.status === 'RUNNING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务仍在执行中，请等它结束再重试（重复提交会二次消耗额度）',
      );
    }
    if (task.action === 'Tp_crmImport') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '写入 CRM 请在页签里重新发起（每次都要重新做重名校验，后台重跑无法保证不重复建档）',
      );
    }
    await this.prisma.tpTask.update({
      where: { id: task.id },
      data: {
        status: 'PENDING',
        errorCode: '',
        errorMessage: '',
        successRows: 0,
        failedRows: 0,
        skippedRows: 0,
        upstreamTaskId: '',
        startedAt: null,
        finishedAt: null,
      },
    });
    await this.event(task.id, 'info', '已按原名单重新提交');
    this.launch(task.id);
    const fresh = await this.prisma.tpTask.findUnique({
      where: { id: task.id },
    });
    return taskView(fresh || task);
  }

  /**
   * 调度器入口：把进程重启或长时间轮询后留下的任务推一把。
   * 排队超过 1 分钟的重新投入执行；执行中且 2 分钟没有更新的只查一次上游状态。
   */
  async runScheduled(): Promise<number> {
    const now = Date.now();
    const stale = await this.prisma.tpTask.findMany({
      where: {
        OR: [
          {
            status: 'PENDING',
            createdAt: { lt: new Date(now - 60_000) },
          },
          {
            status: 'RUNNING',
            upstreamTaskId: { not: '' },
            updatedAt: { lt: new Date(now - 120_000) },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 20,
    });
    let handled = 0;
    for (const task of stale) {
      if (task.status === 'PENDING') {
        this.launch(task.id);
        handled += 1;
        continue;
      }
      try {
        await this.refreshUpstream(task);
        handled += 1;
      } catch (error) {
        logger.warn({
          taskId: task.id,
          kind: 'scheduled-refresh-failed',
          error: this.errorInfo(error),
        });
      }
    }
    return handled;
  }

  // ---------- 列映射记忆 ----------

  async mappings(user: CurrentUser) {
    const rows = await this.prisma.tpMapping.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => mappingView(row));
  }

  async saveMapping(user: CurrentUser, body: Row) {
    const datasetKey = text(body.datasetKey).trim();
    const tableId = positiveId(body.tableId, '结果表');
    const columnMap = mapOf(body.columnMap);
    const row = await this.upsertMapping(
      user.userId,
      datasetKey,
      tableId,
      text(body.tableName).trim(),
      columnMap,
    );
    return mappingView(row);
  }

  // ---------- 内部：凭据与调用 ----------

  private async prepareRead(
    user: CurrentUser,
    operationId: ReadOp,
    input: Row,
    pathId?: string,
  ) {
    const call = TP_READ_CALLS[operationId];
    const { client } = await this.clientFor(
      user,
      accountIdOf(input),
      call.product,
    );
    return {
      call,
      client,
      params: this.upstreamParams(call, input, pathId),
      path: this.pathOf(call, input),
    };
  }

  private async readRows(
    user: CurrentUser,
    operationId: ReadOp,
    input: Row,
    pathId?: string,
  ) {
    const { call, client, params, path } = await this.prepareRead(
      user,
      operationId,
      input,
      pathId,
    );
    return this.guard(
      () => client.rows(call.method, path, params),
      operationId,
    );
  }

  private async readObject(
    user: CurrentUser,
    operationId: ReadOp,
    input: Row,
    pathId?: string,
  ) {
    const { call, client, params, path } = await this.prepareRead(
      user,
      operationId,
      input,
      pathId,
    );
    return this.guard(
      () => client.object(call.method, path, params),
      operationId,
    );
  }

  /** 除了账号选择，其余查询/请求条件一律原样交给企点（各产品的过滤键名不同）。 */
  private upstreamParams(call: TpCall, input: Row, pathId?: string): Row {
    const params: Row = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'accountId') continue;
      params[key] = value;
    }
    if (pathId !== undefined) {
      params[call.idKey || 'id'] = pathId;
    }
    return params;
  }

  private pathOf(call: TpCall, input: Row): string {
    if (!call.pathByType) return call.path;
    const type = text(input.type).trim();
    return type === 'email' ? call.pathByType.email : call.pathByType.sms;
  }

  private async writeObject(
    user: CurrentUser,
    operationId: WriteOp,
    body: Row,
  ) {
    const call: TpWriteCall = TP_WRITE_CALLS[operationId];
    assertCostConfirmed(operationId, body);
    const { account, client } = await this.clientFor(
      user,
      accountIdOf(body),
      call.product,
    );
    const built = call.build(body);
    const payload = built.payload || upstreamPayload(body);
    if (!Object.keys(payload).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${TP_ACTION_LABELS[operationId] || operationId}缺少要提交给企点的字段`,
      );
    }
    const result = await this.guard(
      () => client.postOnce(built.path, payload),
      operationId,
    );
    await this.identity.audit(
      user.userId,
      TP_ACTION_LABELS[operationId] || operationId,
      `${TP_PRODUCT_LABELS[call.product] || call.product} · 凭据 ${account.label || account.id}`,
    );
    return result;
  }

  private async submitBatch(
    user: CurrentUser,
    operationId: BatchOp,
    body: Row,
  ) {
    const call: TpBatchCall = TP_BATCH_CALLS[operationId];
    const tableId = positiveId(body.tableId, '名单来源表');
    const mapping = mapOf(body.mapping);
    if (!Object.keys(mapping).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请先设置${call.label}的列对应关系（企点字段 ← 表格列）`,
      );
    }
    const entries = await this.sourceRows(user, tableId, mapping);
    if (!entries.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${call.label}里没有有效行（每行至少要填一个对应列）`,
      );
    }
    assertCostConfirmed(operationId, body, entries.length);
    const account = await this.resolveAccount(
      user,
      accountIdOf(body),
      call.product,
    );
    const built = call.build(body);
    const task = await this.prisma.tpTask.create({
      data: {
        userId: user.userId,
        accountId: account.id,
        product: call.product,
        action: operationId,
        tableId,
        tableName: text(body.tableName).trim().slice(0, 191),
        mappingJson: mapping,
        params: {
          upstreamPath: built.path,
          fixed: built.extra,
        } as Prisma.InputJsonValue,
        totalRows: entries.length,
      },
    });
    await this.event(
      task.id,
      'info',
      `已受理 ${entries.length} 行，准备分批提交`,
    );
    this.launch(task.id);
    return taskView(task);
  }

  /** 读名单表并按映射成行；同时校验映射指向的列确实存在。 */
  private async sourceRows(
    user: CurrentUser,
    tableId: number,
    mapping: Record<string, string>,
  ): Promise<TpEntry[]> {
    const table = await this.dataTable.get(user, tableId);
    const keys = new Set(table.fields.map((field) => field.fieldKey));
    const missing = [...new Set(Object.values(mapping))].filter(
      (key) => !keys.has(key),
    );
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `名单表「${table.name}」缺少列：${missing.join('、')}，请在多维表格里补齐后重试`,
      );
    }
    const rows = await this.readSourceRows(user, tableId);
    if (rows.length > TP_MAX_ROWS) {
      throw tooManyRows(rows.length);
    }
    const out: TpEntry[] = [];
    for (const row of rows) {
      const entry = projectRow(mapping, row.data);
      if (Object.keys(entry).length) out.push({ rowId: row.id, entry });
    }
    return out;
  }

  private async readSourceRows(
    user: CurrentUser,
    tableId: number,
  ): Promise<{ id: number; data: Row }[]> {
    const rows: { id: number; data: Row }[] = [];
    for (let offset = 0; ; offset += 500) {
      const batch = await this.dataTable.listRowsByOffset(
        user,
        tableId,
        500,
        offset,
      );
      for (const item of batch) {
        rows.push({ id: item.id, data: asRow(item.data) });
      }
      if (batch.length < 500) break;
      if (rows.length > TP_MAX_ROWS) break;
    }
    return rows.sort((a, b) => a.id - b.id);
  }

  /** 分群成员逐页取回：分群详情与导出共用，避免两处各写一遍翻页。 */
  private async crowdMembers(
    client: QidianClient,
    crowdId: string,
    operation: string,
  ) {
    const pageSize = 200;
    const first = await this.guard(
      () =>
        client.rows('GET', TP_PATHS.cdpCrowdDetail, {
          crowdId,
          page: 1,
          pageSize,
        }),
      operation,
    );
    let rows = first.rows;
    for (let page = 2; rows.length < first.total && page <= 50; page += 1) {
      const next = await this.guard(
        () =>
          client.rows('GET', TP_PATHS.cdpCrowdDetail, {
            crowdId,
            page,
            pageSize,
          }),
        operation,
      );
      if (!next.rows.length) break;
      rows = rows.concat(next.rows);
    }
    return rows;
  }

  /** 分群成员：先按分群详情取行，再按映射投影成目标字段（与名单表同一套映射方向）。 */
  private async segmentRows(
    user: CurrentUser,
    accountId: number,
    crowdId: string,
    mapping: Record<string, string>,
  ): Promise<TpEntry[]> {
    if (!crowdId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要写入 CRM 的企点分群',
      );
    }
    const { client } = await this.clientFor(user, accountId, 'CDP');
    const rows = await this.crowdMembers(client, crowdId, 'crm-import-segment');
    if (rows.length > TP_MAX_ROWS) {
      throw tooManyRows(rows.length);
    }
    const out: TpEntry[] = [];
    rows.forEach((row, index) => {
      const entry = projectRow(mapping, row);
      if (Object.keys(entry).length) out.push({ rowId: index + 1, entry });
    });
    return out;
  }

  private async resolveAccount(
    user: CurrentUser,
    accountId: number,
    product: CredProduct,
  ) {
    if (accountId) {
      const row = await this.prisma.tpAccount.findFirst({
        where: { id: accountId, userId: user.userId },
      });
      if (!row) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '企点凭据不存在或不属于当前账号',
        );
      }
      if (row.product !== product) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `这套凭据是「${TP_PRODUCT_LABELS[row.product] || row.product}」的，本动作需要「${TP_PRODUCT_LABELS[product] || product}」的凭据`,
        );
      }
      if (row.status !== 'active') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `企点凭据「${row.label || row.corporationId}」已停用，请在连接设置里启用`,
        );
      }
      return row;
    }
    const row = await this.prisma.tpAccount.findFirst({
      where: { userId: user.userId, product, status: 'active' },
      orderBy: { id: 'asc' },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `尚未配置「${TP_PRODUCT_LABELS[product] || product}」的企点凭据，请先到「企点连接设置」填写`,
      );
    }
    return row;
  }

  private clientOf(account: {
    gateway: string;
    corporationId: string;
    secretId: string;
    secretKeyCipher: string;
    bizId: string;
  }) {
    const creds: QidianCreds = {
      gateway: account.gateway,
      corporationId: account.corporationId,
      secretId: account.secretId,
      secretKey: account.secretKeyCipher
        ? this.crypto.decrypt(account.secretKeyCipher)
        : '',
      bizId: account.bizId,
    };
    return new QidianClient(creds);
  }

  private async clientFor(
    user: CurrentUser,
    accountId: number,
    product: CredProduct,
  ) {
    const account = await this.resolveAccount(user, accountId, product);
    return { account, client: this.clientOf(account) };
  }

  private ownerClient(task: { userId: string; accountId: number }) {
    return this.prisma.tpAccount
      .findFirst({ where: { id: task.accountId, userId: task.userId } })
      .then((account) => {
        if (!account) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '任务记录的企点凭据已删除，请重新配置后再执行',
          );
        }
        if (account.status !== 'active') {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `企点凭据「${account.label || account.corporationId}」已停用`,
          );
        }
        return this.clientOf(account);
      });
  }

  // ---------- 内部：任务执行 ----------

  private launch(taskId: number) {
    runInRequestContext(() => {
      void this.executeTask(taskId).catch((error) => {
        logger.error({
          taskId,
          kind: 'execute-failed',
          error: this.errorInfo(error),
        });
        void this.failTask(
          taskId,
          'INTERNAL',
          '任务执行中断，请到任务台账里重试',
        ).catch(() => undefined);
      });
    });
  }

  private async executeTask(taskId: number) {
    const claimed = await this.prisma.tpTask.updateMany({
      where: { id: taskId, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (!claimed.count) return;
    const task = await this.prisma.tpTask.findUnique({ where: { id: taskId } });
    if (!task) return;
    const user = new CurrentUser(task.userId, '', '');
    try {
      if (task.action === 'Tp_cdpExportSegment') {
        await this.runExport(user, task);
        return;
      }
      await this.runBatch(user, task);
    } catch (error) {
      if (error instanceof BusinessException) {
        await this.failTask(taskId, 'BUSINESS', error.message);
        return;
      }
      await this.failTask(taskId, 'UPSTREAM', this.mapError(error));
    }
  }

  private async runBatch(user: CurrentUser, task: TaskRef) {
    const call: TpBatchCall = TP_BATCH_CALLS[task.action as BatchOp];
    if (!call) {
      await this.failTask(
        task.id,
        'CONFIG',
        `未知的企点批量动作：${task.action}`,
      );
      return;
    }
    const mapping = mapOf(task.mappingJson);
    const client = await this.ownerClient(task);
    const entries = await this.sourceRows(user, task.tableId, mapping);
    if (!entries.length) {
      await this.finish(task.id, 'FAILED', 'NO_ROWS', '名单表里已没有有效行');
      return;
    }
    if (entries.length > task.totalRows) {
      // 受理之后又涨了行：按一次上限闸再拦一次，避免重跑时悄悄超量。
      await this.finish(
        task.id,
        'FAILED',
        'TOO_MANY_ROWS',
        tooManyRows(entries.length).message,
      );
      return;
    }
    const params = asRow(task.params);
    const path = text(params.upstreamPath).trim() || call.build({}).path;
    const fixed = asRow(params.fixed);
    let success = 0;
    let failed = 0;
    const outcomes = new Map<number, { ok: boolean; error: string }>();
    const errors: string[] = [];
    let upstreamTaskId = task.upstreamTaskId;
    for (let offset = 0; offset < entries.length; offset += UPSTREAM_BATCH) {
      const batch = entries.slice(offset, offset + UPSTREAM_BATCH);
      const index = offset / UPSTREAM_BATCH + 1;
      try {
        const result = await client.postOnce(path, {
          ...fixed,
          [UPSTREAM_LIST_KEY]: batch.map((item) => item.entry),
        });
        success += batch.length;
        for (const item of batch)
          outcomes.set(item.rowId, { ok: true, error: '' });
        if (!upstreamTaskId)
          upstreamTaskId = firstText(result, UPSTREAM_TASK_ID_KEYS);
        await this.event(
          task.id,
          'info',
          `已提交第 ${index} 批（${batch.length} 行）`,
          {
            upstreamTaskId,
          },
        );
      } catch (error) {
        failed += batch.length;
        const message = this.mapError(error);
        errors.push(message);
        for (const item of batch)
          outcomes.set(item.rowId, { ok: false, error: message });
        await this.event(
          task.id,
          'error',
          `第 ${index} 批提交失败：${message}`,
        );
        logger.warn({
          taskId: task.id,
          kind: 'batch-failed',
          error: this.errorInfo(error),
        });
        // 凭据或权限坏了就不要再把剩下的批次全部撞一遍。
        if (isFatalUpstream(error)) break;
      }
      await this.saveProgress(task.id, success, failed);
    }
    const skipped = Math.max(entries.length - success - failed, 0);
    const polled =
      call.poll && upstreamTaskId
        ? await this.pollUntilDone(task.id, client, upstreamTaskId)
        : null;
    const status =
      polled?.status === 'FAILED'
        ? 'FAILED'
        : failed
          ? success
            ? 'PARTIAL'
            : 'FAILED'
          : 'SUCCEEDED';
    const errorCode =
      polled?.status === 'FAILED'
        ? 'UPSTREAM_TASK'
        : failed
          ? 'UPSTREAM_BATCH'
          : '';
    const errorMessage =
      polled?.status === 'FAILED'
        ? polled.message
        : failed
          ? errors[0] || ''
          : '';
    await this.finish(task.id, status, errorCode, errorMessage, {
      successRows: success,
      failedRows: failed,
      skippedRows: skipped,
    });
    await this.rememberMapping(
      user,
      call.dataset,
      task.tableId,
      task.tableName,
      mapping,
    );
    await this.writeBackStatus(user, task.id, task.tableId, outcomes);
  }

  private async runExport(user: CurrentUser, task: TaskRef) {
    const client = await this.ownerClient(task);
    const params = asRow(task.params);
    const mapping = mapOf(task.mappingJson);
    const submitted = await this.guard(
      () => client.postOnce(TP_PATHS.cdpCrowdExport, { ...params }),
      'cdp-export-submit',
    );
    const upstreamTaskId = firstText(submitted, UPSTREAM_TASK_ID_KEYS);
    if (upstreamTaskId) {
      await this.prisma.tpTask.update({
        where: { id: task.id },
        data: { upstreamTaskId },
      });
      await this.event(
        task.id,
        'info',
        `企点导出任务已创建：${upstreamTaskId}`,
      );
      const polled = await this.pollUntilDone(task.id, client, upstreamTaskId);
      if (polled.status === 'FAILED') {
        await this.finish(task.id, 'FAILED', 'UPSTREAM_TASK', polled.message);
        return;
      }
    } else {
      await this.event(
        task.id,
        'warn',
        '企点导出接口没有返回任务ID，按已提交处理',
      );
    }
    const crowdId = text(params.crowdId).trim();
    const members = await this.crowdMembers(
      client,
      crowdId,
      'cdp-export-fetch',
    ).catch((error) => {
      logger.warn({
        taskId: task.id,
        kind: 'export-rows-failed',
        error: this.errorInfo(error),
      });
      return null;
    });
    if (!members || !members.length) {
      await this.finish(task.id, 'SUCCEEDED', '', '', { totalRows: 0 });
      await this.event(
        task.id,
        'warn',
        '已提交导出，但成员清单的返回位置按上游文档待核对；可在分群详情里查看，或改用小批量导出',
      );
      return;
    }
    const rows = members.slice(0, TP_MAX_ROWS);
    if (!task.tableId) {
      await this.finish(task.id, 'SUCCEEDED', '', '', {
        totalRows: rows.length,
      });
      await this.event(
        task.id,
        'info',
        `导出 ${rows.length} 行，未选择结果表，只记在任务台账`,
      );
      return;
    }
    const targets = Object.keys(mapping);
    const created: Row[] = rows.map((row) => {
      const entry: Row = { tp_task_id: String(task.id) };
      for (const key of targets)
        entry[key] = cellValue(pickCell(row, mapping[key]));
      return entry;
    });
    let saved = 0;
    for (let offset = 0; offset < created.length; offset += TABLE_ROW_BATCH) {
      const batch = created.slice(offset, offset + TABLE_ROW_BATCH);
      try {
        await this.dataTable.createRows(user, task.tableId, batch);
        saved += batch.length;
      } catch (error) {
        const message = this.mapError(error);
        await this.event(task.id, 'error', `写入结果表失败：${message}`);
        await this.finish(
          task.id,
          saved ? 'PARTIAL' : 'FAILED',
          'WRITE_BACK',
          message,
          {
            totalRows: rows.length,
            successRows: saved,
            failedRows: rows.length - saved,
          },
        );
        return;
      }
    }
    await this.finish(task.id, 'SUCCEEDED', '', '', {
      totalRows: rows.length,
      successRows: saved,
    });
    await this.rememberMapping(
      user,
      'cdp_segment_export',
      task.tableId,
      task.tableName,
      mapping,
    );
    // 产物归档：导出的分群成员存 CSV 进数字资产（尽力而为，失败不影响任务）。
    if (this.deliverableSink && created.length) {
      await this.deliverableSink(task.userId, {
        bytes: buildDeliverableCsv(
          ['tp_task_id', ...targets].map((key) => ({ key, label: key })),
          created,
        ),
        filename: `企点分群导出-${task.tableName || crowdId || 'segment'}-任务${task.id}.csv`,
        labels: ['营销工具', '腾讯企点'],
        dir: 'marketing/tp-export',
        source: 'tp-cdp-export',
      }).catch(() => undefined);
    }
  }

  /**
   * 轮询企点异步任务：只回报结果，不改任务台账也不发通知，
   * 收口由调用方做，避免同一任务通知两次。
   */
  private async pollUntilDone(
    taskId: number,
    client: QidianClient,
    upstreamTaskId: string,
  ): Promise<{
    status: 'SUCCEEDED' | 'FAILED' | 'POLLING' | 'UNKNOWN';
    message: string;
  }> {
    for (let round = 0; round < POLL_ROUNDS; round += 1) {
      let record: Row;
      try {
        record = await client.taskRecord(upstreamTaskId);
      } catch (error) {
        logger.warn({
          taskId,
          kind: 'poll-failed',
          error: this.errorInfo(error),
        });
        await this.event(
          taskId,
          'warn',
          '查询企点任务状态失败，稍后可在任务台账里刷新',
        );
        return { status: 'UNKNOWN', message: '查询企点任务状态失败' };
      }
      const state = upstreamState(record);
      await this.event(taskId, 'info', `企点任务状态：${state || '未返回'}`, {
        upstreamTaskId,
      });
      if (isFailedState(state)) {
        return { status: 'FAILED', message: `企点侧任务状态：${state}` };
      }
      if (isTaskRecordDone(record)) {
        return { status: 'SUCCEEDED', message: '' };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    await this.event(
      taskId,
      'warn',
      '企点任务超过 10 分钟仍未结束，可在任务台账里点刷新继续查',
    );
    return { status: 'POLLING', message: '企点侧仍在执行，可在任务台账里刷新' };
  }

  /** 刷新台账里的状态：只读企点，不再提交任何数据。 */
  private async refreshUpstream(task: {
    id: number;
    userId: string;
    accountId: number;
    upstreamTaskId: string;
  }) {
    if (!task.upstreamTaskId) return;
    const client = await this.ownerClient(task);
    const record = await client.taskRecord(task.upstreamTaskId);
    const state = upstreamState(record);
    if (!state) return;
    if (isFailedState(state)) {
      await this.finish(
        task.id,
        'FAILED',
        'UPSTREAM_TASK',
        `企点侧任务状态：${state}`,
      );
      return;
    }
    if (isTaskRecordDone(record)) {
      await this.finish(task.id, 'SUCCEEDED', '', '');
    }
  }

  /** 批次之间的进度落库（不通知），让任务详情里的计数实时可信。 */
  private async saveProgress(
    taskId: number,
    successRows: number,
    failedRows: number,
  ) {
    await this.prisma.tpTask
      .update({ where: { id: taskId }, data: { successRows, failedRows } })
      .catch(() => undefined);
  }

  private async finish(
    taskId: number,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    errorCode = '',
    errorMessage = '',
    counters: {
      totalRows?: number;
      successRows?: number;
      failedRows?: number;
      skippedRows?: number;
    } = {},
  ) {
    const task = await this.prisma.tpTask.update({
      where: { id: taskId },
      data: {
        ...counters,
        status,
        errorCode,
        errorMessage: errorMessage.slice(0, 500),
        finishedAt: new Date(),
      },
    });
    await this.notifyTask(
      task.userId,
      task.id,
      task.action,
      status,
      statusMessage(task),
    );
  }

  private async failTask(taskId: number, code: string, message: string) {
    await this.finish(taskId, 'FAILED', code, message);
  }

  /**
   * 提交结果写回名单表：只写本次真正提交过的那些行，且只有表归属账号能改列；
   * 写回失败只记日志，不影响已经提交给企点的名单。
   */
  private async writeBackStatus(
    user: CurrentUser,
    taskId: number,
    tableId: number,
    outcomes: Map<number, { ok: boolean; error: string }>,
  ) {
    if (!tableId || !outcomes.size) return;
    try {
      const table = await this.dataTable.get(user, tableId);
      if (!table.owner || !table.can.update) return;
      const existing = new Set(table.fields.map((field) => field.fieldKey));
      const missing = WRITE_BACK_FIELDS.filter(
        (field) => !existing.has(field.fieldKey),
      );
      if (missing.length) {
        await this.dataTable.addFields(
          user,
          tableId,
          missing.map((field) => ({ ...field })),
        );
      }
      const rows = await this.prisma.dataTableRow.findMany({
        where: { tableId, id: { in: [...outcomes.keys()] } },
        select: { id: true, data: true },
      });
      const updates = rows.flatMap((row) => {
        const outcome = outcomes.get(row.id);
        if (!outcome) return [];
        return [
          {
            id: row.id,
            data: {
              ...asRow(row.data),
              tp_task_id: String(taskId),
              tp_submit_status: outcome.ok ? '已提交' : '提交失败',
              tp_error: outcome.error,
            },
          },
        ];
      });
      try {
        // 整批一次权限校验 + 一个事务，避免上万行时逐行打远端库
        await this.dataTable.updateRows(user, tableId, updates);
      } catch (batchError) {
        logger.warn({
          taskId,
          kind: 'write-back-batch-failed',
          error: this.errorInfo(batchError),
        });
        // 整批失败时退回逐行，单行问题不牵连其他行
        for (const item of updates) {
          try {
            await this.dataTable.updateRow(user, tableId, item.id, item.data);
          } catch (error) {
            logger.warn({
              taskId,
              rowId: item.id,
              kind: 'write-back-row-failed',
              error: this.errorInfo(error),
            });
          }
        }
      }
    } catch (error) {
      logger.warn({
        taskId,
        kind: 'write-back-failed',
        error: this.errorInfo(error),
      });
      await this.event(
        taskId,
        'warn',
        '提交结果没能写回名单表（表权限或列变化），名单本身已按上方批次处理',
      );
    }
  }

  private async rememberMapping(
    user: CurrentUser,
    datasetKey: string,
    tableId: number,
    tableName: string,
    columnMap: Record<string, string>,
  ) {
    if (!tableId || !Object.keys(columnMap).length) return;
    try {
      await this.upsertMapping(
        user.userId,
        datasetKey,
        tableId,
        tableName,
        columnMap,
      );
    } catch (error) {
      logger.warn({
        kind: 'mapping-save-failed',
        error: this.errorInfo(error),
      });
    }
  }

  private upsertMapping(
    userId: string,
    datasetKey: string,
    tableId: number,
    tableName: string,
    columnMap: Record<string, string>,
  ) {
    if (!datasetKey) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少数据集标识');
    }
    return this.prisma.tpMapping.upsert({
      where: {
        userId_datasetKey_tableId: { userId, datasetKey, tableId },
      },
      create: {
        userId,
        datasetKey,
        tableId,
        tableName,
        columnMap: columnMap,
      },
      update: {
        tableName,
        columnMap: columnMap,
      },
    });
  }

  private async event(
    taskId: number,
    level: string,
    message: string,
    payload: Row = {},
  ) {
    await this.prisma.tpTaskEvent
      .create({
        data: {
          taskId,
          level,
          message: message.slice(0, 500),
          payload: payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  /** 任务成败给归属账号一条系统消息：沿用「自动化与集成」类目，不新开类目。 */
  private async notifyTask(
    userId: string,
    taskId: number,
    action: string,
    status: string,
    message: string,
  ) {
    const label = TP_ACTION_LABELS[action] || action;
    const level =
      status === 'FAILED' ? 'error' : status === 'PARTIAL' ? 'warning' : 'info';
    await this.notifications
      .notify(userId, {
        category: 'automation',
        title: `企点${label}任务${TP_STATUS_LABELS[status] || status}`,
        body: `任务 #${taskId}：${message}`,
        link: '/marketing-tools',
        level,
        entityType: 'tp_task',
        entityId: taskId,
      })
      .catch(() => undefined);
  }

  // ---------- 内部：错误与视图 ----------

  private async guard<T>(
    work: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      logger.warn({ operation, error: this.errorInfo(error) });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        this.mapError(error),
      );
    }
  }

  /** 上游原始报文只进日志；界面看到的是可操作的中文。 */
  private mapError(error: unknown): string {
    if (error instanceof BusinessException) return error.message;
    if (error instanceof TransportError) {
      return error.kind === 'timeout'
        ? '连接腾讯企点超时，请稍后重试'
        : '连接腾讯企点失败，请检查网络或网关地址后重试';
    }
    if (error instanceof QidianError) {
      const messages: Record<string, string> = {
        Unauthorized: '企点凭据无效或已过期，请到「企点连接设置」重新保存',
        Unauthenticated: '企点凭据无效或已过期，请到「企点连接设置」重新保存',
        InvalidSignature:
          'secretKey 与企业ID 不匹配，请重新填写密钥（注意签名用的是企业ID＋时间戳）',
        SignatureDoesNotMatch:
          'secretKey 与企业ID 不匹配，请重新填写密钥（注意签名用的是企业ID＋时间戳）',
        InvalidSecretId: 'secretId 不正确，请从企点控制台原样复制',
        NoPermission: '该 secretId 没有本接口的权限，请在企点控制台检查授权',
        Forbidden: '该空间无权访问本接口，请换一个空间ID或联系企点开通',
        InvalidBizId: '空间ID（bizId）不存在，请核对企点控制台',
        InvalidCorporationId: '企业ID不存在，请核对企点控制台',
        NotFound: '企点侧找不到该对象（可能已删除），请刷新清单后重选',
        Throttling: '企点接口限流，已自动重试一次，请稍后再试',
        InternalError: '企点服务暂时不可用，请稍后重试',
        ServiceUnavailable: '企点服务暂时不可用，请稍后重试',
      };
      const mapped = messages[error.code];
      if (mapped) return mapped;
      return error.code
        ? `企点接口返回错误（${error.code}），请对照凭据与空间权限后重试`
        : '企点接口调用失败，请稍后重试';
    }
    return '企点接口调用失败，请稍后重试';
  }

  private errorInfo(error: unknown) {
    if (error instanceof QidianError) {
      return {
        name: error.name,
        code: error.code,
        requestId: error.requestId,
        httpStatus: error.httpStatus,
      };
    }
    if (error instanceof BusinessException) {
      return { name: error.name, code: error.errorCode.code };
    }
    if (error instanceof TransportError) {
      return { name: error.name, kind: error.kind };
    }
    return { name: (error as { name?: string })?.name || 'Error' };
  }
}

// ---------- 纯函数与常量视图 ----------

/**
 * CRM 客户导入能落库的字段：与 CRM 自己的导入服务逐字一致。
 * CRM 建档时客户只存名称、行业、省、市、备注，手机/邮箱/联系人只在线索里保存，
 * 因此这里不放行那几列，避免界面映射了、库里却没写。
 */
const CRM_IMPORT_FIELDS = ['name', 'industry', 'province', 'city', 'remark'];

function accountView(row: {
  id: number;
  product: string;
  label: string;
  gateway: string;
  corporationId: string;
  secretId: string;
  secretKeyCipher: string;
  bizId: string;
  status: string;
  lastVerifiedAt: Date | null;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    product: row.product,
    productLabel: TP_PRODUCT_LABELS[row.product] || row.product,
    label: row.label,
    gateway: row.gateway,
    corporationId: row.corporationId,
    secretId: row.secretId,
    hasSecretKey: !!row.secretKeyCipher,
    bizId: row.bizId,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() || '',
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function taskView(row: {
  id: number;
  product: string;
  action: string;
  tableId: number;
  tableName: string;
  status: string;
  upstreamTaskId: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  errorCode: string;
  errorMessage: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    product: row.product,
    productLabel: TP_PRODUCT_LABELS[row.product] || row.product,
    action: row.action,
    actionLabel: TP_ACTION_LABELS[row.action] || row.action,
    tableId: row.tableId,
    tableName: row.tableName,
    status: row.status,
    upstreamTaskId: row.upstreamTaskId,
    totalRows: row.totalRows,
    successRows: row.successRows,
    failedRows: row.failedRows,
    skippedRows: row.skippedRows,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() || '',
    finishedAt: row.finishedAt?.toISOString() || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mappingView(row: {
  id: number;
  datasetKey: string;
  tableId: number;
  tableName: string;
  columnMap: Prisma.JsonValue;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    datasetKey: row.datasetKey,
    datasetLabel: TP_DATASET_LABELS[row.datasetKey] || row.datasetKey,
    tableId: row.tableId,
    tableName: row.tableName,
    columnMap: asRow(row.columnMap),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function statusMessage(task: {
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  errorMessage: string;
}) {
  if (task.errorMessage) return task.errorMessage;
  return `共 ${task.totalRows} 行，成功 ${task.successRows} 行，失败 ${task.failedRows} 行，跳过 ${task.skippedRows} 行`;
}

/** 花钱/真触达的动作：没勾选确认就不出网，按操作ID判定，名单人数一并写进提示。 */
function assertCostConfirmed(operationId: string, body: Row, count?: number) {
  if (!COST_GATED.has(operationId)) return;
  if (body.confirmCost === true) return;
  const label = TP_ACTION_LABELS[operationId] || operationId;
  const suffix = count === undefined ? '' : `（本次 ${count} 行）`;
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    `${label}会产生真实发送或额度消耗${suffix}，请先核对人数并勾选确认`,
  );
}

/** 交给企点的报文：优先用户填的 payload，其次去掉本系统控制字段后原样透传。 */
function upstreamPayload(body: Row): Row {
  const payload = body.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Row) };
  }
  const out: Row = {};
  for (const [key, value] of Object.entries(body)) {
    if (CONTROL_KEYS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

function mapOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, target] of Object.entries(value as Row)) {
    const source = text(target).trim();
    if (key.trim() && source) out[key.trim()] = source;
  }
  return out;
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};
}

/** 多维表格的单元格值统一收成企点能收的标量。 */
function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => cellValue(item))
      .filter(Boolean)
      .join(',');
  }
  const row = value as Row;
  const named = text(row.name || row.label || row.text || row.value).trim();
  return named;
}

/** 按映射取一列：先精确列名，再忽略大小写与下划线，兼容上游字段名的写法差异。 */
function pickCell(source: Row, column: string): unknown {
  if (column in source) return source[column];
  const normalized = (key: string) => key.toLowerCase().replace(/_/g, '');
  const want = normalized(column);
  for (const [key, value] of Object.entries(source)) {
    if (normalized(key) === want) return value;
  }
  return undefined;
}

/** 来源行 → 目标报文：空值不提交，交给企点自己的必填校验。 */
function projectRow(mapping: Record<string, string>, source: Row): Row {
  const out: Row = {};
  for (const [target, column] of Object.entries(mapping)) {
    const value = cellValue(pickCell(source, column));
    if (value !== '') out[target] = value;
  }
  return out;
}

function firstText(payload: Row, keys: string[]): string {
  const found = pickText(payload, keys);
  if (found) return found;
  const nested = asRow(payload.data);
  return Object.keys(nested).length ? pickText(nested, keys) : '';
}

function pickText(payload: Row, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  const data = payload.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  return '';
}

/** 企点异步任务状态：文档里大小写与键名不统一，四五种写法都要认。 */
function upstreamState(record: Row): string {
  return text(
    record.status ?? record.taskStatus ?? record.State ?? record.state,
  ).toUpperCase();
}

function isFailedState(state: string): boolean {
  return (
    state.includes('FAIL') ||
    state.includes('ERROR') ||
    state.includes('CANCEL')
  );
}

/** 鉴权、权限、凭据类错误重试没有意义，直接把后面的批次停掉。 */
function isFatalUpstream(error: unknown): boolean {
  if (error instanceof QidianError) {
    return /^(Unauth|Invalid(Secret|Signature)|NoPermission|Forbidden|AccessDenied)/i.test(
      error.code,
    );
  }
  return false;
}

function tooManyRows(count: number) {
  return new BusinessException(
    ErrorCode.BAD_REQUEST,
    `单次上限 ${TP_MAX_ROWS} 行，当前 ${count} 行，请把名单拆成多次执行`,
  );
}

function positiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, `请选择${label}`);
  }
  return parsed;
}

/** 可选的ID：不填或 0 都表示「没有选」，交给调用方按自己的兜底口径处理。 */
function optionalId(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}选择不正确，请重新选择`,
    );
  }
  return parsed;
}

/** 凭据选择：0 = 由本产品唯一在用凭据自动兜底。 */
function accountIdOf(input: Row): number {
  return optionalId(input.accountId, '企点凭据');
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
