"use client";

import { Button, Input, Modal, Space, Table, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { PageResponse } from "@enterprise/contracts";
import { livecodeApi } from "@/api/collab";

type Row = {
  id: number;
  userId: string;
  name: string;
  code: string;
  domain: string;
  status: string;
  totalCount: number;
  createdAt: string;
};

export function LivecodeAdminTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = (await livecodeApi.adminList({
        query: { page, pageSize: 20, ...(keyword ? { keyword } : {}) },
      })) as PageResponse<Row>;
      setRows(data?.list || []);
      setTotal(data?.total || 0);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={rows}
      pagination={{
        current: page,
        pageSize: 20,
        total,
        onChange: setPage,
        showSizeChanger: false,
      }}
      title={() => (
        <Space>
          <Input.Search
            placeholder="按名称 / 短码 / 账号搜索"
            allowClear
            onSearch={(value) => {
              setKeyword(value);
              setPage(1);
              void load();
            }}
            style={{ width: 260 }}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      )}
      columns={[
        { title: "活码", dataIndex: "name" },
        { title: "短码", dataIndex: "code", width: 110 },
        { title: "归属账号", dataIndex: "userId", width: 160 },
        {
          title: "当前域名",
          dataIndex: "domain",
          width: 200,
          render: (value: string) => value || "未识别",
        },
        {
          title: "累计扫码",
          dataIndex: "totalCount",
          width: 100,
        },
        {
          title: "状态",
          dataIndex: "status",
          width: 90,
          render: (value: string) => (
            <Tag color={value === "DISABLED" ? "red" : "green"}>
              {value === "DISABLED" ? "已停用" : "启用"}
            </Tag>
          ),
        },
        {
          title: "操作",
          width: 120,
          render: (_: unknown, row: Row) => (
            <Button
              size="small"
              danger={row.status !== "DISABLED"}
              onClick={() => {
                const disabling = row.status !== "DISABLED";
                Modal.confirm({
                  title: disabling ? "下架活码" : "恢复活码",
                  content: disabling
                    ? "下架后落地页显示「链接已停用」，客户可联系平台申诉。"
                    : "恢复后落地页立即可以访问。",
                  okText: disabling ? "下架" : "恢复",
                  onOk: async () => {
                    await livecodeApi.adminDisable({
                      params: { id: String(row.id) },
                      body: {
                        enable: !disabling,
                        reason: disabling ? "平台下架" : "",
                      },
                    });
                    message.success(disabling ? "已下架" : "已恢复");
                    void load();
                  },
                });
              }}
            >
              {row.status === "DISABLED" ? "恢复" : "下架"}
            </Button>
          ),
        },
      ]}
    />
  );
}
