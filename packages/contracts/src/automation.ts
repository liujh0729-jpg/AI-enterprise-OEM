import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.number(),
    message: z.string(),
    data: data.nullable(),
  });

const jsonObject = z.record(z.string(), z.unknown());
const remoteObject = z.object({}).passthrough();
const remoteRows = z.array(jsonObject);
const emptyQuery = z.object({});
const passthroughBody = z.object({}).passthrough();

/**
 * 页码上限：Prisma 的 skip/offset 走 32 位整数，`page × pageSize` 超出就会让
 * 数据库报参数越界（界面看到的是 500）。按 pageSize 最大值 200 折算，100000 页
 * 已经远超任何真实清单，再多一律 400。
 */
const PAGE_NUMBER_MAX = 100_000;

const pageQuery = (defaultSize: number) =>
  z
    .object({
      page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
      pageSize: z.coerce
        .number()
        .int()
        .positive()
        .max(200)
        .default(defaultSize),
    })
    .passthrough();

// ---------- 多维表格 ----------

export const dataTablePermissionsSchema = z.object({
  read: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
});

export const dataTableFieldSchema = z.object({
  id: z.number(),
  tableId: z.number(),
  name: z.string(),
  fieldKey: z.string(),
  fieldType: z.string(),
  sortOrder: z.number(),
  options: jsonObject,
  required: z.boolean(),
  createdAt: z.string(),
});

export const dataTableRowSchema = z.object({
  id: z.number(),
  tableId: z.number(),
  data: jsonObject,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const dataTableSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z.boolean(),
  can: dataTablePermissionsSchema,
  fields: z.array(dataTableFieldSchema),
  rowCount: z.number(),
});

export const dataTableGrantSchema = z.object({
  id: z.number(),
  tableId: z.number(),
  userId: z.string(),
  grantedBy: z.string(),
  createdAt: z.string(),
  can: dataTablePermissionsSchema,
});

export const dataTableGrantsSchema = z.object({
  candidates: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      sources: z.array(z.string()),
    }),
  ),
  grants: z.array(dataTableGrantSchema),
});

const dataTableRemovedSchema = z.object({
  id: z.number(),
  deleted: z.boolean(),
});

const dataTableParams = z.object({ id: z.string() });
const dataTableRowParams = z.object({ id: z.string(), rowId: z.string() });
const dataTableFieldParams = z.object({
  id: z.string(),
  fieldId: z.string(),
});
const dataTableFeishuParams = z.object({ id: z.string(), syncId: z.string() });

const dataTableRowPageSchema = z.object({
  list: z.array(dataTableRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

/** 飞书同步：一个绑定的字段映射（本地列键 ↔ 飞书字段名）。 */
export const dataTableFeishuMappingSchema = z.object({
  localKey: z.string(),
  feishuName: z.string(),
});

export const dataTableFeishuSyncSchema = z.object({
  id: z.number(),
  tableId: z.number(),
  direction: z.string(),
  directionLabel: z.string(),
  appId: z.string(),
  appToken: z.string(),
  feishuTableId: z.string(),
  verificationToken: z.string(),
  hasAppSecret: z.boolean(),
  hasEncryptKey: z.boolean(),
  fieldMapping: z.array(dataTableFeishuMappingSchema),
  status: z.string(),
  webhookPath: z.string(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 保存绑定后的返回：绑定本体 + 实际落库的映射预览。 */
export const dataTableFeishuSavedSchema = dataTableFeishuSyncSchema.extend({
  mappingPreview: z.array(dataTableFeishuMappingSchema),
});

export const dataTableFeishuPreviewSchema = z.object({
  tables: z.array(z.object({ tableId: z.string(), name: z.string() })),
  fields: z.array(
    z.object({
      fieldId: z.string(),
      fieldName: z.string(),
      type: z.number(),
    }),
  ),
});

export const dataTableFeishuTestSchema = z.object({
  ok: z.boolean(),
  fieldCount: z.number(),
  fields: z.array(
    z.object({
      fieldId: z.string(),
      fieldName: z.string(),
      type: z.number(),
    }),
  ),
});

export const dataTableFeishuRunSchema = z.object({
  trigger: z.string(),
  pulled: z.number(),
  pushed: z.number(),
  created: z.number(),
  updated: z.number(),
  deleted: z.number(),
  skipped: z.number(),
});

export const dataTableFeishuLogSchema = z.object({
  id: z.number(),
  trigger: z.string(),
  status: z.string(),
  stats: jsonObject,
  message: z.string(),
  createdAt: z.string(),
});

/**
 * 营销工具（大数据查询 / 潜客挖掘）选「结果表」用的候选清单，两个模块共用一份口径。
 * 候选条件与写行校验逐字一致：当前账号有该表的新增权，且列已覆盖工具模板的全部列键
 * （多维表格写行拒收未知列键，所以列不齐的表选了也写不进去，一律不进候选）。
 */
export const resultTableOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
  rowCount: z.number(),
});

export const resultTableOptionsSchema = z.object({
  /** 该工具结果表必须覆盖的列键，界面据此解释「为什么我建的表选不到」。 */
  requiredColumns: z.array(z.string()),
  /** 同一模板的中文列名，建表弹窗用它说明新表会带上哪些列。 */
  columnLabels: z.array(z.string()),
  /** 设置里记的默认结果表（没设置或已被删除时为 null）。 */
  defaultTable: resultTableOptionSchema.nullable(),
  tables: z.array(resultTableOptionSchema),
});

/** 建结果表的入参：给了名字就新建一张，不设默认则只作为任务的可选目标。 */
const createTableBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  setDefault: z.boolean().optional(),
});

/** 改任务结果表的入参：任务还没跑出结果前可以换目标表。 */
const updateTaskTableBody = z.object({
  dataTableId: z.coerce.number().int().positive(),
});

// ---------- RPA ----------

export const rpaScriptBaseSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  deviceType: z.string(),
  fileType: z.string(),
  vendorFlowId: z.string(),
  status: z.string(),
  content: z.string(),
  paramsSchema: jsonObject,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const rpaScriptSchema = rpaScriptBaseSchema.extend({
  taskCount: z.number(),
  owner: z.boolean(),
});

export const rpaScriptDetailSchema = rpaScriptBaseSchema.extend({
  taskCount: z.number(),
});

export const rpaAccountSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  platform: z.string(),
  groupId: z.string(),
  nickname: z.string(),
  username: z.string(),
  loginUrl: z.string(),
  envType: z.number(),
  status: z.string(),
  proxyMethod: z.number(),
  proxyType: z.string(),
  proxyHost: z.string(),
  proxyPort: z.number(),
  proxyUserName: z.string(),
  notes: z.string(),
  lastLoginAt: z.string().nullable(),
  // 两类口令都只回「有没有存过」：密文永不出库，明文只走任务派发那一条链路
  hasPassword: z.boolean(),
  hasProxyPassword: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const rpaTaskSchema = z
  .object({
    id: z.number(),
    createdBy: z.string(),
    name: z.string(),
    scriptId: z.number(),
    deviceType: z.string(),
    accountIds: z.array(z.number()),
    params: jsonObject,
    status: z.string(),
    scheduleType: z.string(),
    scheduleConfig: jsonObject,
    phoneFinishAction: z.string(),
    scheduledAt: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    lastRunAt: z.string().nullable(),
    lastError: z.string(),
    maxRetries: z.number(),
    timeoutSeconds: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    script: z.union([
      z.null(),
      z.object({
        id: z.number(),
        name: z.string(),
        deviceType: z.string(),
        fileType: z.string(),
        vendorFlowId: z.string(),
        status: z.string(),
      }),
    ]),
    deviceLabel: z.string(),
    accounts: z.array(
      z.object({
        id: z.number(),
        platform: z.string(),
        username: z.string(),
        nickname: z.string().optional(),
        envType: z.number().optional(),
      }),
    ),
  })
  .passthrough();

export const rpaExecutionSchema = z
  .object({
    id: z.number(),
    taskId: z.number(),
    createdBy: z.string(),
    deviceType: z.string(),
    status: z.string(),
    attempt: z.number(),
    executor: z.string(),
    output: jsonObject,
    errorMessage: z.string(),
    logText: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    deviceLabel: z.string(),
    statusLabel: z.string(),
  })
  .passthrough();

export const rpaDispatchSchema = z
  .object({
    executionId: z.number(),
    attempt: z.number(),
    claimedAt: z.string(),
    timeoutSeconds: z.number(),
    settings: z.object({
      bitbrowserApiEndpoint: z.string(),
      bitbrowserGroupId: z.string(),
      bitphoneRegionId: z.string(),
      bitphoneComputeType: z.string(),
    }),
    device: z.object({
      deviceType: z.string(),
      deviceLabel: z.string(),
      phoneFinishAction: z.string(),
      envType: z.number(),
    }),
    task: z.object({
      id: z.number(),
      name: z.string(),
      params: jsonObject,
      scheduleType: z.string(),
      accountIds: z.array(z.number()),
    }),
    script: z.object({
      id: z.number(),
      name: z.string(),
      deviceType: z.string(),
      fileType: z.string(),
      vendorFlowId: z.string(),
      status: z.string(),
      content: z.string(),
      paramsSchema: jsonObject,
    }),
    // 派发给本地执行端的报文：口令（登录 / 代理）在这里才是明文，执行端要真的登录
    accounts: z.array(
      z.object({
        id: z.number(),
        platform: z.string(),
        username: z.string(),
        nickname: z.string(),
        password: z.string(),
        loginUrl: z.string(),
        envType: z.number(),
        proxyMethod: z.number(),
        proxyType: z.string(),
        proxyHost: z.string(),
        proxyPort: z.number(),
        proxyUserName: z.string(),
        proxyPassword: z.string(),
      }),
    ),
  })
  .passthrough();

export const rpaLlmSettingSchema = z.object({
  configured: z.boolean(),
  keyMasked: z.string(),
  model: z.string(),
  baseUrl: z.string(),
});

export const rpaLlmModelsSchema = z.object({
  baseUrl: z.string(),
  models: z.array(z.string()),
});

export const rpaGenerateScriptSchema = z.object({
  deviceType: z.string(),
  fileType: z.string(),
  model: z.string(),
  content: z.string(),
  paramsSchema: jsonObject,
  suggestedName: z.string(),
  elapsedMs: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
});

export const rpaParamsChatSchema = z.object({
  reply: z.string(),
  params: jsonObject,
  done: z.boolean(),
  elapsedMs: z.number(),
});

export const rpaSettingsSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  bitbrowserApiEndpoint: z.string(),
  bitbrowserGroupId: z.string(),
  bitphoneRegionId: z.string(),
  bitphoneComputeType: z.string(),
  hasBitbrowserApiKey: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const rpaScriptParams = z.object({ id: z.string() });
const rpaAccountParams = z.object({ id: z.string() });
const rpaTaskParams = z.object({ id: z.string() });
const rpaExecutionParams = z.object({ id: z.string() });

const rpaScriptQuery = z
  .object({
    status: z.string().optional(),
    deviceType: z.string().optional(),
    fileType: z.string().optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
    pageSize: z.coerce.number().int().positive().max(200).default(20),
  })
  .passthrough();

const rpaOpenScriptQuery = z
  .object({
    status: z.string().optional(),
    deviceType: z.string().optional(),
    fileType: z.string().optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
    pageSize: z.coerce.number().int().positive().max(200).default(50),
  })
  .passthrough();

const rpaTaskListQuery = z
  .object({
    status: z.string().optional(),
    deviceType: z.string().optional(),
    keyword: z.string().optional(),
    page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
  })
  .passthrough();

const rpaOpenTaskListQuery = z
  .object({
    status: z.string().optional(),
    deviceType: z.string().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .passthrough();

const rpaExecutionListQuery = z
  .object({
    taskId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .passthrough();

const rpaIdQuery = z.object({ keyword: z.string().optional() }).passthrough();

// ---------- Workbuddy ----------

export const workbuddyAccountSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  name: z.string(),
  region: z.string(),
  status: z.string(),
  lastVerifiedAt: z.string().nullable(),
  lastError: z.string(),
  notes: z.string(),
  secretIdMasked: z.string(),
  hasSecretKey: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workbuddyLlmSettingSchema = rpaLlmSettingSchema;
export const workbuddyLlmModelsSchema = rpaLlmModelsSchema;

export const workbuddyPlanSpecSchema = z.object({
  goal: z.string(),
  deliverable: z.string(),
  acceptance: z.string(),
  steps: z.array(
    z.object({
      title: z.string(),
      instruction: z.string(),
    }),
  ),
});

export const workbuddyPlanSchema = z
  .object({
    id: z.number(),
    createdBy: z.string(),
    kind: z.string(),
    title: z.string(),
    rawInput: z.string(),
    spec: workbuddyPlanSpecSchema,
    stepCount: z.number(),
    ready: z.boolean(),
    taskCount: z.number(),
    strategy: z.string(),
    accountIds: z.array(z.number()),
    scheduleType: z.string(),
    scheduleConfig: jsonObject,
    scheduledAt: z.string().nullable(),
    status: z.string(),
    summary: z.string(),
    lastError: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const workbuddyTaskSchema = z
  .object({
    id: z.number(),
    planId: z.number(),
    kind: z.string(),
    seq: z.number(),
    accountId: z.number(),
    agentId: z.string(),
    versionId: z.string(),
    sessionId: z.string(),
    instruction: z.string(),
    status: z.string(),
    lastEventSeq: z.number(),
    state: z.string(),
    lastError: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const workbuddyAccountBriefSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
});

export const workbuddyPlanDetailSchema = z.object({
  plan: workbuddyPlanSchema,
  tasks: z.array(workbuddyTaskSchema),
  accounts: z.array(workbuddyAccountBriefSchema),
});

export const workbuddyClarifySchema = z.object({
  reply: z.string(),
  spec: workbuddyPlanSpecSchema,
  ready: z.boolean(),
  specError: z.string().optional(),
  elapsedMs: z.number(),
});

export const workbuddyRemotePageSchema = z.object({
  total: z.number(),
  items: remoteRows,
  offset: z.number(),
  limit: z.number(),
});

export const workbuddyCatalogPageSchema = z.object({
  total: z.number(),
  items: remoteRows,
  counts: z.union([z.null(), jsonObject]),
});

const workbuddyAccountParams = z.object({ id: z.string() });
const workbuddyPlanParams = z.object({ id: z.string() });
const workbuddyTaskParams = z.object({ id: z.string() });

const workbuddyCredentialQuery = z
  .object({
    accountId: z.coerce.number().int().positive(),
    offset: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    keyword: z.string().optional(),
    agentId: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

const workbuddyPlanListQuery = z
  .object({ status: z.string().optional() })
  .passthrough();

// ---------- AI 调用账号 ----------

export const aiCallAccountSchema = z.object({
  id: z.number(),
  createdBy: z.string(),
  name: z.string(),
  platform: z.string(),
  loginUrl: z.string(),
  username: z.string(),
  extra: jsonObject,
  status: z.string(),
  notes: z.string(),
  hasPassword: z.boolean(),
  hasApiKey: z.boolean(),
  hasCookie: z.boolean(),
  bindings: z.array(
    z.object({
      workbuddyAccountId: z.number(),
      name: z.string(),
      status: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const aiCallCredentialsSchema = z.object({
  id: z.number(),
  name: z.string(),
  platform: z.string(),
  loginUrl: z.string(),
  username: z.string(),
  password: z.string(),
  apiKey: z.string(),
  cookie: z.string(),
  extra: jsonObject,
});

const aiCallParams = z.object({ id: z.string() });

const aiCallListQuery = z
  .object({ keyword: z.string().optional() })
  .passthrough();

const aiCallOpenListQuery = z
  .object({
    workbuddyAccountId: z.coerce.number().int().positive(),
    platform: z.string().optional(),
  })
  .passthrough();

const aiCallOpenCredentialsQuery = z
  .object({
    workbuddyAccountId: z.coerce.number().int().positive(),
  })
  .passthrough();

// ---------- Google 潜客线索挖掘 ----------

export const leadCountrySchema = z.object({
  code: z.string(),
  label: z.string(),
});

export const leadSettingsSchema = z.object({
  serperConfigured: z.boolean(),
  serperMasked: z.string(),
  dataTableId: z.number(),
  dataTableExists: z.boolean(),
  /** 默认结果表在多维表格里的实际表名（用户可改名，界面不能拿模板名冒充）。 */
  dataTableActualName: z.string(),
  model: z.string(),
  keyConfigured: z.boolean(),
  keyMasked: z.string(),
  /** 平台 Key 状态读取失败时的原因（空＝读取正常）；界面据此提示「状态没读到」而不是谎报未配置。 */
  keyStatusError: z.string(),
  countries: z.array(leadCountrySchema),
  ready: z.boolean(),
});

export const leadTableResultSchema = z.object({
  created: z.boolean(),
  dataTableId: z.number(),
  name: z.string(),
  fields: z.array(z.string()),
});

export const leadSpecSchema = z.object({
  keywords: z.array(z.string()),
  country: z.string(),
  scene: z.string(),
  num: z.number(),
});

export const leadChatSchema = z.object({
  reply: z.string(),
  spec: leadSpecSchema.nullable(),
  done: z.boolean(),
  elapsedMs: z.number(),
});

export const leadMessageSchema = z.object({
  id: z.number(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export const leadTaskSchema = z
  .object({
    id: z.number(),
    spec: jsonObject,
    rawIntent: z.string(),
    status: z.string(),
    totalFound: z.number(),
    totalSaved: z.number(),
    totalSkipped: z.number(),
    dataTableId: z.number(),
    /** 该任务这一轮写入的多维表格表名（表已删除时为空串）。 */
    dataTableName: z.string(),
    error: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const leadTaskPageSchema = z.object({
  list: z.array(leadTaskSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

// ---------- 大数据查询（营销工具：五个独立数据集） ----------

/**
 * 上游 AIPDD 企业大数据平台（默认 `https://bigdata.aiworkin.com`）的六个数据集里，
 * 用户点名的五个。每个数据集是一个独立的大数据营销工具：自然语言需求 → 模型分析成
 * 上游查询参数 → 调 `/api/<dataset>/query` → 结果逐批写入本模块生成的多维表格。
 *
 * 列模板与可筛选字段在这里声明一次，后端建表 / 校验 spec / 拼提示词与前端渲染共用同一份。
 * `columns` 的 fieldKey 与上游返回的字段名逐字一致（另加 source_id 存上游主键，用于去重）。
 */
/** 五个数据集的固定顺序＝营销工具卡片与页签的展示顺序。 */
export const BIGDATA_DATASET_KEYS = [
  "enterprise",
  "buyer",
  "person",
  "kol",
  "poi",
] as const;

export type BigdataDatasetKey = (typeof BIGDATA_DATASET_KEYS)[number];

export type BigdataColumn = {
  fieldKey: string;
  name: string;
  fieldType: "text" | "number";
};

export type BigdataFilterField = {
  /** 上游请求体的字段名，也是模型可以填的键。 */
  key: string;
  label: string;
  /** 取值口径提示（进提示词，也做界面回显）。 */
  hint?: string;
  /** 缺省按文本收；粉丝数这类数值筛选项单独声明。 */
  valueType?: "text" | "number";
};

export type BigdataDataset = {
  key: BigdataDatasetKey;
  /** 卡片名与页签名。 */
  label: string;
  /** 上游查询接口路径。 */
  upstreamPath: string;
  /** 该数据集的多维表格表名与说明（点「生成结果表」时建的就是它）。 */
  tableName: string;
  tableDescription: string;
  /** 空状态示例：用户照这个句式说需求。 */
  example: string;
  /**
   * 上游筛选值的写法口径：zh＝库里存中文，en＝库里存英文。
   * 决定提示词要不要让模型先把中文需求翻成英文，也决定界面在 0 命中时怎么解释。
   */
  valueLanguage: "zh" | "en";
  filters: BigdataFilterField[];
  columns: BigdataColumn[];
};

const sourceIdColumn: BigdataColumn = {
  fieldKey: "source_id",
  name: "源数据ID",
  fieldType: "text",
};

export const BIGDATA_DATASETS: Record<BigdataDatasetKey, BigdataDataset> = {
  enterprise: {
    key: "enterprise",
    label: "企业数据",
    upstreamPath: "/api/enterprise/query",
    tableName: "企业大数据",
    tableDescription:
      "「企业数据」查询结果的承载表：每行一家企业，字段与上游企业库逐列对应，源数据ID 用于跨任务去重。",
    example:
      "例：「帮我找华东做精密机械加工的中小企业，最好有官网和联系人，先取 50 家」。",
    valueLanguage: "zh",
    filters: [
      { key: "country", label: "国家" },
      { key: "province", label: "省" },
      { key: "city", label: "市" },
      { key: "industry_category", label: "行业大类" },
      { key: "industry_subcategory", label: "行业中类" },
      { key: "enterprise_name", label: "企业名称关键词" },
      { key: "contact_person", label: "联系人" },
      { key: "phone", label: "固定电话" },
      { key: "mobile", label: "手机号" },
      { key: "email", label: "邮箱" },
      { key: "website", label: "官网" },
      {
        key: "created_at_start",
        label: "入库起始日期",
        hint: "YYYY-MM-DD",
      },
      { key: "created_at_end", label: "入库结束日期", hint: "YYYY-MM-DD" },
    ],
    columns: [
      { fieldKey: "country", name: "国家", fieldType: "text" },
      { fieldKey: "province", name: "省", fieldType: "text" },
      { fieldKey: "city", name: "市", fieldType: "text" },
      { fieldKey: "district", name: "区", fieldType: "text" },
      { fieldKey: "industry_category", name: "行业大类", fieldType: "text" },
      { fieldKey: "industry_subcategory", name: "行业中类", fieldType: "text" },
      { fieldKey: "enterprise_name", name: "企业名称", fieldType: "text" },
      { fieldKey: "employee_count", name: "员工数", fieldType: "number" },
      { fieldKey: "phone", name: "固定电话", fieldType: "text" },
      { fieldKey: "address", name: "联系地址", fieldType: "text" },
      { fieldKey: "website", name: "官网", fieldType: "text" },
      { fieldKey: "primary_email", name: "主邮箱", fieldType: "text" },
      { fieldKey: "backup_email", name: "备用邮箱", fieldType: "text" },
      { fieldKey: "contact_person", name: "联系人", fieldType: "text" },
      { fieldKey: "mobile", name: "手机号", fieldType: "text" },
      sourceIdColumn,
    ],
  },
  buyer: {
    key: "buyer",
    label: "全球贸易大数据",
    upstreamPath: "/api/buyer/query",
    tableName: "全球贸易采购商",
    tableDescription:
      "「全球贸易大数据」查询结果的承载表：每行一个海外采购商，含供货/采购区域与港口，源数据ID 用于跨任务去重。",
    example:
      "例：「找采购厨房用品的东南亚买家，要有邮箱和电话，供货区域看俄罗斯也行，取 40 家」。",
    valueLanguage: "en",
    filters: [
      { key: "buyer_name", label: "采购商名称" },
      { key: "industry", label: "行业" },
      { key: "contact_person", label: "联系人" },
      { key: "position", label: "职位" },
      { key: "email", label: "邮箱" },
      { key: "phone", label: "电话" },
      { key: "supplier", label: "供应商" },
      {
        key: "supply_region",
        label: "供货区域",
        hint: "国家或地区名，如 Russia",
      },
      {
        key: "purchase_region",
        label: "采购区域",
        hint: "国家或地区名，如 Indonesia",
      },
    ],
    columns: [
      { fieldKey: "buyer_name", name: "采购商名称", fieldType: "text" },
      { fieldKey: "industry", name: "行业", fieldType: "text" },
      { fieldKey: "contact_person", name: "联系人", fieldType: "text" },
      { fieldKey: "position", name: "职位", fieldType: "text" },
      { fieldKey: "email", name: "邮箱", fieldType: "text" },
      { fieldKey: "twitter", name: "Twitter", fieldType: "text" },
      { fieldKey: "linkedin", name: "LinkedIn", fieldType: "text" },
      { fieldKey: "phone", name: "电话", fieldType: "text" },
      { fieldKey: "website", name: "官网", fieldType: "text" },
      { fieldKey: "address", name: "地址", fieldType: "text" },
      { fieldKey: "supplier", name: "供应商", fieldType: "text" },
      { fieldKey: "description", name: "采购内容", fieldType: "text" },
      { fieldKey: "supply_region", name: "供货区域", fieldType: "text" },
      { fieldKey: "purchase_region", name: "采购区域", fieldType: "text" },
      { fieldKey: "shipping_port", name: "装运港", fieldType: "text" },
      { fieldKey: "discharge_port", name: "目的港", fieldType: "text" },
      sourceIdColumn,
    ],
  },
  person: {
    key: "person",
    label: "全球商务人士大数据",
    upstreamPath: "/api/person/query",
    tableName: "全球商务人士",
    tableDescription:
      "「全球商务人士大数据」查询结果的承载表：每行一位海外商务人士及其公司、职位与联系方式，源数据ID 用于跨任务去重。",
    example:
      "例：「找美国医疗器械公司里负责采购的负责人，要有邮箱和 LinkedIn，取 30 人」。",
    valueLanguage: "en",
    filters: [
      { key: "first_name", label: "名" },
      { key: "last_name", label: "姓" },
      { key: "email", label: "邮箱" },
      { key: "phone", label: "电话" },
      { key: "company", label: "公司" },
      { key: "position", label: "职位" },
      { key: "industry", label: "行业" },
      { key: "country", label: "国家" },
      { key: "city", label: "城市" },
    ],
    columns: [
      { fieldKey: "first_name", name: "名", fieldType: "text" },
      { fieldKey: "last_name", name: "姓", fieldType: "text" },
      { fieldKey: "email", name: "邮箱", fieldType: "text" },
      { fieldKey: "phone", name: "电话", fieldType: "text" },
      { fieldKey: "social_account", name: "社交账号", fieldType: "text" },
      { fieldKey: "twitter", name: "Twitter", fieldType: "text" },
      { fieldKey: "school", name: "学校", fieldType: "text" },
      { fieldKey: "company", name: "公司", fieldType: "text" },
      { fieldKey: "position", name: "职位", fieldType: "text" },
      { fieldKey: "industry", name: "行业", fieldType: "text" },
      { fieldKey: "country", name: "国家", fieldType: "text" },
      { fieldKey: "city", name: "城市", fieldType: "text" },
      { fieldKey: "address", name: "地址", fieldType: "text" },
      { fieldKey: "linkedin", name: "LinkedIn", fieldType: "text" },
      { fieldKey: "website", name: "官网", fieldType: "text" },
      sourceIdColumn,
    ],
  },
  kol: {
    key: "kol",
    label: "全球达人大数据",
    upstreamPath: "/api/kol/query",
    tableName: "全球达人",
    tableDescription:
      "「全球达人大数据」查询结果的承载表：每行一个达人账号及其平台、类目、粉丝数与商务联系方式，源数据ID 用于跨任务去重。",
    example:
      "例：「找抖音上做美妆、粉丝 50 万以上的达人，要有商务微信，取 60 个」。",
    valueLanguage: "zh",
    filters: [
      {
        key: "channel",
        label: "平台",
        hint: "如 抖音 / 快手 / 小红书 / 微博 / B站 / 视频号",
      },
      { key: "account", label: "账号名" },
      { key: "city", label: "城市" },
      { key: "kol_level", label: "达人等级" },
      { key: "category", label: "类目" },
      { key: "track", label: "赛道" },
      { key: "content_track", label: "内容赛道" },
      { key: "content_format", label: "内容形式" },
      { key: "bd_wechat", label: "商务微信" },
      { key: "bd_phone", label: "商务电话" },
      {
        key: "followers_min",
        label: "最少粉丝数",
        valueType: "number",
        hint: "整数，如 500000",
      },
    ],
    columns: [
      { fieldKey: "channel", name: "平台", fieldType: "text" },
      { fieldKey: "account", name: "账号名", fieldType: "text" },
      { fieldKey: "city", name: "城市", fieldType: "text" },
      { fieldKey: "followers", name: "粉丝数", fieldType: "number" },
      { fieldKey: "kol_level", name: "达人等级", fieldType: "text" },
      { fieldKey: "commission_type", name: "佣金类型", fieldType: "text" },
      { fieldKey: "rating", name: "评级", fieldType: "text" },
      { fieldKey: "category", name: "类目", fieldType: "text" },
      { fieldKey: "bd_wechat", name: "商务微信", fieldType: "text" },
      { fieldKey: "bd_phone", name: "商务电话", fieldType: "text" },
      { fieldKey: "description", name: "简介", fieldType: "text" },
      { fieldKey: "track", name: "赛道", fieldType: "text" },
      { fieldKey: "content_track", name: "内容赛道", fieldType: "text" },
      { fieldKey: "content_format", name: "内容形式", fieldType: "text" },
      sourceIdColumn,
    ],
  },
  poi: {
    key: "poi",
    label: "全球POI大数据",
    upstreamPath: "/api/poi/query",
    tableName: "全球POI地点",
    tableDescription:
      "「全球POI大数据」查询结果的承载表：每行一个兴趣点（门店 / 机构）及其地址、经纬度、行业与联系方式，源数据ID 用于跨任务去重。",
    example: "例：「找广州做家用五金的门店，要电话和经纬度，取 80 个」。",
    valueLanguage: "zh",
    filters: [
      { key: "name", label: "名称关键词" },
      { key: "star", label: "评分", hint: "如 4.5" },
      { key: "city", label: "城市" },
      { key: "district", label: "区县" },
      { key: "street", label: "街道" },
      { key: "country", label: "国家" },
      { key: "region", label: "大区" },
      { key: "industry", label: "行业" },
      { key: "sub_category", label: "子分类" },
      { key: "address", label: "地址关键词" },
      { key: "phone", label: "电话" },
      { key: "email", label: "邮箱" },
      { key: "website", label: "官网" },
      { key: "description", label: "描述关键词" },
    ],
    columns: [
      { fieldKey: "name", name: "名称", fieldType: "text" },
      { fieldKey: "star", name: "评分", fieldType: "text" },
      { fieldKey: "latitude", name: "纬度", fieldType: "text" },
      { fieldKey: "longitude", name: "经度", fieldType: "text" },
      { fieldKey: "address", name: "地址", fieldType: "text" },
      { fieldKey: "city", name: "城市", fieldType: "text" },
      { fieldKey: "district", name: "区县", fieldType: "text" },
      { fieldKey: "street", name: "街道", fieldType: "text" },
      { fieldKey: "region", name: "大区", fieldType: "text" },
      { fieldKey: "country", name: "国家", fieldType: "text" },
      { fieldKey: "postal_code", name: "邮编", fieldType: "text" },
      { fieldKey: "admin_area", name: "行政区", fieldType: "text" },
      { fieldKey: "mailing_town", name: "邮寄城镇", fieldType: "text" },
      { fieldKey: "po_box", name: "邮筒号", fieldType: "text" },
      { fieldKey: "phone", name: "电话", fieldType: "text" },
      { fieldKey: "website", name: "官网", fieldType: "text" },
      { fieldKey: "email", name: "邮箱", fieldType: "text" },
      { fieldKey: "facebook_id", name: "Facebook", fieldType: "text" },
      { fieldKey: "instagram", name: "Instagram", fieldType: "text" },
      { fieldKey: "twitter", name: "Twitter", fieldType: "text" },
      { fieldKey: "industry", name: "行业", fieldType: "text" },
      { fieldKey: "sub_category", name: "子分类", fieldType: "text" },
      { fieldKey: "description", name: "描述", fieldType: "text" },
      sourceIdColumn,
    ],
  },
};

/**
 * 路径里的 `:dataset` 只声明成字符串：五个数据集的合法性由后端 `assertDataset`
 * 判定（报错会带上实际值），契约层再套一层枚举只会把文案换成「请求参数格式不正确」。
 */
export const bigdataSpecSchema = z.object({
  /** 上游请求体的筛选条件（键限该数据集的 filters，值已归一）。 */
  filters: jsonObject,
  /** 本次要写入结果表的行数上限。 */
  limit: z.number(),
  /** 用户这轮需求的场景说明（进提示词，也做任务回显）。 */
  scene: z.string(),
});

export const bigdataSettingsSchema = z.object({
  dataset: z.string(),
  label: z.string(),
  dataTableId: z.number(),
  dataTableExists: z.boolean(),
  /** 结果表模板名（新建默认表时用它）；用户可改名，回显默认表要看下面的实际名。 */
  tableName: z.string(),
  /** 默认结果表在多维表格里的实际表名。 */
  dataTableActualName: z.string(),
  /** 结果表已建时列数（界面提示「N 列」用）。 */
  columnCount: z.number(),
  model: z.string(),
  keyConfigured: z.boolean(),
  keyMasked: z.string(),
  /** 平台 Key 状态读取失败时的原因（空＝读取正常）。 */
  keyStatusError: z.string(),
  ready: z.boolean(),
});

export const bigdataTableResultSchema = z.object({
  created: z.boolean(),
  dataTableId: z.number(),
  name: z.string(),
  fields: z.array(z.string()),
});

export const bigdataChatSchema = z.object({
  reply: z.string(),
  spec: bigdataSpecSchema.nullable(),
  done: z.boolean(),
  elapsedMs: z.number(),
});

export const bigdataMessageSchema = z.object({
  id: z.number(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export const bigdataTaskSchema = z
  .object({
    id: z.number(),
    dataset: z.string(),
    spec: jsonObject,
    rawIntent: z.string(),
    status: z.string(),
    totalFound: z.number(),
    totalSaved: z.number(),
    totalSkipped: z.number(),
    dataTableId: z.number(),
    /** 该任务这一轮写入的多维表格表名（表已删除时为空串）。 */
    dataTableName: z.string(),
    error: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const bigdataTaskPageSchema = z.object({
  list: z.array(bigdataTaskSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const bigdataParams = z.object({ dataset: z.string() });
const bigdataTaskParams = z.object({ dataset: z.string(), id: z.string() });

const leadTaskParams = z.object({ id: z.string() });

// ---------- 阿里云智能外呼 ----------

/** 多维表格列 → 外呼字段的映射；列一律用 fieldKey 指代。 */
export const aliyunCallExtraSchema = z.object({
  /** 写入阿里云 extras 的变量名，需与话术里引用的变量同名。 */
  key: z.string(),
  /** field=取某列的值，fixed=固定值 */
  sourceType: z.enum(["field", "fixed"]),
  fieldKey: z.string().default(""),
  value: z.string().default(""),
});

export const aliyunCallMappingSchema = z.object({
  phoneFieldKey: z.string(),
  nameFieldKey: z.string().default(""),
  /** none=不传，field=取列，gender=按性别列推导，fixed=固定称谓 */
  honorificMode: z.enum(["none", "field", "gender", "fixed"]).default("none"),
  honorificFieldKey: z.string().default(""),
  honorificValue: z.string().default(""),
  genderFieldKey: z.string().default(""),
  roleFieldKey: z.string().default(""),
  extras: z.array(aliyunCallExtraSchema).default([]),
});

export const aliyunCallSettingsSchema = z.object({
  configured: z.boolean(),
  accessKeyIdMasked: z.string(),
  hasSecret: z.boolean(),
  region: z.string(),
  instanceId: z.string(),
  updatedAt: z.string(),
});

export const aliyunCallInstanceSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
});

export const aliyunCallScriptSchema = z.object({
  scriptId: z.string(),
  name: z.string(),
  status: z.string(),
});

export const aliyunCallNumberSchema = z.object({
  number: z.string(),
  bound: z.boolean(),
});

export const aliyunCallTestResultSchema = z.object({
  ok: z.boolean(),
  instances: z.array(aliyunCallInstanceSchema),
  scripts: z.array(aliyunCallScriptSchema),
  numbers: z.array(aliyunCallNumberSchema),
  /** 逐项检查失败的中文原因（空＝三项都通）。 */
  messages: z.array(z.string()),
});

export const aliyunCallJobGroupSchema = z.object({
  jobGroupId: z.string(),
  jobGroupName: z.string(),
  jobGroupStatus: z.string(),
  scriptId: z.string(),
  scriptName: z.string(),
  totalJobs: z.number(),
  completedJobs: z.number(),
  creationTime: z.number(),
  /** 已完成/失败/取消的任务组不允许追加号码。 */
  appendable: z.boolean(),
});

export const aliyunCallJobGroupPageSchema = z.object({
  list: z.array(aliyunCallJobGroupSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const aliyunCallJobGroupStatusSchema = z.object({
  jobGroupId: z.string(),
  jobGroupStatus: z.string(),
  totalJobs: z.number(),
  completedJobs: z.number(),
  executing: z.number(),
  scheduling: z.number(),
  failed: z.number(),
  paused: z.number(),
  cancelled: z.number(),
});

export const aliyunCallPreviewRowSchema = z.object({
  sourceRowId: z.number(),
  name: z.string(),
  phoneMasked: z.string(),
  honorific: z.string(),
  role: z.string(),
  extras: z.array(z.object({ key: z.string(), value: z.string() })),
  /** ok | invalid | duplicate | existing */
  status: z.string(),
  message: z.string(),
});

export const aliyunCallPreviewSchema = z.object({
  fields: z.array(
    z.object({
      fieldKey: z.string(),
      name: z.string(),
      fieldType: z.string(),
    }),
  ),
  totalRows: z.number(),
  validRows: z.number(),
  invalidRows: z.number(),
  duplicateRows: z.number(),
  existingRows: z.number(),
  sample: z.array(aliyunCallPreviewRowSchema),
  /** 映射级错误（缺号码列、变量名非法等），非空时不允许提交。 */
  errors: z.array(z.string()),
});

export const aliyunCallImportRowSchema = z.object({
  id: z.number(),
  sourceRowId: z.number(),
  referenceId: z.string(),
  name: z.string(),
  phoneMasked: z.string(),
  status: z.string(),
  jobId: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
});

export const aliyunCallImportSchema = z.object({
  id: z.number(),
  mode: z.string(),
  tableId: z.number(),
  tableName: z.string(),
  instanceId: z.string(),
  scriptId: z.string(),
  jobGroupId: z.string(),
  jobGroupName: z.string(),
  status: z.string(),
  totalRows: z.number(),
  sentRows: z.number(),
  failedRows: z.number(),
  skippedRows: z.number(),
  errorCode: z.string(),
  errorMessage: z.string(),
  jobGroupStatus: z.string(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const aliyunCallImportDetailSchema = aliyunCallImportSchema.extend({
  mapping: jsonObject,
  rows: z.array(aliyunCallImportRowSchema),
  rowTotal: z.number(),
  rowPage: z.number(),
  rowPageSize: z.number(),
});

export const aliyunCallImportPageSchema = z.object({
  list: z.array(aliyunCallImportSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const aliyunCallJobGroupParams = z.object({ id: z.string() });
const aliyunCallImportParams = z.object({ id: z.string() });
const aliyunCallPageQuery = z.object({
  page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

// ---------- 阿里云邮件推送 ----------

/** 多维表格列 → 模板变量的映射；变量名只能是英文字母（与阿里云模板占位符一致）。 */
export const aliyunMailVariableSchema = z.object({
  key: z.string(),
  fieldKey: z.string(),
});

export const aliyunMailMappingSchema = z.object({
  emailFieldKey: z.string(),
  variables: z.array(aliyunMailVariableSchema).default([]),
  writeBack: z.boolean().default(true),
});

export const aliyunMailSettingsSchema = z.object({
  configured: z.boolean(),
  accessKeyIdMasked: z.string(),
  hasAccessKeySecret: z.boolean(),
  region: z.string(),
  defaultReceiverId: z.string(),
  defaultReceiverName: z.string(),
  updatedAt: z.string(),
});

/** 发信地址（QueryMailAddressByParam）：额度只做提示，不阻断同步。 */
export const aliyunMailSenderSchema = z.object({
  accountName: z.string(),
  mailAddressId: z.string(),
  accountStatus: z.string(),
  domainStatus: z.string(),
  /** batch=批量（群发用） / trigger=触发 */
  sendType: z.string(),
  dailyCount: z.number(),
  dailyReqCount: z.number(),
  monthCount: z.number(),
  monthReqCount: z.number(),
  createTime: z.string(),
});

export const aliyunMailReceiverSchema = z.object({
  receiverId: z.string(),
  receiverName: z.string(),
  receiverAlias: z.string(),
  count: z.number(),
  createTime: z.string(),
});

export const aliyunMailTestResultSchema = z.object({
  ok: z.boolean(),
  /** 当前 Key/地域下可见的收件人列表数量。 */
  receiverCount: z.number(),
  messages: z.array(z.string()),
});

export const aliyunMailPreviewRowSchema = z.object({
  sourceRowId: z.number(),
  emailMasked: z.string(),
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
  /** ok | invalid | duplicate | existing | overflow */
  status: z.string(),
  message: z.string(),
});

export const aliyunMailPreviewSchema = z.object({
  fields: z.array(
    z.object({
      fieldKey: z.string(),
      name: z.string(),
      fieldType: z.string(),
    }),
  ),
  totalRows: z.number(),
  validRows: z.number(),
  invalidRows: z.number(),
  duplicateRows: z.number(),
  /** 本地台账里已经推送到该列表的邮箱。 */
  existingRows: z.number(),
  /** 超出列表剩余容量的行（追加模式才可能出现）。 */
  overflowRows: z.number(),
  /** 目标列表当前人数与剩余容量；新建列表时为 0 与上限。 */
  currentCount: z.number(),
  capacity: z.number(),
  sample: z.array(aliyunMailPreviewRowSchema),
  errors: z.array(z.string()),
});

export const aliyunMailImportRowSchema = z.object({
  id: z.number(),
  sourceRowId: z.number(),
  emailMasked: z.string(),
  status: z.string(),
  errorCode: z.string(),
  errorMessage: z.string(),
});

export const aliyunMailImportSchema = z.object({
  id: z.number(),
  mode: z.string(),
  tableId: z.number(),
  tableName: z.string(),
  receiverId: z.string(),
  receiverName: z.string(),
  status: z.string(),
  totalRows: z.number(),
  sentRows: z.number(),
  failedRows: z.number(),
  skippedRows: z.number(),
  errorCode: z.string(),
  errorMessage: z.string(),
  listCount: z.number(),
  startedAt: z.string(),
  finishedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const aliyunMailImportDetailSchema = aliyunMailImportSchema.extend({
  mapping: jsonObject,
  rows: z.array(aliyunMailImportRowSchema),
  rowTotal: z.number(),
  rowPage: z.number(),
  rowPageSize: z.number(),
});

export const aliyunMailImportPageSchema = z.object({
  list: z.array(aliyunMailImportSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const aliyunMailImportParams = z.object({ id: z.string() });
const aliyunMailPageQuery = z.object({
  page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

// ---------- 腾讯企点营销云（营销工具；凭据按登录账号配置，一个产品一套） ----------

/** 一个产品一套凭据：CDP / SCRM / CA / LM / MA / RTA */
export const tpProducts = ["CDP", "SCRM", "CA", "LM", "MA", "RTA"] as const;
export const tpProductSchema = z.enum(tpProducts);

/** 界面中文标签（禁裸枚举） */
export const TP_PRODUCT_LABELS: Record<string, string> = {
  CDP: "客户数据平台",
  FA: "融合分析看板",
  SCRM: "企微互动",
  CA: "会话分析",
  LM: "会员忠诚度",
  MA: "营销自动化",
  RTA: "广告人群",
  CRM: "本系统CRM",
};

export const tpAccountSchema = z.object({
  id: z.number(),
  product: z.string(),
  productLabel: z.string(),
  label: z.string(),
  gateway: z.string(),
  corporationId: z.string(),
  secretId: z.string(),
  /** secretKey 只写不读：界面永远只看到是否已配置 */
  hasSecretKey: z.boolean(),
  bizId: z.string(),
  status: z.string(),
  lastVerifiedAt: z.string(),
  lastError: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const tpAccountInputSchema = z.object({
  id: z.coerce.number().int().nonnegative().default(0),
  product: tpProductSchema,
  label: z.string().max(191).default(""),
  gateway: z.string().max(191).default("https://tmc.qidian.qq.com"),
  corporationId: z.string().max(64).default(""),
  secretId: z.string().max(128).default(""),
  /** 空串＝保留已存的 secretKey */
  secretKey: z.string().max(256).default(""),
  bizId: z.string().max(64).default(""),
  status: z.enum(["active", "disabled"]).default("active"),
});

export const tpTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** 连接测试实际调用的企点接口 */
  probe: z.string(),
  elapsedMs: z.number(),
});

/**
 * 企点各产品返回的行结构不一致（list / records / rows / items），由后端统一收成
 * rows + total + extra；契约层不写死上游字段名，界面按返回的键渲染。
 */
export const tpRowsSchema = z.object({
  rows: remoteRows,
  total: z.number(),
  extra: jsonObject,
});

export const tpTaskSchema = z.object({
  id: z.number(),
  product: z.string(),
  productLabel: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  tableId: z.number(),
  tableName: z.string(),
  status: z.string(),
  upstreamTaskId: z.string(),
  totalRows: z.number(),
  successRows: z.number(),
  failedRows: z.number(),
  skippedRows: z.number(),
  errorCode: z.string(),
  errorMessage: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const tpTaskEventSchema = z.object({
  id: z.number(),
  level: z.string(),
  message: z.string(),
  payload: jsonObject,
  createdAt: z.string(),
});

export const tpTaskDetailSchema = tpTaskSchema.extend({
  params: jsonObject,
  mapping: jsonObject,
  events: z.array(tpTaskEventSchema),
});

export const tpTaskPageSchema = z.object({
  list: z.array(tpTaskSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

/** 数据集列映射：下次执行同一动作不用再填（在执行时自动记住） */
export const tpMappingSchema = z.object({
  id: z.number(),
  datasetKey: z.string(),
  datasetLabel: z.string(),
  tableId: z.number(),
  tableName: z.string(),
  columnMap: jsonObject,
  updatedAt: z.string(),
});

/** 写类动作的中文标签（列表、任务面板、MCP 说明共用） */
export const TP_ACTION_LABELS: Record<string, string> = {
  Tp_cdpImportCustomers: "批量创建/更新企点客户",
  Tp_cdpApplyTags: "批量打标/移除标签",
  Tp_cdpCreateTag: "创建外部标签",
  Tp_cdpCreateSegment: "外部名单建导入类分群",
  Tp_cdpExportSegment: "分群成员导出",
  Tp_crmImport: "写入本系统CRM客户",
  Tp_scrmSaveCode: "创建/编辑企微活码",
  Tp_scrmSaveMassTask: "创建/编辑群发客户任务",
  Tp_scrmControlMassTask: "停止或催办群发任务",
  Tp_scrmFollowupDone: "完成跟进任务",
  Tp_lmSaveMember: "新建/编辑会员",
  Tp_lmMemberStatus: "启用或停用会员",
  Tp_lmIssuePoints: "发放积分",
  Tp_lmCouponIssue: "发放优惠券",
  Tp_maCreateTemplate: "创建短信/邮件模板",
  Tp_maSaveShortLink: "创建/更新短链",
  Tp_maDeleteShortLink: "删除短链",
  Tp_maMassSend: "创建群发任务",
  Tp_rtaUploadAudience: "上传RTA广告人群",
  Tp_retryTask: "重试任务",
};

/** 任务状态中文标签：台账、通知、写回名单表共用 */
export const TP_STATUS_LABELS: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
};

/** 数据集键：映射与结果写回的维度 */
export const TP_DATASET_LABELS: Record<string, string> = {
  cdp_customer_import: "企点客户写入名单",
  cdp_tag_apply: "标签打标名单",
  cdp_segment_create: "导入类分群名单",
  cdp_segment_export: "分群成员导出结果",
  crm_customer_import: "CRM客户导入名单",
  fa_card_result: "看板图卡结果",
  lm_member_import: "会员写入名单",
  lm_point_issue: "积分发放名单",
  lm_coupon_issue: "优惠券发放名单",
  ma_mass_send: "短信/邮件群发名单",
  rta_audience_upload: "RTA人群上传名单",
};

/** 写入本系统 CRM 的结果：新建 / 重名跳过 / 校验失败 / 批次数 */
export const tpCrmImportResultSchema = z.object({
  taskId: z.number(),
  total: z.number(),
  created: z.number(),
  skipped: z.number(),
  failed: z.number(),
  batches: z.number(),
  message: z.string(),
});

const tpAccountParams = z.object({ id: z.string() });
const tpTaskParams = z.object({ id: z.string() });
const tpIdParams = z.object({ id: z.string() });
const tpTaskIdParams = z.object({ taskId: z.string() });
const tpPageQuery = z.object({
  page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});
const tpAccountQuery = z.object({
  accountId: z.coerce.number().int().nonnegative().default(0),
});
/** 只读清单类端点的共同查询参数：账号 + 分页 + 关键词（其余条件按产品各自透传） */
const tpReadQuery = z
  .object({
    accountId: z.coerce.number().int().nonnegative().default(0),
    page: z.coerce.number().int().positive().max(PAGE_NUMBER_MAX).default(1),
    pageSize: z.coerce.number().int().positive().max(200).default(20),
    keyword: z.string().max(120).default(""),
  })
  .passthrough();

// ---------- 跨境电商商品页优化（PDP） ----------

/**
 * 商品简报：用户只填确定的事实，留空的项由规划模型按品类推断，
 * 推断结果必须在计划的 assumptions 里显式披露（不伪造认证、参数与功效）。
 */
export const ecomPdpBriefSchema = z.object({
  productName: z.string().min(1).max(120),
  category: z.string().max(64).default(""),
  market: z.string().max(32).default("US"),
  platform: z.string().max(32).default("Amazon"),
  audience: z.string().max(200).default(""),
  price: z.string().max(64).default(""),
  sellingPoints: z.string().max(2000).default(""),
  specs: z.string().max(2000).default(""),
  evidence: z.string().max(2000).default(""),
  promo: z.string().max(500).default(""),
  difference: z.string().max(1000).default(""),
  language: z.string().max(32).default("en-US"),
  styleName: z.string().max(120).default(""),
  colorPalette: z.string().max(200).default(""),
  /** 严格合规：不编造参数、认证与医疗/绝对化功效；证据不足的卖点必须写成假设 */
  compliance: z.boolean().default(true),
  heroCount: z.coerce.number().int().min(0).max(10).default(5),
  detailCount: z.coerce.number().int().min(0).max(20).default(8),
  /** 产品参考图（identity reference），最多 6 张，生成时走网关 /images/edits */
  referenceUrls: z.array(z.string().max(1000)).max(6).default([]),
  /** 逐张内容说明：按「主图1：…／详情图1：…」逐行指定每张画面，规划按序号对应生成 */
  shotPlan: z.string().max(4000).default(""),
});

export const ecomPdpAssetSchema = z.object({
  id: z.number(),
  kind: z.string(),
  position: z.number(),
  title: z.string(),
  purpose: z.string(),
  sceneKey: z.string(),
  copy: z.string(),
  prompt: z.string(),
  size: z.string(),
  status: z.string(),
  url: z.string(),
  assetId: z.string(),
  error: z.string(),
});

export const ecomPdpReasonSchema = z.object({
  need: z.string(),
  feature: z.string(),
  benefit: z.string(),
  basis: z.string(),
});

export const ecomPdpStyleLockSchema = z.object({
  styleName: z.string(),
  colorPalette: z.string(),
  backgroundSystem: z.string(),
  lighting: z.string(),
  cameraLanguage: z.string(),
  typography: z.string(),
  layoutRules: z.string(),
  propRules: z.string(),
  productRendering: z.string(),
  negativeRules: z.string(),
});

export const ecomPdpPlanSchema = z.object({
  driver: z.string(),
  driverReason: z.string(),
  buyerReasons: z.array(ecomPdpReasonSchema),
  styleLock: ecomPdpStyleLockSchema,
  assumptions: z.array(z.string()),
  bannedClaims: z.array(z.string()),
});

export const ecomPdpPackSchema = z.object({
  id: z.number(),
  productName: z.string(),
  category: z.string(),
  market: z.string(),
  status: z.string(),
  heroCount: z.number(),
  detailCount: z.number(),
  doneCount: z.number(),
  totalCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ecomPdpPackDetailSchema = ecomPdpPackSchema.extend({
  input: jsonObject,
  plan: ecomPdpPlanSchema.nullable(),
  assets: z.array(ecomPdpAssetSchema),
});

export const ecomPdpPackPageSchema = z.object({
  list: z.array(ecomPdpPackSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const ecomPdpMetaSchema = z.object({
  textReady: z.boolean(),
  imageReady: z.boolean(),
  textLabel: z.string(),
  imageLabel: z.string(),
  hint: z.string(),
});

const ecomPdpParams = z.object({ id: z.string() });
const ecomPdpAssetParams = z.object({ id: z.string(), assetId: z.string() });
const ecomPdpAssetPatchSchema = z
  .object({
    title: z.string().max(191).optional(),
    purpose: z.string().max(191).optional(),
    copy: z.string().max(4000).optional(),
    prompt: z.string().max(8000).optional(),
    size: z.string().max(16).optional(),
  })
  .passthrough();
const ecomPdpGenerateBody = z
  .object({
    prompt: z.string().max(8000).default(""),
    size: z.string().max(16).default(""),
  })
  .passthrough();

// ---------- 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音、1688） ----------

/**
 * 商品简报：国内平台以中文文案与广告法合规为前提，价格与促销只作规划参考，
 * 图面不渲染具体价格（由平台价格叠加区展示，避免与实际不一致）。
 */
export const domesticPdpBriefSchema = z.object({
  productName: z.string().min(1).max(120),
  category: z.string().max(64).default(""),
  platform: z.string().max(32).default("淘宝/天猫"),
  /** 文案语气：brand 品牌质感 / pro 专业参数 / grass 种草分享 / promo 促销冲量 */
  tone: z.string().max(32).default("brand"),
  audience: z.string().max(200).default(""),
  price: z.string().max(64).default(""),
  sellingPoints: z.string().max(2000).default(""),
  specs: z.string().max(2000).default(""),
  evidence: z.string().max(2000).default(""),
  promo: z.string().max(500).default(""),
  difference: z.string().max(1000).default(""),
  styleName: z.string().max(120).default(""),
  colorPalette: z.string().max(200).default(""),
  /** 严格合规：按广告法过滤绝对化用语、医疗功效与无依据的认证/销量/评价 */
  compliance: z.boolean().default(true),
  heroCount: z.coerce.number().int().min(0).max(10).default(5),
  detailCount: z.coerce.number().int().min(0).max(20).default(8),
  /** 产品参考图（identity reference），最多 6 张，生成时走网关 /images/edits */
  referenceUrls: z.array(z.string().max(1000)).max(6).default([]),
  /** 逐张内容说明：按「主图1：…／详情图1：…」逐行指定每张画面，规划按序号对应生成 */
  shotPlan: z.string().max(4000).default(""),
});

export const domesticPdpAssetSchema = z.object({
  id: z.number(),
  kind: z.string(),
  position: z.number(),
  title: z.string(),
  purpose: z.string(),
  sceneKey: z.string(),
  copy: z.string(),
  prompt: z.string(),
  size: z.string(),
  status: z.string(),
  url: z.string(),
  assetId: z.string(),
  error: z.string(),
});

export const domesticPdpReasonSchema = z.object({
  need: z.string(),
  feature: z.string(),
  benefit: z.string(),
  basis: z.string(),
});

export const domesticPdpStyleLockSchema = z.object({
  styleName: z.string(),
  colorPalette: z.string(),
  backgroundSystem: z.string(),
  lighting: z.string(),
  cameraLanguage: z.string(),
  typography: z.string(),
  layoutRules: z.string(),
  propRules: z.string(),
  productRendering: z.string(),
  negativeRules: z.string(),
});

export const domesticPdpPlanSchema = z.object({
  driver: z.string(),
  driverReason: z.string(),
  buyerReasons: z.array(domesticPdpReasonSchema),
  styleLock: domesticPdpStyleLockSchema,
  assumptions: z.array(z.string()),
  bannedClaims: z.array(z.string()),
});

export const domesticPdpPackSchema = z.object({
  id: z.number(),
  productName: z.string(),
  category: z.string(),
  platform: z.string(),
  tone: z.string(),
  status: z.string(),
  heroCount: z.number(),
  detailCount: z.number(),
  doneCount: z.number(),
  totalCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const domesticPdpPackDetailSchema = domesticPdpPackSchema.extend({
  input: jsonObject,
  plan: domesticPdpPlanSchema.nullable(),
  assets: z.array(domesticPdpAssetSchema),
});

export const domesticPdpPackPageSchema = z.object({
  list: z.array(domesticPdpPackSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const domesticPdpMetaSchema = z.object({
  textReady: z.boolean(),
  imageReady: z.boolean(),
  textLabel: z.string(),
  imageLabel: z.string(),
  hint: z.string(),
});

const domesticPdpParams = z.object({ id: z.string() });
const domesticPdpAssetParams = z.object({
  id: z.string(),
  assetId: z.string(),
});
const domesticPdpAssetPatchSchema = z
  .object({
    title: z.string().max(191).optional(),
    purpose: z.string().max(191).optional(),
    copy: z.string().max(4000).optional(),
    prompt: z.string().max(8000).optional(),
    size: z.string().max(16).optional(),
  })
  .passthrough();
const domesticPdpGenerateBody = z
  .object({
    prompt: z.string().max(8000).default(""),
    size: z.string().max(16).default(""),
  })
  .passthrough();

/** 批量动作的共同字段：账号 + 多维表格来源 + 列映射 + 二次确认 */
const tpBatchBody = {
  accountId: z.coerce.number().int().nonnegative().default(0),
  tableId: z.coerce.number().int().positive(),
  tableName: z.string().max(191).default(""),
  mapping: jsonObject.default({}),
  confirmCost: z.boolean().default(false),
};

export const automationEndpoints = {
  // 多维表格（账号归属，四权限位）
  DataTable_list: {
    method: "get" as const,
    path: "/enterprise/data-tables",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(dataTableSchema)),
  },
  DataTable_create: {
    method: "post" as const,
    path: "/enterprise/data-tables",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableSchema),
  },
  DataTable_get: {
    method: "get" as const,
    path: "/enterprise/data-tables/:id",
    params: dataTableParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableSchema),
  },
  DataTable_update: {
    method: "patch" as const,
    path: "/enterprise/data-tables/:id",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableSchema),
  },
  DataTable_remove: {
    method: "delete" as const,
    path: "/enterprise/data-tables/:id",
    params: dataTableParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableRemovedSchema),
  },
  DataTable_grants: {
    method: "get" as const,
    path: "/enterprise/data-tables/:id/grants",
    params: dataTableParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableGrantsSchema),
  },
  DataTable_saveGrants: {
    method: "put" as const,
    path: "/enterprise/data-tables/:id/grants",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableGrantsSchema),
  },
  DataTable_addField: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/fields",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableFieldSchema),
  },
  /** 批量建列：body 是 `{ fields: [建列入参...] }`，模板类建表一次给全部列。 */
  DataTable_addFields: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/fields/batch",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(z.array(dataTableFieldSchema)),
  },
  DataTable_reorderFields: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/fields/reorder",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(
      z.array(z.object({ fieldKey: z.string(), sortOrder: z.number() })),
    ),
  },
  DataTable_updateField: {
    method: "patch" as const,
    path: "/enterprise/data-tables/:id/fields/:fieldId",
    params: dataTableFieldParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableFieldSchema),
  },
  DataTable_removeField: {
    method: "delete" as const,
    path: "/enterprise/data-tables/:id/fields/:fieldId",
    params: dataTableFieldParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableRemovedSchema),
  },
  DataTable_rows: {
    method: "get" as const,
    path: "/enterprise/data-tables/:id/rows",
    params: dataTableParams,
    query: pageQuery(50),
    body: z.undefined(),
    response: envelope(dataTableRowPageSchema),
  },
  DataTable_addRow: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/rows",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableRowSchema),
  },
  DataTable_updateRow: {
    method: "patch" as const,
    path: "/enterprise/data-tables/:id/rows/:rowId",
    params: dataTableRowParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableRowSchema),
  },
  DataTable_removeRow: {
    method: "delete" as const,
    path: "/enterprise/data-tables/:id/rows/:rowId",
    params: dataTableRowParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableRemovedSchema),
  },

  // 飞书多维表格同步（绑定归表归属账号）
  DataTable_feishuSyncs: {
    method: "get" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs",
    params: dataTableParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(dataTableFeishuSyncSchema)),
  },
  DataTable_createFeishuSync: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableFeishuSavedSchema),
  },
  DataTable_updateFeishuSync: {
    method: "patch" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/:syncId",
    params: dataTableFeishuParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableFeishuSavedSchema),
  },
  DataTable_removeFeishuSync: {
    method: "delete" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/:syncId",
    params: dataTableFeishuParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableRemovedSchema),
  },
  /** 用表单里现填或已存的凭据读飞书侧可选的数据表与列。 */
  DataTable_previewFeishuSync: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/preview",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableFeishuPreviewSchema),
  },
  DataTable_testFeishuSync: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/:syncId/test",
    params: dataTableFeishuParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableFeishuTestSchema),
  },
  DataTable_runFeishuSync: {
    method: "post" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/:syncId/run",
    params: dataTableFeishuParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableFeishuRunSchema),
  },
  DataTable_feishuSyncLogs: {
    method: "get" as const,
    path: "/enterprise/data-tables/:id/feishu-syncs/:syncId/logs",
    params: dataTableFeishuParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(dataTableFeishuLogSchema)),
  },

  // 多维表格机器通道（/api/v1，本地 ek_ Key）
  OpenApi_dataTables: {
    method: "get" as const,
    path: "/api/v1/data-tables",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(dataTableSchema)),
  },
  OpenApi_dataTable: {
    method: "get" as const,
    path: "/api/v1/data-tables/:id",
    params: dataTableParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(dataTableSchema),
  },
  OpenApi_dataTableRows: {
    method: "get" as const,
    path: "/api/v1/data-tables/:id/rows",
    params: dataTableParams,
    query: z
      .object({
        limit: z.coerce.number().int().positive().max(500).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
      })
      .passthrough(),
    body: z.undefined(),
    response: envelope(z.array(dataTableRowSchema)),
  },
  OpenApi_dataTableCreateRow: {
    method: "post" as const,
    path: "/api/v1/data-tables/:id/rows",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableRowSchema),
  },
  OpenApi_dataTableCreateRows: {
    method: "post" as const,
    path: "/api/v1/data-tables/:id/rows/batch",
    params: dataTableParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(z.array(dataTableRowSchema)),
  },
  OpenApi_dataTableUpdateRow: {
    method: "patch" as const,
    path: "/api/v1/data-tables/:id/rows/:rowId",
    params: dataTableRowParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(dataTableRowSchema),
  },

  // RPA 界面侧
  Rpa_scripts: {
    method: "get" as const,
    path: "/enterprise/rpa/scripts",
    params: z.object({}),
    query: rpaScriptQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ total: z.number(), list: z.array(rpaScriptSchema) }),
    ),
  },
  Rpa_generateScript: {
    method: "post" as const,
    path: "/enterprise/rpa/scripts/generate",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaGenerateScriptSchema),
  },
  Rpa_script: {
    method: "get" as const,
    path: "/enterprise/rpa/scripts/:id",
    params: rpaScriptParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaScriptDetailSchema),
  },
  Rpa_createScript: {
    method: "post" as const,
    path: "/enterprise/rpa/scripts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaScriptBaseSchema),
  },
  Rpa_updateScript: {
    method: "patch" as const,
    path: "/enterprise/rpa/scripts/:id",
    params: rpaScriptParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaScriptBaseSchema),
  },
  Rpa_removeScript: {
    method: "delete" as const,
    path: "/enterprise/rpa/scripts/:id",
    params: rpaScriptParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Rpa_accounts: {
    method: "get" as const,
    path: "/enterprise/rpa/accounts",
    params: z.object({}),
    query: rpaIdQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaAccountSchema)),
  },
  Rpa_createAccount: {
    method: "post" as const,
    path: "/enterprise/rpa/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaAccountSchema),
  },
  Rpa_updateAccount: {
    method: "patch" as const,
    path: "/enterprise/rpa/accounts/:id",
    params: rpaAccountParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaAccountSchema),
  },
  Rpa_removeAccount: {
    method: "delete" as const,
    path: "/enterprise/rpa/accounts/:id",
    params: rpaAccountParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Rpa_tasks: {
    method: "get" as const,
    path: "/enterprise/rpa/tasks",
    params: z.object({}),
    query: rpaTaskListQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        list: z.array(rpaTaskSchema),
      }),
    ),
  },
  Rpa_createTask: {
    method: "post" as const,
    path: "/enterprise/rpa/tasks",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaTaskSchema),
  },
  Rpa_createTasks: {
    method: "post" as const,
    path: "/enterprise/rpa/tasks/batch",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(z.array(rpaTaskSchema)),
  },
  Rpa_executions: {
    method: "get" as const,
    path: "/enterprise/rpa/executions",
    params: z.object({}),
    query: rpaExecutionListQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaExecutionSchema)),
  },
  Rpa_task: {
    method: "get" as const,
    path: "/enterprise/rpa/tasks/:id",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaTaskSchema),
  },
  Rpa_updateTask: {
    method: "patch" as const,
    path: "/enterprise/rpa/tasks/:id",
    params: rpaTaskParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaTaskSchema),
  },
  Rpa_removeTask: {
    method: "delete" as const,
    path: "/enterprise/rpa/tasks/:id",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Rpa_cancelTask: {
    method: "post" as const,
    path: "/enterprise/rpa/tasks/:id/cancel",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaTaskSchema),
  },
  Rpa_requeueTask: {
    method: "post" as const,
    path: "/enterprise/rpa/tasks/:id/requeue",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaTaskSchema),
  },
  Rpa_taskExecutions: {
    method: "get" as const,
    path: "/enterprise/rpa/tasks/:id/executions",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaExecutionSchema)),
  },
  Rpa_llm: {
    method: "get" as const,
    path: "/enterprise/rpa/llm",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaLlmSettingSchema),
  },
  Rpa_saveLlm: {
    method: "put" as const,
    path: "/enterprise/rpa/llm",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaLlmSettingSchema),
  },
  Rpa_removeLlm: {
    method: "delete" as const,
    path: "/enterprise/rpa/llm",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Rpa_llmModels: {
    method: "get" as const,
    path: "/enterprise/rpa/llm/models",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaLlmModelsSchema),
  },
  Rpa_paramsChat: {
    method: "post" as const,
    path: "/enterprise/rpa/params-chat",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaParamsChatSchema),
  },
  Rpa_settings: {
    method: "get" as const,
    path: "/enterprise/rpa/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaSettingsSchema),
  },
  Rpa_saveSettings: {
    method: "put" as const,
    path: "/enterprise/rpa/settings",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaSettingsSchema),
  },

  // RPA 机器通道
  OpenApi_rpaScripts: {
    method: "get" as const,
    path: "/api/v1/rpa/scripts",
    params: z.object({}),
    query: rpaOpenScriptQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ total: z.number(), list: z.array(rpaScriptSchema) }),
    ),
  },
  OpenApi_rpaScript: {
    method: "get" as const,
    path: "/api/v1/rpa/scripts/:id",
    params: rpaScriptParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaScriptDetailSchema),
  },
  OpenApi_rpaGenerateScript: {
    method: "post" as const,
    path: "/api/v1/rpa/scripts/generate",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaGenerateScriptSchema),
  },
  OpenApi_rpaCreateScript: {
    method: "post" as const,
    path: "/api/v1/rpa/scripts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaScriptBaseSchema),
  },
  OpenApi_rpaAccounts: {
    method: "get" as const,
    path: "/api/v1/rpa/accounts",
    params: z.object({}),
    query: rpaIdQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaAccountSchema)),
  },
  OpenApi_rpaTasks: {
    method: "get" as const,
    path: "/api/v1/rpa/tasks",
    params: z.object({}),
    query: rpaOpenTaskListQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaTaskSchema)),
  },
  OpenApi_rpaTask: {
    method: "get" as const,
    path: "/api/v1/rpa/tasks/:id",
    params: rpaTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaTaskSchema),
  },
  OpenApi_rpaCreateTask: {
    method: "post" as const,
    path: "/api/v1/rpa/tasks",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaTaskSchema),
  },
  OpenApi_rpaExecutions: {
    method: "get" as const,
    path: "/api/v1/rpa/executions",
    params: z.object({}),
    query: rpaExecutionListQuery,
    body: z.undefined(),
    response: envelope(z.array(rpaExecutionSchema)),
  },
  OpenApi_rpaClaimExecution: {
    method: "post" as const,
    path: "/api/v1/rpa/executions/claim",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaDispatchSchema),
  },
  OpenApi_rpaFinishExecution: {
    method: "post" as const,
    path: "/api/v1/rpa/executions/:id/finish",
    params: rpaExecutionParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(rpaExecutionSchema),
  },

  // Workbuddy 企业云
  Workbuddy_accounts: {
    method: "get" as const,
    path: "/enterprise/workbuddy/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(workbuddyAccountSchema)),
  },
  Workbuddy_addAccount: {
    method: "post" as const,
    path: "/enterprise/workbuddy/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyAccountSchema),
  },
  Workbuddy_updateAccount: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/accounts/:id",
    params: workbuddyAccountParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyAccountSchema),
  },
  Workbuddy_removeAccount: {
    method: "delete" as const,
    path: "/enterprise/workbuddy/accounts/:id",
    params: workbuddyAccountParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Workbuddy_verifyAccount: {
    method: "post" as const,
    path: "/enterprise/workbuddy/accounts/:id/verify",
    params: workbuddyAccountParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        ok: z.boolean(),
        agentTotal: z.number(),
        account: workbuddyAccountSchema,
      }),
    ),
  },
  Workbuddy_setting: {
    method: "get" as const,
    path: "/enterprise/workbuddy/setting",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workbuddyLlmSettingSchema),
  },
  Workbuddy_saveSetting: {
    method: "post" as const,
    path: "/enterprise/workbuddy/setting",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyLlmSettingSchema),
  },
  Workbuddy_removeSetting: {
    method: "delete" as const,
    path: "/enterprise/workbuddy/setting",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Workbuddy_models: {
    method: "get" as const,
    path: "/enterprise/workbuddy/models",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workbuddyLlmModelsSchema),
  },
  Workbuddy_agents: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agents",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(workbuddyRemotePageSchema),
  },
  Workbuddy_agentDetail: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agents/detail",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(remoteObject),
  },
  Workbuddy_createAgent: {
    method: "post" as const,
    path: "/enterprise/workbuddy/agents",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Workbuddy_updateAgent: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/agents",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Workbuddy_removeAgent: {
    method: "delete" as const,
    path: "/enterprise/workbuddy/agents",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(z.object({ agentId: z.string() })),
  },
  Workbuddy_agentVersions: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agents/versions",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(workbuddyRemotePageSchema),
  },
  Workbuddy_createAgentVersion: {
    method: "post" as const,
    path: "/enterprise/workbuddy/agents/versions",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Workbuddy_catalogModels: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agent-catalog/models",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(remoteRows),
  },
  Workbuddy_catalogSkills: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agent-catalog/skills",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(workbuddyCatalogPageSchema),
  },
  Workbuddy_catalogExperts: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agent-catalog/experts",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(workbuddyCatalogPageSchema),
  },
  Workbuddy_catalogConnectors: {
    method: "get" as const,
    path: "/enterprise/workbuddy/agent-catalog/connectors",
    params: z.object({}),
    query: workbuddyCredentialQuery,
    body: z.undefined(),
    response: envelope(remoteRows),
  },
  Workbuddy_plans: {
    method: "get" as const,
    path: "/enterprise/workbuddy/plans",
    params: z.object({}),
    query: workbuddyPlanListQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        items: z.array(workbuddyPlanSchema),
        counts: z.record(z.string(), z.number()),
      }),
    ),
  },
  Workbuddy_createPlan: {
    method: "post" as const,
    path: "/enterprise/workbuddy/plans",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyPlanSchema),
  },
  Workbuddy_plan: {
    method: "get" as const,
    path: "/enterprise/workbuddy/plans/:id",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workbuddyPlanDetailSchema),
  },
  Workbuddy_updatePlan: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/plans/:id",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyPlanSchema),
  },
  Workbuddy_removePlan: {
    method: "delete" as const,
    path: "/enterprise/workbuddy/plans/:id",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Workbuddy_clarify: {
    method: "post" as const,
    path: "/enterprise/workbuddy/plans/clarify",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyClarifySchema),
  },
  Workbuddy_materialize: {
    method: "post" as const,
    path: "/enterprise/workbuddy/plans/:id/materialize",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyPlanSchema),
  },
  Workbuddy_addPlanTask: {
    method: "post" as const,
    path: "/enterprise/workbuddy/plans/:id/tasks",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyTaskSchema),
  },
  Workbuddy_dispatchPlan: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/plans/:id/dispatch",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(
      z.object({
        dispatched: z.number(),
        failed: z.number(),
        plan: workbuddyPlanSchema,
        errors: z.array(z.string()),
      }),
    ),
  },
  Workbuddy_syncPlan: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/plans/:id/sync",
    params: workbuddyPlanParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(
      z.object({
        synced: z.number(),
        errors: z.array(z.string()).optional(),
        plan: workbuddyPlanSchema,
      }),
    ),
  },
  Workbuddy_updateTask: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/tasks/:id",
    params: workbuddyTaskParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyTaskSchema),
  },
  Workbuddy_removeTask: {
    method: "delete" as const,
    path: "/enterprise/workbuddy/tasks/:id",
    params: workbuddyTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  Workbuddy_taskEvents: {
    method: "get" as const,
    path: "/enterprise/workbuddy/tasks/:id/events",
    params: workbuddyTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({ task: workbuddyTaskSchema, events: remoteRows }),
    ),
  },
  Workbuddy_followUpTask: {
    method: "post" as const,
    path: "/enterprise/workbuddy/tasks/:id/follow-up",
    params: workbuddyTaskParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(workbuddyTaskSchema),
  },
  Workbuddy_cancelTask: {
    method: "patch" as const,
    path: "/enterprise/workbuddy/tasks/:id/cancel",
    params: workbuddyTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(workbuddyTaskSchema),
  },

  // AI 调用账号
  AiCall_accounts: {
    method: "get" as const,
    path: "/enterprise/ai-call/accounts",
    params: z.object({}),
    query: aiCallListQuery,
    body: z.undefined(),
    response: envelope(z.array(aiCallAccountSchema)),
  },
  AiCall_account: {
    method: "get" as const,
    path: "/enterprise/ai-call/accounts/:id",
    params: aiCallParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aiCallAccountSchema),
  },
  AiCall_createAccount: {
    method: "post" as const,
    path: "/enterprise/ai-call/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aiCallAccountSchema),
  },
  AiCall_updateAccount: {
    method: "patch" as const,
    path: "/enterprise/ai-call/accounts/:id",
    params: aiCallParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aiCallAccountSchema),
  },
  AiCall_removeAccount: {
    method: "delete" as const,
    path: "/enterprise/ai-call/accounts/:id",
    params: aiCallParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number() })),
  },
  OpenApi_aiCallAccounts: {
    method: "get" as const,
    path: "/api/v1/ai-call/accounts",
    params: z.object({}),
    query: aiCallOpenListQuery,
    body: z.undefined(),
    response: envelope(z.array(aiCallAccountSchema)),
  },
  OpenApi_aiCallCredentials: {
    method: "get" as const,
    path: "/api/v1/ai-call/accounts/:id/credentials",
    params: aiCallParams,
    query: aiCallOpenCredentialsQuery,
    body: z.undefined(),
    response: envelope(aiCallCredentialsSchema),
  },

  // Google 潜客线索挖掘（营销服务）
  Lead_settings: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadSettingsSchema),
  },
  Lead_saveSettings: {
    method: "put" as const,
    path: "/enterprise/lead-prospecting/settings",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(leadSettingsSchema),
  },
  Lead_removeSerperKey: {
    method: "delete" as const,
    path: "/enterprise/lead-prospecting/settings/serper-key",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadSettingsSchema),
  },
  Lead_createTable: {
    method: "post" as const,
    path: "/enterprise/lead-prospecting/data-table",
    params: z.object({}),
    query: emptyQuery,
    body: createTableBody,
    response: envelope(leadTableResultSchema),
  },
  Lead_tables: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/tables",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(resultTableOptionsSchema),
  },
  Lead_models: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/models",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaLlmModelsSchema),
  },
  Lead_chat: {
    method: "post" as const,
    path: "/enterprise/lead-prospecting/chat",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(leadChatSchema),
  },
  Lead_messages: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/messages",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(leadMessageSchema)),
  },
  Lead_tasks: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/tasks",
    params: z.object({}),
    query: pageQuery(20),
    body: z.undefined(),
    response: envelope(leadTaskPageSchema),
  },
  Lead_createTask: {
    method: "post" as const,
    path: "/enterprise/lead-prospecting/tasks",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(leadTaskSchema),
  },
  Lead_task: {
    method: "get" as const,
    path: "/enterprise/lead-prospecting/tasks/:id",
    params: leadTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadTaskSchema),
  },
  Lead_startTask: {
    method: "post" as const,
    path: "/enterprise/lead-prospecting/tasks/:id/start",
    params: leadTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(leadTaskSchema),
  },
  Lead_updateTaskTable: {
    method: "patch" as const,
    path: "/enterprise/lead-prospecting/tasks/:id/table",
    params: leadTaskParams,
    query: emptyQuery,
    body: updateTaskTableBody,
    response: envelope(leadTaskSchema),
  },
  Lead_removeTask: {
    method: "delete" as const,
    path: "/enterprise/lead-prospecting/tasks/:id",
    params: leadTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), deleted: z.boolean() })),
  },

  // 大数据查询（营销工具：五个独立数据集，路径里的 :dataset 决定用哪张结果表）
  Bigdata_settings: {
    method: "get" as const,
    path: "/enterprise/bigdata/:dataset/settings",
    params: bigdataParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(bigdataSettingsSchema),
  },
  Bigdata_saveSettings: {
    method: "put" as const,
    path: "/enterprise/bigdata/:dataset/settings",
    params: bigdataParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(bigdataSettingsSchema),
  },
  Bigdata_createTable: {
    method: "post" as const,
    path: "/enterprise/bigdata/:dataset/data-table",
    params: bigdataParams,
    query: emptyQuery,
    body: createTableBody,
    response: envelope(bigdataTableResultSchema),
  },
  Bigdata_tables: {
    method: "get" as const,
    path: "/enterprise/bigdata/:dataset/tables",
    params: bigdataParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(resultTableOptionsSchema),
  },
  Bigdata_models: {
    method: "get" as const,
    path: "/enterprise/bigdata/models",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(rpaLlmModelsSchema),
  },
  Bigdata_chat: {
    method: "post" as const,
    path: "/enterprise/bigdata/:dataset/chat",
    params: bigdataParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(bigdataChatSchema),
  },
  Bigdata_messages: {
    method: "get" as const,
    path: "/enterprise/bigdata/:dataset/messages",
    params: bigdataParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(bigdataMessageSchema)),
  },
  Bigdata_tasks: {
    method: "get" as const,
    path: "/enterprise/bigdata/:dataset/tasks",
    params: bigdataParams,
    query: pageQuery(20),
    body: z.undefined(),
    response: envelope(bigdataTaskPageSchema),
  },
  Bigdata_createTask: {
    method: "post" as const,
    path: "/enterprise/bigdata/:dataset/tasks",
    params: bigdataParams,
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(bigdataTaskSchema),
  },
  Bigdata_task: {
    method: "get" as const,
    path: "/enterprise/bigdata/:dataset/tasks/:id",
    params: bigdataTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(bigdataTaskSchema),
  },
  Bigdata_startTask: {
    method: "post" as const,
    path: "/enterprise/bigdata/:dataset/tasks/:id/start",
    params: bigdataTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(bigdataTaskSchema),
  },
  Bigdata_updateTaskTable: {
    method: "patch" as const,
    path: "/enterprise/bigdata/:dataset/tasks/:id/table",
    params: bigdataTaskParams,
    query: emptyQuery,
    body: updateTaskTableBody,
    response: envelope(bigdataTaskSchema),
  },
  Bigdata_removeTask: {
    method: "delete" as const,
    path: "/enterprise/bigdata/:dataset/tasks/:id",
    params: bigdataTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), deleted: z.boolean() })),
  },

  // 阿里云智能外呼（营销工具；AK 按登录账号配置）
  AliyunCall_settings: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunCallSettingsSchema),
  },
  AliyunCall_saveSettings: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/settings",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunCallSettingsSchema),
  },
  AliyunCall_test: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunCallTestResultSchema),
  },
  AliyunCall_instances: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/instances",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(aliyunCallInstanceSchema)),
  },
  AliyunCall_scripts: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/scripts",
    params: z.object({}),
    query: z.object({ instanceId: z.string().default("") }).passthrough(),
    body: z.undefined(),
    response: envelope(z.array(aliyunCallScriptSchema)),
  },
  AliyunCall_callingNumbers: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/calling-numbers",
    params: z.object({}),
    query: z.object({ instanceId: z.string().default("") }).passthrough(),
    body: z.undefined(),
    response: envelope(z.array(aliyunCallNumberSchema)),
  },
  AliyunCall_jobGroups: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/job-groups",
    params: z.object({}),
    query: z
      .object({
        instanceId: z.string().default(""),
        search: z.string().default(""),
        page: z.coerce
          .number()
          .int()
          .positive()
          .max(PAGE_NUMBER_MAX)
          .default(1),
        pageSize: z.coerce.number().int().positive().max(200).default(20),
      })
      .passthrough(),
    body: z.undefined(),
    response: envelope(aliyunCallJobGroupPageSchema),
  },
  AliyunCall_jobGroupStatus: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/job-groups/:id/status",
    params: aliyunCallJobGroupParams,
    query: z.object({ instanceId: z.string().default("") }).passthrough(),
    body: z.undefined(),
    response: envelope(aliyunCallJobGroupStatusSchema),
  },
  AliyunCall_preview: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/preview",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunCallPreviewSchema),
  },
  AliyunCall_createImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/imports",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunCallImportSchema),
  },
  AliyunCall_imports: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/imports",
    params: z.object({}),
    query: aliyunCallPageQuery,
    body: z.undefined(),
    response: envelope(aliyunCallImportPageSchema),
  },
  AliyunCall_import: {
    method: "get" as const,
    path: "/enterprise/aliyun-call/imports/:id",
    params: aliyunCallImportParams,
    query: pageQuery(50),
    body: z.undefined(),
    response: envelope(aliyunCallImportDetailSchema),
  },
  AliyunCall_retryImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/imports/:id/retry",
    params: aliyunCallImportParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunCallImportSchema),
  },
  AliyunCall_refreshImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-call/imports/:id/refresh",
    params: aliyunCallImportParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunCallImportSchema),
  },

  // 阿里云邮件推送（营销工具；AK 按登录账号配置）
  AliyunMail_settings: {
    method: "get" as const,
    path: "/enterprise/aliyun-mail/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunMailSettingsSchema),
  },
  AliyunMail_saveSettings: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/settings",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunMailSettingsSchema),
  },
  AliyunMail_test: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/test",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunMailTestResultSchema),
  },
  AliyunMail_senderAddresses: {
    method: "get" as const,
    path: "/enterprise/aliyun-mail/sender-addresses",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(aliyunMailSenderSchema)),
  },
  AliyunMail_receiverLists: {
    method: "get" as const,
    path: "/enterprise/aliyun-mail/receiver-lists",
    params: z.object({}),
    query: z.object({ keyWord: z.string().default("") }).passthrough(),
    body: z.undefined(),
    response: envelope(z.array(aliyunMailReceiverSchema)),
  },
  AliyunMail_createReceiverList: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/receiver-lists",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunMailReceiverSchema),
  },
  AliyunMail_preview: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/preview",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunMailPreviewSchema),
  },
  AliyunMail_createImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/imports",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(aliyunMailImportSchema),
  },
  AliyunMail_imports: {
    method: "get" as const,
    path: "/enterprise/aliyun-mail/imports",
    params: z.object({}),
    query: aliyunMailPageQuery,
    body: z.undefined(),
    response: envelope(aliyunMailImportPageSchema),
  },
  AliyunMail_import: {
    method: "get" as const,
    path: "/enterprise/aliyun-mail/imports/:id",
    params: aliyunMailImportParams,
    query: pageQuery(50),
    body: z.undefined(),
    response: envelope(aliyunMailImportDetailSchema),
  },
  AliyunMail_retryImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/imports/:id/retry",
    params: aliyunMailImportParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunMailImportSchema),
  },
  AliyunMail_refreshImport: {
    method: "post" as const,
    path: "/enterprise/aliyun-mail/imports/:id/refresh",
    params: aliyunMailImportParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(aliyunMailImportSchema),
  },

  // 腾讯企点营销云（营销工具；一个产品一套凭据，按登录账号配置）
  // 注释里的斜杠路径＝企点网关 `/api/gateway/v1` 之后的真实上游路径（逐篇取自官方文档正文）。
  Tp_accounts: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(tpAccountSchema)),
  },
  Tp_saveAccount: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/accounts",
    params: z.object({}),
    query: emptyQuery,
    body: tpAccountInputSchema,
    response: envelope(tpAccountSchema),
  },
  Tp_deleteAccount: {
    method: "delete" as const,
    path: "/enterprise/tencent-qidian/accounts/:id",
    params: tpAccountParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), deleted: z.boolean() })),
  },
  Tp_testAccount: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/accounts/:id/test",
    params: tpAccountParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(tpTestResultSchema),
  },

  // 客户数据平台 CDP：/cdp-entity/... 、/cdp-tag/... 、/cdp-crowd/...
  Tp_cdpProperties: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/cdp/properties",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_cdpCustomerDetail: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/customers/detail",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_cdpCustomerTrace: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/customers/trace",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_cdpCustomerTags: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/customers/tags",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_cdpImportCustomers: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/customers/import",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        mode: z.enum(["create", "update"]).default("create"),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },
  Tp_cdpCreateTag: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/tags",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_cdpApplyTags: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/tags/apply",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        tagId: z.string().max(64),
        entityKey: z.string().max(64).default("oneid"),
        opType: z.enum(["add", "remove"]).default("add"),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },
  Tp_cdpSegments: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/cdp/segments",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_cdpSegmentDetail: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/cdp/segments/:id",
    params: tpIdParams,
    query: tpAccountQuery,
    body: z.undefined(),
    response: envelope(remoteObject),
  },
  Tp_cdpExportSegment: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/segments/:id/export",
    params: tpIdParams,
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        exportSaKey: z.string().max(64).default("oneid"),
        tableId: z.coerce.number().int().nonnegative().default(0),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },
  Tp_cdpCreateSegment: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/cdp/segments/import",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        crowdName: z.string().min(1).max(191),
        identityId: z.string().max(64).default(""),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },
  Tp_cdpTaskRecord: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/cdp/task-records/:taskId",
    params: tpTaskIdParams,
    query: tpAccountQuery,
    body: z.undefined(),
    response: envelope(remoteObject),
  },

  // 写入本系统 CRM：不出网，直接调 CRM 自己的导入服务
  Tp_crmImport: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/crm/import",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        /** 分群来源不需要本地表；由服务端按来源校验，缺表时给中文提示 */
        tableId: z.coerce.number().int().nonnegative().default(0),
        /** 来源：多维表格行 / 企点分群成员（先取回表格再写 CRM） */
        source: z.enum(["data_table", "cdp_segment"]).default("data_table"),
        crowdId: z.string().max(64).default(""),
      })
      .passthrough(),
    response: envelope(tpCrmImportResultSchema),
  },

  // 融合分析 FA：/apiserver/openapi/... 只读取数
  Tp_faBoards: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/fa/boards",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_faCards: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/fa/boards/:id/cards",
    params: tpIdParams,
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_faCardResult: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/fa/cards/result",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_faAsyncResult: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/fa/cards/async-result",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },

  // 企微互动 SCRM：query 必带 wxworkCorpId / wxworkAgentId（活码、群发、跟进、组织架构）
  Tp_scrmCodes: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/scrm/codes",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_scrmSaveCode: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/codes",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_scrmDeleteCode: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/codes/delete",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_scrmWelcome: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/welcome",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_scrmOrgs: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/orgs",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_scrmMassTasks: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/scrm/mass-tasks",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_scrmMassTaskStats: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/mass-tasks/stats",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_scrmMassTaskExecution: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/mass-tasks/execution",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_scrmSaveMassTask: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/mass-tasks",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        taskId: z.string().max(64).default(""),
        payload: jsonObject.default({}),
        confirmCost: z.boolean().default(false),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_scrmControlMassTask: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/mass-tasks/control",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        taskId: z.string().min(1).max(64),
        op: z.enum(["stop", "remind"]),
        confirmCost: z.boolean().default(false),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_scrmFollowups: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/scrm/followups",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_scrmFollowupCustomers: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/followups/customers",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_scrmFollowupDone: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/scrm/followups/done",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        taskId: z.string().min(1).max(64),
        customerId: z.string().min(1).max(64),
        staffId: z.string().min(1).max(64),
        confirmCost: z.boolean().default(false),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },

  // 会话分析 CA：/ca-web/... 与 /ca-lite/...
  Tp_caMessages: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/ca/messages",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_caTagTasks: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ca/tag-tasks",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_caTagDetail: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ca/tag-tasks/:id",
    params: tpIdParams,
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_caResponseStats: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ca/response-stats",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },

  // 会员忠诚度 LM：/loyalty-member/... 、/loyalty-level/... 、/loyalty-coupon/...
  Tp_lmPrograms: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/lm/programs",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_lmMembers: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/members/search",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_lmSaveMember: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/members",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        memberId: z.string().max(64).default(""),
        payload: jsonObject.default({}),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_lmMemberStatus: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/members/status",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        memberId: z.string().min(1).max(64),
        op: z.enum(["activate", "inactivate"]),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_lmPoints: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/points/search",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(tpRowsSchema),
  },
  Tp_lmIssuePoints: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/points/issue",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        programId: z.string().min(1).max(64),
        point: z.coerce.number().int(),
        eventName: z.string().max(191).default("本系统发放"),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },
  Tp_lmCoupons: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/lm/coupons",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_lmCouponIssue: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/lm/coupons/issue",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        couponId: z.string().min(1).max(64),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },

  // 营销自动化 MA：/ma-web/... 通道、模板、短链、群发任务
  Tp_maChannels: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ma/channels",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_maSenders: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ma/senders",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_maTemplates: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ma/templates",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_maCreateTemplate: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/ma/templates",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        type: z.enum(["sms", "email"]),
        payload: jsonObject.default({}),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_maShortLinks: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/ma/short-links",
    params: z.object({}),
    query: tpReadQuery,
    body: z.undefined(),
    response: envelope(tpRowsSchema),
  },
  Tp_maSaveShortLink: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/ma/short-links",
    params: z.object({}),
    query: emptyQuery,
    body: passthroughBody,
    response: envelope(remoteObject),
  },
  Tp_maDeleteShortLink: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/ma/short-links/delete",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        accountId: z.coerce.number().int().nonnegative().default(0),
        uniqueId: z.string().min(1).max(64),
      })
      .passthrough(),
    response: envelope(remoteObject),
  },
  Tp_maMassSend: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/ma/mass-send",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        channelType: z.enum(["sms", "email"]),
        templateId: z.string().min(1).max(64),
        name: z.string().min(1).max(191),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },

  // 广告分析 RTA：/rta/crowd/open/import/v2 人群上传
  Tp_rtaUploadAudience: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/rta/audiences",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        ...tpBatchBody,
        crowdName: z.string().min(1).max(191),
        dataType: z.string().max(32).default("mobile"),
        /** 已在企点「广告授权」里绑定的广告主账号；空＝未绑定，界面不渲染上传 */
        advertiserId: z.string().max(64).default(""),
      })
      .passthrough(),
    response: envelope(tpTaskSchema),
  },

  // 任务台账与重试
  Tp_tasks: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/tasks",
    params: z.object({}),
    query: tpPageQuery,
    body: z.undefined(),
    response: envelope(tpTaskPageSchema),
  },
  Tp_taskDetail: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/tasks/:id",
    params: tpTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(tpTaskDetailSchema),
  },
  Tp_retryTask: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/tasks/:id/retry",
    params: tpTaskParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(tpTaskSchema),
  },

  // 列映射（执行时自动记住）
  Tp_mappings: {
    method: "get" as const,
    path: "/enterprise/tencent-qidian/mappings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(tpMappingSchema)),
  },
  Tp_saveMapping: {
    method: "post" as const,
    path: "/enterprise/tencent-qidian/mappings",
    params: z.object({}),
    query: emptyQuery,
    body: z
      .object({
        datasetKey: z.string().min(1).max(64),
        tableId: z.coerce.number().int().positive(),
        tableName: z.string().max(191).default(""),
        columnMap: jsonObject.default({}),
      })
      .passthrough(),
    response: envelope(tpMappingSchema),
  },

  // 跨境电商商品页优化（PDP）：简报 → 规划（文本槽位）→ 逐张提示词确认 → 网关出图（图片槽位）
  EcomPdp_meta: {
    method: "get" as const,
    path: "/enterprise/ecom-pdp/meta",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(ecomPdpMetaSchema),
  },
  EcomPdp_page: {
    method: "get" as const,
    path: "/enterprise/ecom-pdp/packs",
    params: z.object({}),
    query: pageQuery(20),
    body: z.undefined(),
    response: envelope(ecomPdpPackPageSchema),
  },
  EcomPdp_detail: {
    method: "get" as const,
    path: "/enterprise/ecom-pdp/packs/:id",
    params: ecomPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(ecomPdpPackDetailSchema),
  },
  EcomPdp_create: {
    method: "post" as const,
    path: "/enterprise/ecom-pdp/packs",
    params: z.object({}),
    query: emptyQuery,
    body: ecomPdpBriefSchema,
    response: envelope(ecomPdpPackDetailSchema),
  },
  EcomPdp_plan: {
    method: "post" as const,
    path: "/enterprise/ecom-pdp/packs/:id/plan",
    params: ecomPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(ecomPdpPackDetailSchema),
  },
  EcomPdp_updateAsset: {
    method: "patch" as const,
    path: "/enterprise/ecom-pdp/packs/:id/assets/:assetId",
    params: ecomPdpAssetParams,
    query: emptyQuery,
    body: ecomPdpAssetPatchSchema,
    response: envelope(ecomPdpPackDetailSchema),
  },
  EcomPdp_generate: {
    method: "post" as const,
    path: "/enterprise/ecom-pdp/packs/:id/assets/:assetId/generate",
    params: ecomPdpAssetParams,
    query: emptyQuery,
    body: ecomPdpGenerateBody,
    response: envelope(ecomPdpPackDetailSchema),
  },
  EcomPdp_remove: {
    method: "delete" as const,
    path: "/enterprise/ecom-pdp/packs/:id",
    params: ecomPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), deleted: z.boolean() })),
  },

  // 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音）：简报 → 规划（文本槽位）→
  // 逐张提示词确认 → 网关出图（图片槽位）
  DomesticPdp_meta: {
    method: "get" as const,
    path: "/enterprise/domestic-pdp/meta",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(domesticPdpMetaSchema),
  },
  DomesticPdp_page: {
    method: "get" as const,
    path: "/enterprise/domestic-pdp/packs",
    params: z.object({}),
    query: pageQuery(20),
    body: z.undefined(),
    response: envelope(domesticPdpPackPageSchema),
  },
  DomesticPdp_detail: {
    method: "get" as const,
    path: "/enterprise/domestic-pdp/packs/:id",
    params: domesticPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(domesticPdpPackDetailSchema),
  },
  DomesticPdp_create: {
    method: "post" as const,
    path: "/enterprise/domestic-pdp/packs",
    params: z.object({}),
    query: emptyQuery,
    body: domesticPdpBriefSchema,
    response: envelope(domesticPdpPackDetailSchema),
  },
  DomesticPdp_plan: {
    method: "post" as const,
    path: "/enterprise/domestic-pdp/packs/:id/plan",
    params: domesticPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(domesticPdpPackDetailSchema),
  },
  DomesticPdp_updateAsset: {
    method: "patch" as const,
    path: "/enterprise/domestic-pdp/packs/:id/assets/:assetId",
    params: domesticPdpAssetParams,
    query: emptyQuery,
    body: domesticPdpAssetPatchSchema,
    response: envelope(domesticPdpPackDetailSchema),
  },
  DomesticPdp_generate: {
    method: "post" as const,
    path: "/enterprise/domestic-pdp/packs/:id/assets/:assetId/generate",
    params: domesticPdpAssetParams,
    query: emptyQuery,
    body: domesticPdpGenerateBody,
    response: envelope(domesticPdpPackDetailSchema),
  },
  DomesticPdp_remove: {
    method: "delete" as const,
    path: "/enterprise/domestic-pdp/packs/:id",
    params: domesticPdpParams,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ id: z.number(), deleted: z.boolean() })),
  },
} as const;

export type AutomationEndpoints = typeof automationEndpoints;
