"use client";

import { Button, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import { useEffect, useState } from "react";
import type { ServiceDeskAgent, OrgStaffRow } from "@enterprise/contracts";
import { orgStaffApi, serviceDeskApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "green",
  AWAY: "orange",
  OFFLINE: "default",
  DISABLED: "red",
};

export function TeamPanel() {
  const [rows, setRows] = useState<ServiceDeskAgent[]>([]);
  const [members, setMembers] = useState<OrgStaffRow[]>([]);
  const [open, setOpen] = useState(false);
  const [memberUserId, setMemberUserId] = useState("");
  const [role, setRole] = useState<"owner" | "lead" | "agent">("agent");
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [groupId, setGroupId] = useState(0);

  const load = async () => {
    try {
      const [agents, workspace, groupRows] = await Promise.all([
        serviceDeskApi.agents(),
        orgStaffApi.workspace().catch(() => null),
        serviceDeskApi.groups().catch(() => []),
      ]);
      setRows(agents || []);
      setGroups(groupRows || []);
      const staff = (workspace?.staff || []).filter(
        (item) => item.status === "ACTIVE",
      );
      setMembers(staff);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  const add = async () => {
    if (!memberUserId) {
      message.warning("请选择成员");
      return;
    }
    try {
      await serviceDeskApi.saveAgent({
        body: { memberUserId, role, groupId, maxConcurrent },
      });
      setOpen(false);
      setMemberUserId("");
      message.success("已添加客服");
      void load();
    } catch (error) {
      message.error((error as Error).message || "添加失败");
    }
  };

  return (
    <>
      <Panel
        title="客服团队"
        extra={
          <Space>
            <Button onClick={() => void load()}>刷新</Button>
            <Button type="primary" onClick={() => setOpen(true)}>
              添加客服成员
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "成员", dataIndex: "memberName" },
            { title: "角色", dataIndex: "roleLabel", width: 100 },
            {
              title: "客服组",
              dataIndex: "groupId",
              width: 140,
              render: (id: number) =>
                groups.find((item) => item.id === id)?.name || "未分组",
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (value: string, row: ServiceDeskAgent) => (
                <Tag color={STATUS_COLOR[value] || "default"}>
                  {row.statusLabel}
                </Tag>
              ),
            },
            {
              title: "进行中 / 并发上限",
              width: 170,
              render: (_: unknown, row: ServiceDeskAgent) =>
                `${row.activeCount} / ${row.maxConcurrent}`,
            },
            {
              title: "操作",
              width: 120,
              render: (_: unknown, row: ServiceDeskAgent) => (
                <Button
                  type="link"
                  danger
                  onClick={async () => {
                    await serviceDeskApi.removeAgent({
                      params: { id: String(row.id) },
                    });
                    void load();
                  }}
                >
                  移除
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Modal
        open={open}
        title="添加客服成员"
        onCancel={() => setOpen(false)}
        onOk={() => void add()}
        okText="添加"
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">成员（来自本组织职员与代理人）</div>
            <Select
              style={{ width: "100%" }}
              value={memberUserId || undefined}
              onChange={setMemberUserId}
              placeholder="选择成员"
              options={members
                .filter((item) => !rows.some((agent) => agent.memberUserId === item.memberUserId))
                .map((item) => ({
                  value: item.memberUserId,
                  label: `${item.realName}（${item.memberKindLabel}）`,
                }))}
            />
          </div>
          <div>
            <div className="field-label">角色</div>
            <Select
              style={{ width: "100%" }}
              value={role}
              onChange={setRole}
              options={[
                { value: "agent", label: "客服" },
                { value: "lead", label: "主管" },
                { value: "owner", label: "负责人" },
              ]}
            />
          </div>
          <div>
            <div className="field-label">客服组</div>
            <Select
              style={{ width: "100%" }}
              value={groupId}
              onChange={setGroupId}
              options={[
                { value: 0, label: "不分组" },
                ...groups.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </div>
          <div>
            <div className="field-label">同时接待上限</div>
            <InputNumber
              min={1}
              max={50}
              value={maxConcurrent}
              onChange={(value) => setMaxConcurrent(Number(value || 5))}
            />
          </div>
        </Space>
      </Modal>
    </>
  );
}

export function GroupsPanel() {
  const [rows, setRows] = useState<{ id: number; name: string; categories: string[]; enabled: boolean }[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categories, setCategories] = useState("");

  const load = async () => {
    try {
      setRows((await serviceDeskApi.groups()) || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  return (
    <>
      <Panel
        title="客服组"
        extra={
          <Button
            type="primary"
            onClick={() => {
              setName("");
              setCategories("");
              setOpen(true);
            }}
          >
            新建客服组
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "客服组", dataIndex: "name" },
            {
              title: "咨询类目",
              dataIndex: "categories",
              render: (value: string[]) =>
                value?.length ? value.join("、") : "全部",
            },
            {
              title: "操作",
              width: 100,
              render: (_: unknown, row: { id: number }) => (
                <Button
                  type="link"
                  danger
                  onClick={async () => {
                    await serviceDeskApi.removeGroup({
                      params: { id: String(row.id) },
                    });
                    void load();
                  }}
                >
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Modal
        open={open}
        title="新建客服组"
        onCancel={() => setOpen(false)}
        onOk={async () => {
          if (!name.trim()) {
            message.warning("请填写客服组名称");
            return;
          }
          await serviceDeskApi.saveGroup({
            body: {
              name: name.trim(),
              categories: categories
                .split(/[,，\s]+/)
                .map((item) => item.trim())
                .filter(Boolean),
            },
          });
          setOpen(false);
          void load();
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="客服组名称，例如：售前咨询"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="咨询类目（可选，逗号分隔）"
            value={categories}
            onChange={(event) => setCategories(event.target.value)}
          />
        </Space>
      </Modal>
    </>
  );
}