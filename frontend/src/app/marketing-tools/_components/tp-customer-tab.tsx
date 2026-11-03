"use client";

import { App, Button, Checkbox, Input, Radio, Space } from "antd";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { tpApi } from "@/api/tp";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import {
  TP_CRM_IMPORT_FIELDS,
  TP_ID_KEYS,
  TP_MAPPING_FIELDS,
  TP_NAME_KEYS,
  load,
  taskText,
  tpPick,
  type TpCrmImportResult,
  type TpObject,
} from "./tp-common";
import { TpAccountPanel } from "./tp-account-panel";
import { TpTaskPanel } from "./tp-task-panel";
import {
  TpAccountPicker,
  TpBatchForm,
  TpCostConfirm,
  TpFieldLabel,
  TpObjectWriter,
  TpPairEditor,
  TpReadPanel,
  TpRowsTable,
  TpSectionTitle,
  TpTableSelect,
  fieldOptions,
  useTpAccounts,
  useTpObjectModal,
  useTpTables,
  type TpPair,
} from "./tp-ui";

type View =
  | "settings"
  | "customers"
  | "segments"
  | "boards"
  | "crm"
  | "guide"
  | "tasks";

const TABS = [
  { key: "settings", label: "连接设置" },
  { key: "customers", label: "客户与标签" },
  { key: "segments", label: "分群" },
  { key: "boards", label: "看板取数" },
  { key: "crm", label: "导入 CRM" },
  { key: "guide", label: "使用说明" },
  { key: "tasks", label: "任务台账" },
];

/** 卡片名：工具视图里每个页签都用它做面板标题，页签只负责切换内容。 */
const TOOL_TITLE = "腾讯企点·客户数据";

/** 卡一：腾讯企点 · 客户数据（CDP + FA，含写入本系统 CRM）。 */
export function TpCustomerTab() {
  const [view, setView] = useState<View>("settings");
  const tabs = (
    <TabStrip
      items={TABS}
      value={view}
      onChange={(key) => setView(key as View)}
    />
  );

  if (view === "settings") {
    return (
      <TpAccountPanel
        products={["CDP"]}
        tabs={tabs}
        title={TOOL_TITLE}
        tip="客户数据、分群与看板取数共用这一套凭据（一个产品一套）。"
      />
    );
  }
  if (view === "tasks") {
    return <TpTaskPanel products={["CDP"]} tabs={tabs} title={TOOL_TITLE} />;
  }
  if (view === "customers") {
    return <CustomersPanel tabs={tabs} />;
  }
  if (view === "segments") {
    return <SegmentsPanel tabs={tabs} />;
  }
  if (view === "boards") {
    return <BoardsPanel tabs={tabs} />;
  }
  if (view === "crm") {
    return <CrmImportPanel tabs={tabs} />;
  }
  return <GuidePanel tabs={tabs} />;
}

function CustomersPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [mode, setMode] = useState<"create" | "update">("create");
  const [oneid, setOneid] = useState("");
  const [tagId, setTagId] = useState("");
  const [tagOp, setTagOp] = useState<"add" | "remove">("add");
  const [tagEntity, setTagEntity] = useState("oneid");
  const [trace, setTrace] = useState<TpObject[]>([]);
  const [tags, setTags] = useState<TpObject[]>([]);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const { open, modal } = useTpObjectModal();

  const loadCustomer = async (kind: "detail" | "trace" | "tags") => {
    const key = oneid.trim();
    if (!key) return;
    setLoadingCustomer(true);
    const body = { accountId, oneid: key };
    if (kind === "detail") {
      const result = await load(tpApi.cdpCustomerDetail({ body }));
      if (result.data) open({ title: `客户详情 · ${key}`, data: result.data });
    } else if (kind === "trace") {
      const result = await load(tpApi.cdpCustomerTrace({ body }));
      setTrace(result.data?.rows || []);
    } else {
      const result = await load(tpApi.cdpCustomerTags({ body }));
      setTags(result.data?.rows || []);
    }
    setLoadingCustomer(false);
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 26 }}>
        <div>
          <TpFieldLabel>本卡凭据</TpFieldLabel>
          <TpAccountPicker
            accounts={accounts}
            error={accountsError}
            product="CDP"
            value={accountId}
            onChange={setAccountId}
            onGoSettings={() => undefined}
          />
        </div>

        <TpBatchForm
          index={1}
          action="Tp_cdpImportCustomers"
          actionLabel="写入客户"
          datasetKey="cdp_customer_import"
          accountId={accountId}
          params={{ mode }}
          paramsEditor={
            <div>
              <TpFieldLabel>写入方式</TpFieldLabel>
              <Radio.Group
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <Radio value="create">新建客户</Radio>
                <Radio value="update">按唯一标识更新</Radio>
              </Radio.Group>
            </div>
          }
          submit={async (body) =>
            taskText(await tpApi.cdpImportCustomers({ body: body as never }))
          }
        />

        <TpBatchForm
          index={2}
          action="Tp_cdpApplyTags"
          actionLabel="批量打标"
          datasetKey="cdp_tag_apply"
          requiredKeys={["oneid"]}
          accountId={accountId}
          params={{ tagId, entityKey: tagEntity, opType: tagOp }}
          paramsReady={Boolean(tagId.trim())}
          paramsEditor={
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <TpFieldLabel>标签ID</TpFieldLabel>
                <Input
                  style={{ width: 260 }}
                  value={tagId}
                  placeholder="企点外部标签ID"
                  onChange={(event) => setTagId(event.target.value)}
                />
              </div>
              <div>
                <TpFieldLabel>主体键</TpFieldLabel>
                <Input
                  style={{ width: 220 }}
                  value={tagEntity}
                  placeholder="默认 oneid"
                  onChange={(event) => setTagEntity(event.target.value)}
                />
              </div>
              <div>
                <TpFieldLabel>操作</TpFieldLabel>
                <Radio.Group
                  value={tagOp}
                  onChange={(event) => setTagOp(event.target.value)}
                >
                  <Radio value="add">增加标签</Radio>
                  <Radio value="remove">移除标签</Radio>
                </Radio.Group>
              </div>
            </div>
          }
          submit={async (body) =>
            taskText(await tpApi.cdpApplyTags({ body: body as never }))
          }
        />

        <TpObjectWriter
          index={3}
          title="创建外部标签"
          actionLabel="创建标签"
          accountId={accountId}
          submit={async (payload) => {
            await tpApi.cdpCreateTag({ body: payload as never });
            return "标签已创建";
          }}
          hint="字段名以企点「外部标签创建」接口为准，例如标签名称、标签值。"
        />

        <section>
          <TpSectionTitle title="查询客户" />
          <Space size={8} wrap style={{ marginBottom: 10 }}>
            <Input
              style={{ width: 280 }}
              value={oneid}
              placeholder="客户唯一标识 oneid"
              onChange={(event) => setOneid(event.target.value)}
            />
            <Button loading={loadingCustomer} onClick={() => void loadCustomer("detail")}>
              客户详情
            </Button>
            <Button loading={loadingCustomer} onClick={() => void loadCustomer("trace")}>
              客户轨迹
            </Button>
            <Button loading={loadingCustomer} onClick={() => void loadCustomer("tags")}>
              客户标签
            </Button>
          </Space>
          {trace.length ? <TpRowsTable rows={trace} /> : null}
          {tags.length ? <TpRowsTable rows={tags} /> : null}
        </section>

        <TpReadPanel
          title="客户属性清单"
          tip="企点空间里可用的客户属性，写名单映射时按这些字段名填。"
          loadRows={async (input) =>
            (await tpApi.cdpProperties({
              query: { accountId, page: input.page, pageSize: input.pageSize, keyword: input.keyword },
            }))
          }
        />
      </div>
      {modal}
    </Panel>
  );
}

function SegmentsPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const { tables, loading, error: tablesError } = useTpTables();
  const [accountId, setAccountId] = useState(0);
  const [segmentId, setSegmentId] = useState("");
  const [tableId, setTableId] = useState(0);
  const [pairs, setPairs] = useState<TpPair[]>(
    TP_MAPPING_FIELDS.cdp_segment_export.map((item) => ({
      key: item.key,
      value: item.key,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [taskTip, setTaskTip] = useState("");
  const [error, setError] = useState("");
  const [crowdName, setCrowdName] = useState("");
  const [identityId, setIdentityId] = useState("oneid");
  const { open, modal } = useTpObjectModal();
  const table = tables?.find((item) => item.id === tableId) || null;

  const openDetail = async (row: TpObject) => {
    const id = tpPick(row, TP_ID_KEYS);
    if (!id) return;
    const result = await load(
      tpApi.cdpSegmentDetail({ params: { id }, query: { accountId } }),
    );
    if (result.data)
      open({
        title: `分群详情 · ${tpPick(row, TP_NAME_KEYS) || id}`,
        data: result.data,
      });
  };

  const exportSegment = async () => {
    if (!segmentId.trim()) return;
    setBusy(true);
    try {
      const mapping = Object.fromEntries(
        pairs
          .map((item) => [item.key.trim(), item.value.trim()])
          .filter(([key, value]) => key && value),
      );
      if (!Object.keys(mapping).length) {
        throw new Error("请先填结果表列与企点字段的对应关系");
      }
      const task = await tpApi.cdpExportSegment({
        params: { id: segmentId.trim() },
        body: {
          accountId,
          tableId,
          tableName: table?.name || "",
          mapping,
          exportSaKey: identityId.trim() || "oneid",
          confirmCost: false,
        } as never,
      });
      setTaskTip(taskText(task));
    } catch (caught) {
      setError((caught as Error).message || "导出失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 26 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="CDP"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />

        <TpReadPanel
          title="分群清单"
          tip="点「详情」看成员规模与外层字段；点「导出」把它填进下面的结果表。"
          loadRows={async (input) =>
            (await tpApi.cdpSegments({
              query: {
                accountId,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => (
            <Space size={4}>
              <Button size="small" onClick={() => void openDetail(row)}>
                详情
              </Button>
              <Button
                size="small"
                onClick={() => {
                  const id = tpPick(row, TP_ID_KEYS);
                  if (id) setSegmentId(id);
                }}
              >
                导出
              </Button>
            </Space>
          )}
        />

        <section>
          <TpSectionTitle title="导出分群到多维表格" />
          <Space size={8} wrap style={{ marginBottom: 8 }}>
            <Input
              style={{ width: 260 }}
              value={segmentId}
              placeholder="分群ID（可从上面「导出」带入）"
              onChange={(event) => setSegmentId(event.target.value)}
            />
            <TpTableSelect
              tables={tables}
              loading={loading}
              error={tablesError}
              value={tableId}
              onChange={setTableId}
              label="结果表"
              optional
            />
            <Input
              style={{ width: 180 }}
              value={identityId}
              placeholder="唯一标识字段（默认 oneid）"
              onChange={(event) => setIdentityId(event.target.value)}
            />
          </Space>
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            {table
              ? `结果表列 ← 企点字段；${table.rowCount} 行，导出只新增行，不改原表结构。`
              : "不选结果表时只记任务台账与明细；选表后按下面的对应关系写入。"}
          </div>
          <TpPairEditor
            rows={pairs}
            onChange={setPairs}
            keyLabel="结果表列"
            valueLabel="企点字段"
            addText="添加对应"
            hint="左侧是结果表列名（不存在会自动新建），右侧是企点返回的字段名。"
          />
          {error ? (
            <div style={{ marginTop: 8 }}>
              <Notice variant="warn">{error}</Notice>
            </div>
          ) : null}
          {taskTip ? (
            <div style={{ marginTop: 8 }}>
              <Notice variant="success">{taskTip}</Notice>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <Button type="primary" loading={busy} disabled={!segmentId.trim()} onClick={() => void exportSegment()}>
              导出分群
            </Button>
          </div>
        </section>

        <section>
          <TpSectionTitle title="把外部名单建成导入类分群" />
          <Space size={8} wrap style={{ marginBottom: 8 }}>
            <Input
              style={{ width: 260 }}
              value={crowdName}
              placeholder="分群名称"
              onChange={(event) => setCrowdName(event.target.value)}
            />
            <Input
              style={{ width: 200 }}
              value={identityId}
              placeholder="唯一标识字段（默认 oneid）"
              onChange={(event) => setIdentityId(event.target.value)}
            />
          </Space>
          <TpBatchForm
            index={1}
            action="Tp_cdpCreateSegment"
            actionLabel="导入分群"
            datasetKey="cdp_segment_create"
            accountId={accountId}
            params={{ crowdName, identityId }}
            paramsReady={Boolean(crowdName.trim())}
            submit={async (body) =>
              taskText(await tpApi.cdpCreateSegment({ body: body as never }))
            }
          />
        </section>
      </div>
      {modal}
    </Panel>
  );
}

function BoardsPanel({ tabs }: { tabs: ReactNode }) {
  const { accounts, error: accountsError } = useTpAccounts();
  const [accountId, setAccountId] = useState(0);
  const [boardId, setBoardId] = useState("");
  const [cardId, setCardId] = useState("");
  const [loadingCard, setLoadingCard] = useState(false);
  const { open, modal } = useTpObjectModal();

  const fetchCard = async (asyncResult: boolean) => {
    setLoadingCard(true);
    try {
      const body = { accountId, boardId, cardId };
      const result = asyncResult
        ? await tpApi.faAsyncResult({ body })
        : await tpApi.faCardResult({ body });
      if (result) open({ title: `图卡结果 · ${cardId}`, data: result });
    } finally {
      setLoadingCard(false);
    }
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 20 }}>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="CDP"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <TpReadPanel
          title="空间看板"
          tip="看板与图卡都只读，不修改融合分析里的任何配置。"
          loadRows={async (input) =>
            (await tpApi.faBoards({
              query: {
                accountId,
                page: input.page,
                pageSize: input.pageSize,
                keyword: input.keyword,
              },
            }))
          }
          action={(row) => (
            <Button
              size="small"
              onClick={() => {
                const id = tpPick(row, TP_ID_KEYS);
                if (id) setBoardId(id);
              }}
            >
              看图卡
            </Button>
          )}
        />

        {boardId ? (
          <TpReadPanel
            key={boardId}
            title={`图卡 · 看板 ${boardId}`}
            reloadKey={boardId}
            loadRows={async (input) =>
              (await tpApi.faCards({
                params: { id: boardId },
                query: {
                  accountId,
                  page: input.page,
                  pageSize: input.pageSize,
                  keyword: input.keyword,
                },
              }))
            }
            action={(row) => (
              <Button
                size="small"
                onClick={() => {
                  const id = tpPick(row, TP_ID_KEYS);
                  if (id) setCardId(id);
                }}
              >
                选这张卡
              </Button>
            )}
          />
        ) : null}

        <section>
          <TpSectionTitle title="取图卡结果" />
          <Space size={8} wrap>
            <Input
              style={{ width: 200 }}
              value={boardId}
              placeholder="看板ID"
              onChange={(event) => setBoardId(event.target.value)}
            />
            <Input
              style={{ width: 200 }}
              value={cardId}
              placeholder="图卡ID"
              onChange={(event) => setCardId(event.target.value)}
            />
            <Button loading={loadingCard} disabled={!cardId.trim()} onClick={() => void fetchCard(false)}>
              取分析结果
            </Button>
            <Button loading={loadingCard} disabled={!cardId.trim()} onClick={() => void fetchCard(true)}>
              取异步结果
            </Button>
          </Space>
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            结果按企点返回的结构原样展示；需要落表时请在企点控制台导出后再用多维表格导入（本系统不代写看板结果）。
          </div>
        </section>
      </div>
      {modal}
    </Panel>
  );
}

/** 导入 CRM：映射目标限定在 CRM 客户模板列；预检与去重全部沿用 CRM 自己的导入实现。 */
function CrmImportPanel({ tabs }: { tabs: ReactNode }) {
  const { message } = App.useApp();
  const { accounts, error: accountsError } = useTpAccounts();
  const {
    tables,
    loading: tablesLoading,
    error: tablesError,
  } = useTpTables();
  const [accountId, setAccountId] = useState(0);
  const [source, setSource] = useState<"data_table" | "cdp_segment">(
    "data_table",
  );
  const [tableId, setTableId] = useState(0);
  const [crowdId, setCrowdId] = useState("");
  const [pairs, setPairs] = useState<TpPair[]>(
    TP_MAPPING_FIELDS.crm_customer_import.map((item) => ({
      key: item.key,
      value: "",
    })),
  );
  const [confirmCost, setConfirmCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TpCrmImportResult | null>(null);
  const [errorText, setErrorText] = useState("");

  const table = tables?.find((item) => item.id === tableId) || null;
  const options = useMemo(() => (table ? fieldOptions(table.fields) : []), [table]);
  const mapping = Object.fromEntries(
    pairs
      .map((item) => [item.key.trim(), item.value.trim()])
      .filter(([key, value]) => key && value),
  );

  const submit = async () => {
    setErrorText("");
    if (!mapping.name) {
      setErrorText("CRM 客户名称为必填，请先映射「客户名称」");
      return;
    }
    if (source === "data_table" && !table) {
      setErrorText("请先选择客户名单来自哪张多维表格");
      return;
    }
    if (source === "cdp_segment" && !crowdId.trim()) {
      setErrorText("请填写企点分群ID");
      return;
    }
    setBusy(true);
    try {
      const data = await tpApi.crmImport({
        body: {
          accountId,
          source,
          tableId: source === "data_table" ? tableId : 0,
          tableName: source === "data_table" ? table?.name || "" : "",
          crowdId: source === "cdp_segment" ? crowdId.trim() : "",
          mapping,
          confirmCost,
        } as never,
      });
      if (!data) throw new Error("写入没有返回结果");
      setResult(data);
      message.success(
        `已写入 CRM：新建 ${data.created} 条，跳过 ${data.skipped} 条`,
      );
    } catch (caught) {
      setErrorText((caught as Error).message || "写入 CRM 失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="text-12 muted">
          企点侧查到的客户可以写入本系统 CRM：去重、必填校验与字段口径全部沿用 CRM 自己的导入；重复执行不会重复建客户，命中即跳过。
        </div>
        <TpAccountPicker
          accounts={accounts}
          error={accountsError}
          product="CDP"
          value={accountId}
          onChange={setAccountId}
          onGoSettings={() => undefined}
        />
        <div>
          <TpFieldLabel>名单来源</TpFieldLabel>
          <Radio.Group
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <Radio value="data_table">多维表格（先写进表格再导入 CRM）</Radio>
            <Radio value="cdp_segment">企点分群成员</Radio>
          </Radio.Group>
        </div>
        {source === "data_table" ? (
          <TpTableSelect
            tables={tables}
            loading={tablesLoading}
            error={tablesError}
            value={tableId}
            onChange={setTableId}
            label="名单表"
          />
        ) : (
          <Input
            style={{ width: 320 }}
            value={crowdId}
            placeholder="企点分群ID"
            onChange={(event) => setCrowdId(event.target.value)}
          />
        )}
        <div>
          <TpFieldLabel>
            {source === "data_table"
              ? "列映射（CRM 字段 ← 表格列）"
              : "列映射（CRM 字段 ← 企点字段）"}
          </TpFieldLabel>
          <TpPairEditor
            rows={pairs}
            onChange={setPairs}
            keyLabel="CRM 字段"
            keyOptions={TP_CRM_IMPORT_FIELDS.map((item) => ({
              value: item.key,
              label: item.label,
            }))}
            valueLabel={source === "data_table" ? "表格列" : "企点字段"}
            valueOptions={source === "data_table" ? options : undefined}
            addText="添加映射"
            hint="只能落 CRM 客户已有的标准列：客户名称（必填）、行业、省份、城市、备注。"
          />
        </div>
        {source === "data_table" ? (
          <TpCostConfirm
            rowCount={table?.rowCount || 0}
            actionLabel="写入本系统 CRM"
            checked={confirmCost}
            onChange={setConfirmCost}
          />
        ) : (
          <Checkbox
            checked={confirmCost}
            onChange={(event) => setConfirmCost(event.target.checked)}
          >
            我确认：会把该分群成员写入本系统 CRM（自动去重，已存在的跳过）
          </Checkbox>
        )}
        {errorText ? <Notice variant="warn">{errorText}</Notice> : null}
        {result ? (
          <Notice variant="success">
            {`新建 ${result.created} 条 · 跳过 ${result.skipped} 条 · 失败 ${result.failed} 条（共 ${result.total} 条，分 ${result.batches} 批）${result.message ? `；${result.message}` : ""}`}
          </Notice>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            写入 CRM
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function GuidePanel({ tabs }: { tabs: ReactNode }) {
  return (
    <Panel title={TOOL_TITLE} extra={tabs}>
      <div style={{ display: "grid", gap: 12, lineHeight: 1.9 }}>
        <div>
          <b>凭据</b>：一个产品一套（企业ID / secretId / secretKey / 空间ID），按登录账号归属并加密保存；测试连接只调只读接口。
        </div>
        <div>
          <b>客户与标签</b>：名单来自多维表格，列映射是「企点字段 ← 表格列」；客户详情 / 轨迹 / 标签按 oneid 查；外部标签创建按接口字段逐条填。
        </div>
        <div>
          <b>分群</b>：可以把分群导出到多维表格（异步任务，导出后可在「任务台账」看进度），也可以把外部名单建成导入类分群。
        </div>
        <div>
          <b>看板取数</b>：只读融合分析的空间看板、图卡与结果，不修改企点里的任何配置；落表请在控制台导出后导入多维表格。
        </div>
        <div>
          <b>导入 CRM</b>：写入本系统 CRM 客户，字段限定为名称 / 行业 / 省份 / 城市 / 备注，去重与校验沿用 CRM 导入；重复执行不会重复建客户。
        </div>
        <div>
          <b>花钱与真实触达</b>：发券、发积分、群发、CRM 写入前都要二次确认并显示行数；单次上限 1 万行。
        </div>
        <div>
          <b>不在本系统代理</b>：Customer AI 建模、社媒聆听、自动流画布、RTA 策略实验，请在腾讯企点营销工作台操作（连接设置里的「打开腾讯企点营销工作台」）。
        </div>
        <div className="text-12 muted">
          任务成功 / 失败都会在「任务台账」留痕；失败只影响本次任务，不回滚已经写入的行。
        </div>
      </div>
    </Panel>
  );
}