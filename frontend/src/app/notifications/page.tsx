"use client";

import { Button, Select, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationRow,
} from "@enterprise/contracts";
import { PageHero, Panel } from "@/components/ui/panel";
import { notificationsApi } from "@/api/collab";

const LEVEL_COLOR: Record<string, string> = {
  info: "blue",
  warning: "orange",
  error: "red",
};

export default function NotificationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await notificationsApi.list({
        query: { page, pageSize: 20, ...(category ? { category } : {}) },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (row: NotificationRow) => {
    try {
      if (!row.read) {
        if (row.source === "sns") {
          await notificationsApi.readSns({
            params: { id: row.externalId || String(row.id) },
          });
        } else {
          await notificationsApi.read({ params: { id: String(row.id) } });
        }
      }
    } catch {
      // 忽略
    }
    if (row.link) router.push(row.link);
    else void load();
  };

  return (
    <>
      <PageHero
        title="系统消息"
        desc="全站需要你知道或处理的事件都在这里：客服、需求与商机、身份与签约、财税与申报、自动化与集成、账号与平台。点击一条消息标记已读并跳转到对应页面。"
      />
      <Panel
        title="全部消息"
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              value={category}
              style={{ width: 160 }}
              onChange={(value) => {
                setPage(1);
                setCategory(value);
              }}
              options={[
                { value: "", label: "全部分类" },
                ...NOTIFICATION_CATEGORIES.map((item) => ({
                  value: item,
                  label: NOTIFICATION_CATEGORY_LABELS[item],
                })),
              ]}
            />
            <Button
              onClick={async () => {
                await notificationsApi.readAll({
                  body: category ? { category } : {},
                });
                message.success("已全部标为已读");
                void load();
              }}
            >
              全部已读
            </Button>
          </div>
        }
      >
        <Table
          rowKey={(row) => `${row.source}-${row.externalId || row.id}`}
          loading={loading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: "分类",
              dataIndex: "categoryLabel",
              width: 130,
              render: (label: string) => <Tag>{label}</Tag>,
            },
            {
              title: "标题",
              dataIndex: "title",
              render: (title: string, row: NotificationRow) => (
                <a onClick={() => void open(row)}>
                  {row.read ? title : <strong>{title}</strong>}
                </a>
              ),
            },
            { title: "内容", dataIndex: "body", ellipsis: true },
            {
              title: "级别",
              dataIndex: "level",
              width: 90,
              render: (level: string) => (
                <Tag color={LEVEL_COLOR[level] || "default"}>
                  {level === "error" ? "严重" : level === "warning" ? "提醒" : "信息"}
                </Tag>
              ),
            },
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 160,
              render: (value: string) => value.replace("T", " ").slice(0, 16),
            },
            {
              title: "状态",
              dataIndex: "read",
              width: 80,
              render: (read: boolean) => (read ? "已读" : "未读"),
            },
          ]}
        />
      </Panel>
    </>
  );
}