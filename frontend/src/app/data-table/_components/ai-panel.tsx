"use client";

import { RobotOutlined, SendOutlined } from "@ant-design/icons";
import { App, Button, Input, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { cellText, fieldTypeLabel, tableApi, type AiAskResult, type DataTableTable } from "./common";

type AskTurn = { question: string; result: AiAskResult };

const RECENT_LIMIT = 5;

/**
 * 数据表问数：服务端先把整表聚合（求和/均值/极值/计数/去重），
 * 再把「聚合口径 + 少量样本行」喂给模型生成结论 —— 省 token、防模型编数。
 * 没有可用模型时直接展示聚合口径（mode=aggregate），一样能回答。
 */
export function AiPanel({ table }: { table: DataTableTable }) {
  const { message } = App.useApp();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<AskTurn[]>([]);

  const ask = async () => {
    const text = question.trim();
    if (!text) {
      message.warning("请输入想问的问题");
      return;
    }
    setBusy(true);
    try {
      const result = await tableApi.aiAsk(table.id, text);
      setTurns((prev) => [{ question: text, result }, ...prev].slice(0, RECENT_LIMIT));
      setQuestion("");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sampleColumns = (result: AiAskResult): ColumnsType<Record<string, unknown>> =>
    result.columns.map((column) => ({
      title: (
        <span>
          {column.name}
          <span className="text-12 muted" style={{ marginLeft: 4 }}>
            {fieldTypeLabel(column.type)}
          </span>
        </span>
      ),
      dataIndex: column.key,
      key: column.key,
      render: (_, row) => cellText(row[column.key]),
    }));

  return (
    <Panel
      title="AI 问数"
      titleBadge="先聚合再问模型，按整表口径作答"
      extra={<span className="text-12 muted">问「合计 / 平均 / 有多少 / 分布」这类口径问题最准</span>}
    >
      <Space.Compact style={{ width: "100%" }}>
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onPressEnter={() => void ask()}
          placeholder="如：各行业的客户数分布、本月签约金额合计、平均客单价"
          maxLength={500}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={busy}
          onClick={() => void ask()}
        >
          提问
        </Button>
      </Space.Compact>

      {turns.length ? (
        <div style={{ marginTop: 12 }}>
          {turns.map((turn, index) => (
            <div key={`${turn.question}-${index}`} className="data-table-ask">
              <div className="data-table-ask-q">
                <RobotOutlined /> {turn.question}
              </div>
              <Tag color={turn.result.mode === "llm" ? "blue" : "default"}>
                {turn.result.mode === "llm" ? `模型 ${turn.result.model}` : "聚合口径"}
              </Tag>
              <div className="data-table-ask-a">{turn.result.answer}</div>
              <div className="text-12 muted">
                全表 {turn.result.total} 行，喂给模型 {turn.result.sampleSize} 行样本
              </div>
              {turn.result.rows.length ? (
                <Table
                  size="small"
                  rowKey={(_, rowIndex) => String(rowIndex)}
                  style={{ marginTop: 8 }}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  columns={sampleColumns(turn.result)}
                  dataSource={turn.result.rows}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <EmptyState text="还没有提问，试试「各渠道的线索数分布」" />
        </div>
      )}
    </Panel>
  );
}
