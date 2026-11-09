"use client";

import { App, ConfigProvider, Skeleton } from "antd";
import { useCallback, useEffect, useState } from "react";
import { AiCopilot } from "@/components/ai-copilot";
import { Notice, PageHero } from "@/components/ui/panel";
import { DataTableApiGuideButton } from "./_components/api-guide";
import { TableCards } from "./_components/table-cards";
import { TableDetail } from "./_components/table-detail";
import { tableApi, type DataTableTable } from "./_components/common";

/**
 * 多维表格（「工作台」栏目 · 按账号归属）。
 *
 * 机制参照 AIRecord 的 RPA 数据表：建表 → 定义列（八种类型，列键建列后不可改）→
 * 逐条录入行数据；列可拖拽排序。
 * 归属＝账号：同一个账号切企业 / 服务商 / 职员身份看到的都是同一批表。
 * 后端：/enterprise/data-tables（界面）与 /api/v1/data-tables（API Key 机器通道）。
 */
export default function DataTablePage() {
  const { message } = App.useApp();
  const [tables, setTables] = useState<DataTableTable[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await tableApi.list();
    setTables(result.data ?? []);
    setError(result.message);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 深链进入：/data-table?table=<id> 直接打开指定表（潜客挖掘的「查看线索」入口用）
  useEffect(() => {
    const target = Number(new URLSearchParams(window.location.search).get("table"));
    if (Number.isInteger(target) && target > 0) setSelectedId(target);
  }, []);

  const onChanged = useCallback(async () => {
    const result = await load();
    if (result.message) message.error(result.message);
  }, [load, message]);

  const selected = tables.find((item) => item.id === selectedId) || null;

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="多维表格"
        desc="按账号归属的自建结构化数据表：先建表 → 定义列（文本 / 数字 / 是·否 / 日期 / 链接 / 邮箱 / JSON / 单选）→ 逐条录入数据；同一账号切企业 / 服务商 / 职员身份看到的都是这批表。企业同事与旗下职员可按访问 / 新增 / 修改 / 删除四种权限分别授权（四种互不牵连），脚本也能用 API Key 按列键读写同一批数据"
        titleExtra={<DataTableApiGuideButton />}
      />

      {error ? <Notice variant="error">{`多维表格加载失败：${error}`}</Notice> : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : selected ? (
        <TableDetail
          table={selected}
          onBack={() => setSelectedId(null)}
          onChanged={onChanged}
        />
      ) : (
        <TableCards tables={tables} onOpen={setSelectedId} onChanged={onChanged} />
      )}
      <AiCopilot
        module="data_table"
        moduleLabel="多维表格"
        recordId={selected ? `table-${selected.id}` : undefined}
        recordLabel={selected?.name}
        context={
          selected
            ? `表格：${selected.name}；列：${selected.fields
                .map((field) => `${field.name}（${field.fieldKey}）`)
                .join("、")}`
            : `当前共有 ${tables.length} 张表`
        }
        suggestions={["这张表适合怎么分析", "帮我写一行数据"]}
      />
    </ConfigProvider>
  );
}
