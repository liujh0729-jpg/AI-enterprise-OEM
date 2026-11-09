"use client";

import { App, Button, Space, Table, Tag } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { generatedSkillApi } from "@/api/generated-skills";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { useGeneratedSkills } from "@/query/generated-skills";
import type { GeneratedSkillSummary } from "@/api/generated-skills";

function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

/**
 * 开放集成 → API-MCP-Skill → Skill：
 * 平台管理员在后台按业务域生成的技能包（根目录带 SKILL.md），生成即入库，全站账号可下载。
 */
export function SkillTab({ onOpenMcp }: { onOpenMcp: () => void }) {
  const { message } = App.useApp();
  const query = useGeneratedSkills();
  const [downloading, setDownloading] = useState<number | null>(null);
  const rows = query.data?.rows ?? [];

  const download = async (row: GeneratedSkillSummary) => {
    setDownloading(row.id);
    try {
      const blob = await generatedSkillApi.download(row.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = row.filename || `${row.name}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      message.error(errText(caught));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <Panel
        title="平台生成的 Skill"
        extra={`${rows.length} 个 · 点击即可下载`}
      >
        <Notice variant="info">
          这里的技能包由平台管理员按本系统 MCP 业务域生成，根目录带{" "}
          <span className="mono">SKILL.md</span>，下载后可直接导入支持 Skills 的客户端。
          包内只写接入地址与动作清单，不含任何真实密钥——运行时使用你自己的{" "}
          <Link href="/developer/keys">ek_ Key</Link>，接入方式见{" "}
          <Button type="link" style={{ padding: 0, height: "auto" }} onClick={onOpenMcp}>
            MCP Server
          </Button>
          。同名技能重新生成会覆盖为最新包，下载最新版本即可。
        </Notice>
        {query.error ? (
          <div style={{ marginTop: 10 }}>
            <Notice variant="error">{errText(query.error)}</Notice>
          </div>
        ) : null}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <Table<GeneratedSkillSummary>
            rowKey="id"
            size="middle"
            loading={query.isLoading}
            dataSource={rows}
            pagination={false}
            locale={{
              emptyText: (
                <EmptyState text="平台还没有生成技能包，管理员完成生成后会在这里出现。" />
              ),
            }}
            columns={[
              {
                title: "技能",
                dataIndex: "displayName",
                width: 220,
                render: (_value, row) => (
                  <div style={{ display: "grid", gap: 2 }}>
                    <strong>{row.displayName}</strong>
                    <span className="mono text-12 muted">{row.name}</span>
                  </div>
                ),
              },
              { title: "说明", dataIndex: "description", ellipsis: true },
              {
                title: "业务域",
                dataIndex: "domainLabel",
                width: 130,
                render: (value: string) => <Tag>{value}</Tag>,
              },
              { title: "覆盖动作", dataIndex: "operationCount", width: 100 },
              {
                title: "生成模型",
                dataIndex: "model",
                width: 160,
                render: (value: string) => <span className="text-12 mono">{value || "—"}</span>,
              },
              {
                title: "更新时间",
                dataIndex: "updatedAt",
                width: 160,
                render: (value: string) => fmtDateTime(value),
              },
              {
                title: "操作",
                key: "action",
                width: 130,
                render: (_value, row) => (
                  <Space size={4}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<DownloadOutlined />}
                      loading={downloading === row.id}
                      onClick={() => void download(row)}
                    >
                      下载
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
