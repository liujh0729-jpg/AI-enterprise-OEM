import { z } from "zod";
import { pageQuerySchema, pageSchema } from "./pagination";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});
const idParam = z.object({ id: z.string() });

export const BI_ROLES = ["ADMIN", "EDITOR", "ANALYST", "VIEWER"] as const;
export const BI_ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  EDITOR: "编辑",
  ANALYST: "分析",
  VIEWER: "只读",
};
export const BI_DATASOURCE_TYPES = ["PG", "MYSQL"] as const;
export const BI_DATASOURCE_TYPE_LABELS: Record<string, string> = {
  PG: "PostgreSQL",
  MYSQL: "MySQL",
};
export const BI_DATASET_TYPES = ["INTERNAL", "TABLE", "SQL"] as const;
export const BI_DATASET_TYPE_LABELS: Record<string, string> = {
  INTERNAL: "内置数据集",
  TABLE: "表数据集",
  SQL: "SQL 数据集",
};
export const BI_CHART_TYPES = [
  "TABLE",
  "METRIC",
  "BAR",
  "LINE",
  "AREA",
  "PIE",
  "DONUT",
  "SCATTER",
  "FUNNEL",
] as const;
export const BI_CHART_TYPE_LABELS: Record<string, string> = {
  TABLE: "表格",
  METRIC: "指标卡",
  BAR: "柱状图",
  LINE: "折线图",
  AREA: "面积图",
  PIE: "饼图",
  DONUT: "环形图",
  SCATTER: "散点图",
  FUNNEL: "漏斗图",
};
export const BI_INTERNAL_DATASETS = [
  {
    key: "LEADS",
    name: "CRM 线索",
    description: "线索名称、来源、阶段、负责人、跟进时间与金额字段",
  },
  {
    key: "CUSTOMERS",
    name: "CRM 客户",
    description: "客户名称、负责人、行业、地区、最近跟进",
  },
  {
    key: "OPPORTUNITIES",
    name: "CRM 商机",
    description: "商机名称、客户、阶段、金额、赢率、预计成交",
  },
  {
    key: "CONTRACTS",
    name: "CRM 合同",
    description: "销售合同金额、阶段、审批状态、已回款",
  },
  {
    key: "PAYMENTS",
    name: "CRM 回款",
    description: "回款计划金额、已回款、计划日期、逾期",
  },
  {
    key: "ORDERS",
    name: "CRM 订单",
    description: "订单金额、阶段、审批状态、客户",
  },
] as const;

const datasourceRow = z
  .object({
    id: z.number(),
    name: z.string(),
    kind: z.string(),
    type: z.string(),
    typeLabel: z.string(),
    host: z.string(),
    port: z.number(),
    database: z.string(),
    schema: z.string(),
    username: z.string(),
    ssl: z.boolean(),
    status: z.string(),
    lastTestAt: z.string(),
    lastError: z.string(),
    tableCount: z.number(),
    hasPassword: z.boolean(),
  })
  .passthrough();

const tableRow = z
  .object({
    id: z.number(),
    datasourceId: z.number(),
    tableName: z.string(),
    tableComment: z.string(),
    enabled: z.boolean(),
    fields: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

const datasetRow = z
  .object({
    id: z.number(),
    groupId: z.number(),
    groupName: z.string(),
    name: z.string(),
    type: z.string(),
    typeLabel: z.string(),
    datasourceId: z.number(),
    datasourceName: z.string(),
    internalKey: z.string(),
    sqlText: z.string(),
    description: z.string(),
    status: z.string(),
    fieldCount: z.number(),
    chartCount: z.number(),
    updatedAt: z.string(),
  })
  .passthrough();

const datasetFieldRow = z
  .object({
    id: z.number(),
    datasetId: z.number(),
    fieldKey: z.string(),
    name: z.string(),
    type: z.string(),
    comment: z.string(),
    role: z.string(),
    aggregate: z.string(),
    expression: z.string(),
    format: z.string(),
    sort: z.number(),
    visible: z.boolean(),
  })
  .passthrough();

const chartRow = z
  .object({
    id: z.number(),
    datasetId: z.number(),
    datasetName: z.string(),
    name: z.string(),
    chartType: z.string(),
    chartTypeLabel: z.string(),
    config: z.record(z.string(), z.unknown()),
    status: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const dashboardRow = z
  .object({
    id: z.number(),
    name: z.string(),
    layout: z.array(z.record(z.string(), z.unknown())),
    config: z.record(z.string(), z.unknown()),
    componentCount: z.number(),
    updatedAt: z.string(),
  })
  .passthrough();

const sessionRow = z
  .object({
    id: z.number(),
    datasetId: z.number(),
    datasetName: z.string(),
    title: z.string(),
    messageCount: z.number(),
    updatedAt: z.string(),
  })
  .passthrough();

const messageRow = z
  .object({
    id: z.number(),
    sessionId: z.number(),
    role: z.string(),
    question: z.string(),
    sqlText: z.string(),
    resultPreview: z.array(z.record(z.string(), z.unknown())),
    chartConfig: z.record(z.string(), z.unknown()),
    analysis: z.string(),
    followups: z.array(z.string()),
    status: z.string(),
    error: z.string(),
    elapsedMs: z.number(),
    tokens: z.number(),
    feedback: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

const askResult = z
  .object({
    messageId: z.number(),
    sessionId: z.number(),
    sql: z.string(),
    rows: z.array(z.record(z.string(), z.unknown())),
    columns: z.array(
      z.object({ key: z.string(), label: z.string(), type: z.string() }),
    ),
    chart: z.record(z.string(), z.unknown()),
    analysis: z.string(),
    followups: z.array(z.string()),
    rowCount: z.number(),
    elapsedMs: z.number(),
    truncated: z.boolean(),
  })
  .passthrough();

export const biEndpoints = {
  // ---------- 工作台 ----------
  Bi_workbench: {
    method: "get" as const,
    path: "/enterprise/bi/workbench",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          isMember: z.boolean(),
          role: z.string(),
          roleLabel: z.string(),
          stats: z.array(
            z.object({ key: z.string(), label: z.string(), value: z.string() }),
          ),
          recentSessions: z.array(sessionRow),
          recentDashboards: z.array(dashboardRow),
          datasets: z.array(datasetRow),
        })
        .passthrough(),
    ),
  },
  Bi_recent: {
    method: "get" as const,
    path: "/enterprise/bi/recent",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        sessions: z.array(sessionRow),
        charts: z.array(chartRow),
        dashboards: z.array(dashboardRow),
      }),
    ),
  },

  // ---------- 数据源 ----------
  Bi_datasources: {
    method: "get" as const,
    path: "/enterprise/bi/datasources",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(datasourceRow)),
  },
  Bi_createDatasource: {
    method: "post" as const,
    path: "/enterprise/bi/datasources",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(80),
      type: z.enum(BI_DATASOURCE_TYPES),
      host: z.string().min(1).max(255),
      port: z.number().int().min(1).max(65535),
      database: z.string().min(1).max(120),
      schema: z.string().max(120).default("public"),
      username: z.string().min(1).max(120),
      password: z.string().min(1).max(500),
      ssl: z.boolean().default(false),
    }),
    response: envelope(datasourceRow),
  },
  Bi_updateDatasource: {
    method: "patch" as const,
    path: "/enterprise/bi/datasources/:id",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(80).optional(),
      host: z.string().max(255).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      database: z.string().max(120).optional(),
      schema: z.string().max(120).optional(),
      username: z.string().max(120).optional(),
      password: z.string().max(500).optional(),
      ssl: z.boolean().optional(),
      status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    }),
    response: envelope(datasourceRow),
  },
  Bi_testDatasource: {
    method: "post" as const,
    path: "/enterprise/bi/datasources/:id/test",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        ok: z.boolean(),
        message: z.string(),
        version: z.string(),
        elapsedMs: z.number(),
      }),
    ),
  },
  Bi_syncDatasource: {
    method: "post" as const,
    path: "/enterprise/bi/datasources/:id/sync",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ tables: z.number(), fields: z.number() })),
  },
  Bi_removeDatasource: {
    method: "delete" as const,
    path: "/enterprise/bi/datasources/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_datasourceTables: {
    method: "get" as const,
    path: "/enterprise/bi/datasources/:id/tables",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(tableRow)),
  },
  Bi_saveDatasourceField: {
    method: "post" as const,
    path: "/enterprise/bi/datasources/:id/fields/:fieldId",
    params: z.object({ id: z.string(), fieldId: z.string() }),
    query: emptyQuery,
    body: z.object({
      fieldComment: z.string().max(200).default(""),
      enabled: z.boolean().default(true),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },

  // ---------- 数据集 ----------
  Bi_datasetGroups: {
    method: "get" as const,
    path: "/enterprise/bi/dataset-groups",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.array(z.object({ id: z.number(), name: z.string(), sort: z.number() })),
    ),
  },
  Bi_saveDatasetGroup: {
    method: "post" as const,
    path: "/enterprise/bi/dataset-groups",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(60),
      sort: z.number().int().default(0),
    }),
    response: envelope(
      z.object({ id: z.number(), name: z.string(), sort: z.number() }),
    ),
  },
  Bi_removeDatasetGroup: {
    method: "delete" as const,
    path: "/enterprise/bi/dataset-groups/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_datasets: {
    method: "get" as const,
    path: "/enterprise/bi/datasets",
    params: z.object({}),
    query: pageQuerySchema.extend({
      groupId: z.coerce.number().optional(),
      type: z.string().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(datasetRow)),
  },
  Bi_dataset: {
    method: "get" as const,
    path: "/enterprise/bi/datasets/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          dataset: datasetRow,
          fields: z.array(datasetFieldRow),
          relations: z.array(z.record(z.string(), z.unknown())),
          tables: z.array(z.record(z.string(), z.unknown())),
          permissions: z.array(z.record(z.string(), z.unknown())),
          recommended: z.array(z.string()),
        })
        .passthrough(),
    ),
  },
  Bi_createDataset: {
    method: "post" as const,
    path: "/enterprise/bi/datasets",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(80),
      groupId: z.number().int().default(0),
      type: z.enum(BI_DATASET_TYPES),
      datasourceId: z.number().int().default(0),
      internalKey: z.string().max(40).default(""),
      sqlText: z.string().max(20000).default(""),
      description: z.string().max(500).default(""),
      tableIds: z.array(z.number().int()).default([]),
    }),
    response: envelope(datasetRow),
  },
  Bi_updateDataset: {
    method: "patch" as const,
    path: "/enterprise/bi/datasets/:id",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      name: z.string().min(1).max(80).optional(),
      groupId: z.number().int().optional(),
      sqlText: z.string().max(20000).optional(),
      description: z.string().max(500).optional(),
      status: z.enum(["ACTIVE", "DISABLED"]).optional(),
      tableIds: z.array(z.number().int()).optional(),
    }),
    response: envelope(datasetRow),
  },
  Bi_removeDataset: {
    method: "delete" as const,
    path: "/enterprise/bi/datasets/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_previewDataset: {
    method: "get" as const,
    path: "/enterprise/bi/datasets/:id/preview",
    params: idParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    body: z.undefined(),
    response: envelope(
      z.object({
        columns: z.array(
          z.object({ key: z.string(), label: z.string(), type: z.string() }),
        ),
        rows: z.array(z.record(z.string(), z.unknown())),
        rowCount: z.number(),
        sql: z.string(),
      }),
    ),
  },
  Bi_datasetFields: {
    method: "get" as const,
    path: "/enterprise/bi/datasets/:id/fields",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(datasetFieldRow)),
  },
  Bi_saveDatasetField: {
    method: "post" as const,
    path: "/enterprise/bi/datasets/:id/fields",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      fieldKey: z.string().min(1).max(120),
      name: z.string().min(1).max(80),
      type: z.string().max(40).default(""),
      comment: z.string().max(200).default(""),
      role: z.enum(["DIMENSION", "MEASURE"]).default("DIMENSION"),
      aggregate: z.string().max(16).default(""),
      expression: z.string().max(2000).default(""),
      format: z.string().max(40).default(""),
      sort: z.number().int().default(0),
      visible: z.boolean().default(true),
    }),
    response: envelope(datasetFieldRow),
  },
  Bi_removeDatasetField: {
    method: "delete" as const,
    path: "/enterprise/bi/datasets/:id/fields/:fieldId",
    params: z.object({ id: z.string(), fieldId: z.string() }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_datasetPermissions: {
    method: "get" as const,
    path: "/enterprise/bi/datasets/:id/permissions",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Bi_saveDatasetPermission: {
    method: "post" as const,
    path: "/enterprise/bi/datasets/:id/permissions",
    params: idParam,
    query: emptyQuery,
    body: z.object({
      role: z.enum(BI_ROLES),
      rowFilter: z.string().max(2000).default(""),
      columnRules: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },

  // ---------- 术语 / 训练 / 推荐问题 ----------
  Bi_terms: {
    method: "get" as const,
    path: "/enterprise/bi/terms",
    params: z.object({}),
    query: z.object({ datasetId: z.coerce.number().optional() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Bi_saveTerm: {
    method: "post" as const,
    path: "/enterprise/bi/terms",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      datasetId: z.number().int().default(0),
      term: z.string().min(1).max(80),
      definition: z.string().max(1000).default(""),
      synonyms: z.array(z.string()).default([]),
      enabled: z.boolean().default(true),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Bi_removeTerm: {
    method: "delete" as const,
    path: "/enterprise/bi/terms/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_trainings: {
    method: "get" as const,
    path: "/enterprise/bi/trainings",
    params: z.object({}),
    query: z.object({ datasetId: z.coerce.number().optional() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Bi_saveTraining: {
    method: "post" as const,
    path: "/enterprise/bi/trainings",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      datasetId: z.number().int().default(0),
      question: z.string().min(1).max(500),
      sqlText: z.string().min(1).max(20000),
      enabled: z.boolean().default(true),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Bi_removeTraining: {
    method: "delete" as const,
    path: "/enterprise/bi/trainings/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_recommendedQuestions: {
    method: "get" as const,
    path: "/enterprise/bi/recommended-questions",
    params: z.object({}),
    query: z.object({ datasetId: z.coerce.number().optional() }),
    body: z.undefined(),
    response: envelope(z.array(z.record(z.string(), z.unknown()))),
  },
  Bi_saveRecommendedQuestion: {
    method: "post" as const,
    path: "/enterprise/bi/recommended-questions",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      datasetId: z.number().int().default(0),
      question: z.string().min(1).max(500),
      sort: z.number().int().default(0),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Bi_removeRecommendedQuestion: {
    method: "delete" as const,
    path: "/enterprise/bi/recommended-questions/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 问数 ----------
  Bi_sessions: {
    method: "get" as const,
    path: "/enterprise/bi/sessions",
    params: z.object({}),
    query: pageQuerySchema.extend({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(sessionRow)),
  },
  Bi_session: {
    method: "get" as const,
    path: "/enterprise/bi/sessions/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        session: sessionRow,
        messages: z.array(messageRow),
      }),
    ),
  },
  Bi_createSession: {
    method: "post" as const,
    path: "/enterprise/bi/sessions",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      datasetId: z.number().int().default(0),
      title: z.string().max(120).default(""),
    }),
    response: envelope(sessionRow),
  },
  Bi_removeSession: {
    method: "delete" as const,
    path: "/enterprise/bi/sessions/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_ask: {
    method: "post" as const,
    path: "/enterprise/bi/ask",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      sessionId: z.number().int().default(0),
      datasetId: z.number().int().default(0),
      question: z.string().min(1).max(2000),
      channelId: z.number().int().default(0),
      model: z.string().max(128).default(""),
    }),
    response: envelope(askResult),
  },
  Bi_feedback: {
    method: "post" as const,
    path: "/enterprise/bi/messages/:id/feedback",
    params: idParam,
    query: emptyQuery,
    body: z.object({ feedback: z.enum(["USEFUL", "USELESS"]) }),
    response: envelope(z.object({ saved: z.boolean() })),
  },
  Bi_recommendQuestions: {
    method: "get" as const,
    path: "/enterprise/bi/datasets/:id/recommended",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(z.string())),
  },

  // ---------- 图表 ----------
  Bi_charts: {
    method: "get" as const,
    path: "/enterprise/bi/charts",
    params: z.object({}),
    query: pageQuerySchema.extend({
      datasetId: z.coerce.number().optional(),
      keyword: z.string().optional(),
    }),
    body: z.undefined(),
    response: envelope(pageSchema(chartRow)),
  },
  Bi_chart: {
    method: "get" as const,
    path: "/enterprise/bi/charts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(chartRow),
  },
  Bi_saveChart: {
    method: "post" as const,
    path: "/enterprise/bi/charts",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      datasetId: z.number().int(),
      name: z.string().min(1).max(80),
      chartType: z.enum(BI_CHART_TYPES),
      config: z.record(z.string(), z.unknown()).default({}),
    }),
    response: envelope(chartRow),
  },
  Bi_removeChart: {
    method: "delete" as const,
    path: "/enterprise/bi/charts/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_chartData: {
    method: "get" as const,
    path: "/enterprise/bi/charts/:id/data",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        chart: chartRow,
        columns: z.array(
          z.object({ key: z.string(), label: z.string(), type: z.string() }),
        ),
        rows: z.array(z.record(z.string(), z.unknown())),
        rowCount: z.number(),
        sql: z.string(),
      }),
    ),
  },

  // ---------- 仪表板 ----------
  Bi_dashboards: {
    method: "get" as const,
    path: "/enterprise/bi/dashboards",
    params: z.object({}),
    query: pageQuerySchema.extend({ keyword: z.string().optional() }),
    body: z.undefined(),
    response: envelope(pageSchema(dashboardRow)),
  },
  Bi_dashboard: {
    method: "get" as const,
    path: "/enterprise/bi/dashboards/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        dashboard: dashboardRow,
        components: z.array(
          z
            .object({
              id: z.number(),
              dashboardId: z.number(),
              chartId: z.number(),
              type: z.string(),
              title: z.string(),
              position: z.record(z.string(), z.unknown()),
              config: z.record(z.string(), z.unknown()),
              sort: z.number(),
              chart: chartRow.nullable(),
            })
            .passthrough(),
        ),
      }),
    ),
  },
  Bi_saveDashboard: {
    method: "post" as const,
    path: "/enterprise/bi/dashboards",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      id: z.number().int().optional(),
      name: z.string().min(1).max(80),
      layout: z.array(z.record(z.string(), z.unknown())).default([]),
      config: z.record(z.string(), z.unknown()).default({}),
      components: z
        .array(
          z.object({
            id: z.number().int().optional(),
            chartId: z.number().int().default(0),
            type: z
              .enum(["CHART", "TEXT", "FILTER", "DIVIDER"])
              .default("CHART"),
            title: z.string().max(80).default(""),
            position: z.record(z.string(), z.unknown()).default({}),
            config: z.record(z.string(), z.unknown()).default({}),
            sort: z.number().int().default(0),
          }),
        )
        .default([]),
    }),
    response: envelope(dashboardRow),
  },
  Bi_dashboardData: {
    method: "get" as const,
    path: "/enterprise/bi/dashboards/:id/data",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        dashboard: dashboardRow,
        components: z.array(
          z
            .object({
              id: z.number(),
              chartId: z.number(),
              type: z.string(),
              title: z.string(),
              position: z.record(z.string(), z.unknown()),
              config: z.record(z.string(), z.unknown()),
              chart: chartRow.nullable(),
              columns: z.array(
                z.object({
                  key: z.string(),
                  label: z.string(),
                  type: z.string(),
                }),
              ),
              rows: z.array(z.record(z.string(), z.unknown())),
              error: z.string(),
            })
            .passthrough(),
        ),
      }),
    ),
  },
  Bi_removeDashboard: {
    method: "delete" as const,
    path: "/enterprise/bi/dashboards/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },

  // ---------- 设置 ----------
  Bi_settings: {
    method: "get" as const,
    path: "/enterprise/bi/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z
        .object({
          defaultTextChannelId: z.number(),
          defaultTextModel: z.string(),
          maxRows: z.number(),
          queryTimeoutMs: z.number(),
          role: z.string(),
          roleLabel: z.string(),
          isAdmin: z.boolean(),
        })
        .passthrough(),
    ),
  },
  Bi_saveSettings: {
    method: "post" as const,
    path: "/enterprise/bi/settings",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      defaultTextChannelId: z.number().int().min(0).optional(),
      defaultTextModel: z.string().max(128).optional(),
      maxRows: z.number().int().min(100).max(50000).optional(),
      queryTimeoutMs: z.number().int().min(1000).max(120000).optional(),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Bi_members: {
    method: "get" as const,
    path: "/enterprise/bi/members",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(
      z.object({
        rows: z.array(z.record(z.string(), z.unknown())),
        candidates: z.array(z.record(z.string(), z.unknown())),
        isAdmin: z.boolean(),
      }),
    ),
  },
  Bi_saveMember: {
    method: "post" as const,
    path: "/enterprise/bi/members",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      memberUserId: z.string().min(1),
      role: z.enum(BI_ROLES),
    }),
    response: envelope(z.record(z.string(), z.unknown())),
  },
  Bi_removeMember: {
    method: "delete" as const,
    path: "/enterprise/bi/members/:id",
    params: idParam,
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.object({ removed: z.boolean() })),
  },
  Bi_queryLogs: {
    method: "get" as const,
    path: "/enterprise/bi/query-logs",
    params: z.object({}),
    query: pageQuerySchema.extend({ status: z.string().optional() }),
    body: z.undefined(),
    response: envelope(
      pageSchema(
        z
          .object({
            id: z.number(),
            datasetId: z.number(),
            datasourceId: z.number(),
            sqlText: z.string(),
            status: z.string(),
            rows: z.number(),
            elapsedMs: z.number(),
            error: z.string(),
            channel: z.string(),
            createdAt: z.string(),
          })
          .passthrough(),
      ),
    ),
  },
  Bi_createExport: {
    method: "post" as const,
    path: "/enterprise/bi/export",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      type: z.enum(["ASK", "CHART", "DATASET"]),
      id: z.number().int().min(1),
    }),
    response: envelope(
      z.object({ filename: z.string(), content: z.string(), rows: z.number() }),
    ),
  },
  Bi_exportToDataTable: {
    method: "post" as const,
    path: "/enterprise/bi/data-table/export",
    params: z.object({}),
    query: emptyQuery,
    body: z.object({
      datasetId: z.number().int().min(1),
      dataTableId: z.number().int().default(0),
      tableName: z.string().max(60).default(""),
      limit: z.number().int().min(1).max(5000).default(1000),
    }),
    response: envelope(
      z.object({
        dataTableId: z.number(),
        rows: z.number(),
        created: z.boolean(),
      }),
    ),
  },
};

export type BiEndpoints = typeof biEndpoints;
