"use client";

import { App, Button, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type {
  OrgFunctionCatalog,
  OrgFunctionItem,
  OrgFunctionMember,
} from "@enterprise/contracts";
import { orgStaffApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";

const MAX_POSITIONS = 5;

function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

/**
 * 职能管理：本组织维护部门与岗位（含岗位说明），再把它们赋给在职成员。
 * 赋职能不是必填项；OA 流程可按「部门 + 岗位」选签批人，用的就是这里的目录。
 */
export function FunctionsPanel({ orgType }: { orgType: "ENTERPRISE" | "PROVIDER" }) {
  const { message } = App.useApp();
  const [data, setData] = useState<OrgFunctionCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptEditing, setDeptEditing] = useState<OrgFunctionItem | null>(null);
  const [posOpen, setPosOpen] = useState(false);
  const [posEditing, setPosEditing] = useState<OrgFunctionItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<OrgFunctionMember | null>(null);
  const [assignDepartment, setAssignDepartment] = useState("");
  const [assignPositions, setAssignPositions] = useState<string[]>([]);
  const [deptForm] = Form.useForm();
  const [posForm] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    orgStaffApi
      .functions({ query: { orgType } })
      .then((value) => setData(value as OrgFunctionCatalog))
      .catch((caught: unknown) => setError(errText(caught)))
      .finally(() => setLoading(false));
  }, [orgType]);

  useEffect(() => {
    load();
  }, [load]);

  const openDepartment = (item?: OrgFunctionItem) => {
    setDeptEditing(item || null);
    deptForm.setFieldsValue({ name: item?.name || "", description: item?.description || "" });
    setDeptOpen(true);
  };

  const saveDepartment = async () => {
    try {
      const values = await deptForm.validateFields();
      setSaving(true);
      await orgStaffApi.saveDepartment({
        body: {
          orgType,
          ...(deptEditing ? { id: deptEditing.id } : {}),
          name: String(values.name || "").trim(),
          description: String(values.description || "").trim(),
          sortOrder: deptEditing?.sortOrder || 0,
        },
      });
      message.success(deptEditing ? "部门已更新" : "部门已创建");
      setDeptOpen(false);
      load();
    } catch (caught) {
      if (caught && typeof caught === "object" && "errorFields" in caught) return;
      message.error(errText(caught));
    } finally {
      setSaving(false);
    }
  };

  const removeDepartment = async (item: OrgFunctionItem) => {
    try {
      await orgStaffApi.removeDepartment({ params: { id: String(item.id) }, query: { orgType } });
      message.success("部门已删除，相关成员不再挂该部门");
      load();
    } catch (caught) {
      message.error(errText(caught));
    }
  };

  const openPosition = (item?: OrgFunctionItem) => {
    setPosEditing(item || null);
    posForm.setFieldsValue({ name: item?.name || "", description: item?.description || "" });
    setPosOpen(true);
  };

  const savePosition = async () => {
    try {
      const values = await posForm.validateFields();
      setSaving(true);
      await orgStaffApi.savePosition({
        body: {
          orgType,
          ...(posEditing ? { id: posEditing.id } : {}),
          name: String(values.name || "").trim(),
          description: String(values.description || "").trim(),
          sortOrder: posEditing?.sortOrder || 0,
        },
      });
      message.success(posEditing ? "岗位已更新" : "岗位已创建");
      setPosOpen(false);
      load();
    } catch (caught) {
      if (caught && typeof caught === "object" && "errorFields" in caught) return;
      message.error(errText(caught));
    } finally {
      setSaving(false);
    }
  };

  const removePosition = async (item: OrgFunctionItem) => {
    try {
      await orgStaffApi.removePosition({ params: { id: String(item.id) }, query: { orgType } });
      message.success("岗位已删除，相关成员不再挂该岗位");
      load();
    } catch (caught) {
      message.error(errText(caught));
    }
  };

  const openAssign = (member: OrgFunctionMember) => {
    setAssigning(member);
    setAssignDepartment(member.department || "");
    setAssignPositions(member.positions.map((item) => item.name));
  };

  const saveAssign = async () => {
    if (!assigning) return;
    setSaving(true);
    try {
      await orgStaffApi.assignFunctions({
        params: { id: String(assigning.id) },
        body: {
          orgType,
          department: assignDepartment,
          positions: assignPositions.map((name) => ({
            name,
            description:
              data?.positions.find((item) => item.name === name)?.description || "",
          })),
        },
      });
      message.success("职能已保存");
      setAssigning(null);
      load();
    } catch (caught) {
      message.error(errText(caught));
    } finally {
      setSaving(false);
    }
  };

  const departments = data?.departments || [];
  const positions = data?.positions || [];
  const members = data?.members || [];
  const deptOptions = departments.map((item) => ({ value: item.name, label: item.name }));
  const positionOptions = positions.map((item) => ({
    value: item.name,
    label: item.description ? `${item.name}（${item.description}）` : item.name,
  }));

  return (
    <>
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <Tag color="red">加载失败</Tag>
          {error}
          <Button type="link" onClick={load}>
            重试
          </Button>
        </div>
      ) : null}

      <Panel
        title="部门"
        titleExtra={
          <span className="text-12 muted">
            本组织（{data?.orgName || "当前组织"}）的部门清单；OA 流程可按部门选签批人
          </span>
        }
        extra={
          <Button type="primary" onClick={() => openDepartment()}>
            新建部门
          </Button>
        }
      >
        <Table<OrgFunctionItem>
          rowKey="id"
          size="middle"
          loading={loading}
          pagination={false}
          dataSource={departments}
          locale={{ emptyText: <Empty description="还没有部门，点右上角「新建部门」开始。" /> }}
          columns={[
            { title: "部门名称", dataIndex: "name", width: 220 },
            {
              title: "说明",
              render: (_: unknown, row) => row.description || "—",
            },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => openDepartment(row)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这个部门？"
                    description="成员身上的部门会被清空，已提交的审批不受影响。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void removeDepartment(row)}
                  >
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="岗位"
        titleExtra={
          <span className="text-12 muted">
            岗位说明会随岗位一起展示；成员可选多个岗位，OA 流程可再按岗位收窄签批人
          </span>
        }
        extra={
          <Button type="primary" onClick={() => openPosition()}>
            新建岗位
          </Button>
        }
      >
        <Table<OrgFunctionItem>
          rowKey="id"
          size="middle"
          loading={loading}
          pagination={false}
          dataSource={positions}
          locale={{ emptyText: <Empty description="还没有岗位，点右上角「新建岗位」开始。" /> }}
          columns={[
            { title: "岗位名称", dataIndex: "name", width: 220 },
            {
              title: "岗位说明",
              render: (_: unknown, row) => row.description || "—",
            },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => openPosition(row)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这个岗位？"
                    description="成员身上的该岗位会被移除，已提交的审批不受影响。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void removePosition(row)}
                  >
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="成员职能"
        titleExtra={
          <span className="text-12 muted">
            选择并赋予到在职职员（非必填）；同一成员可挂一个部门与多个岗位
          </span>
        }
      >
        <Table<OrgFunctionMember>
          rowKey="id"
          size="middle"
          loading={loading}
          pagination={false}
          dataSource={members}
          locale={{ emptyText: <Empty description="还没有在职成员。" /> }}
          columns={[
            {
              title: "成员",
              width: 180,
              render: (_: unknown, row) => <span style={{ fontWeight: 600 }}>{row.realName}</span>,
            },
            { title: "身份", dataIndex: "memberKindLabel", width: 90 },
            {
              title: "部门",
              width: 160,
              render: (_: unknown, row) => row.department || <span className="text-12 muted">未设置</span>,
            },
            {
              title: "岗位",
              render: (_: unknown, row) =>
                row.positions.length ? (
                  <Space size={4} wrap>
                    {row.positions.map((item) => (
                      <Tag key={item.name}>{item.name}</Tag>
                    ))}
                  </Space>
                ) : (
                  <span className="text-12 muted">未设置</span>
                ),
            },
            {
              title: "操作",
              width: 120,
              render: (_: unknown, row) => (
                <Button type="link" size="small" onClick={() => openAssign(row)}>
                  设置职能
                </Button>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={deptOpen}
        title={deptEditing ? "编辑部门" : "新建部门"}
        confirmLoading={saving}
        okText="保存"
        onCancel={() => setDeptOpen(false)}
        onOk={() => void saveDepartment()}
        destroyOnHidden
      >
        <Form form={deptForm} layout="vertical">
          <Form.Item
            name="name"
            label="部门名称"
            rules={[{ required: true, message: "请填写部门名称" }]}
          >
            <Input maxLength={64} placeholder="例如：产品研发部" />
          </Form.Item>
          <Form.Item name="description" label="部门说明（可选）">
            <Input.TextArea rows={2} maxLength={500} placeholder="这个部门负责什么" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={posOpen}
        title={posEditing ? "编辑岗位" : "新建岗位"}
        confirmLoading={saving}
        okText="保存"
        onCancel={() => setPosOpen(false)}
        onOk={() => void savePosition()}
        destroyOnHidden
      >
        <Form form={posForm} layout="vertical">
          <Form.Item
            name="name"
            label="岗位名称"
            rules={[{ required: true, message: "请填写岗位名称" }]}
          >
            <Input maxLength={64} placeholder="例如：产品经理" />
          </Form.Item>
          <Form.Item name="description" label="岗位说明（可选）">
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="这个岗位的职责与能力要求"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(assigning)}
        title={`设置职能 · ${assigning?.realName || ""}`}
        confirmLoading={saving}
        okText="保存"
        onCancel={() => setAssigning(null)}
        onOk={() => void saveAssign()}
        destroyOnHidden
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="field-label">部门（可选）</div>
            <Select
              allowClear
              style={{ width: "100%" }}
              value={assignDepartment || undefined}
              placeholder="不设置部门"
              options={deptOptions}
              onChange={(value) => setAssignDepartment(value || "")}
            />
          </div>
          <div>
            <div className="field-label">{`岗位（可选，最多 ${MAX_POSITIONS} 个）`}</div>
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              value={assignPositions}
              placeholder="不设置岗位"
              options={positionOptions}
              onChange={(values: string[]) => setAssignPositions(values.slice(0, MAX_POSITIONS))}
            />
          </div>
          {!departments.length || !positions.length ? (
            <span className="text-12 muted">
              目录还没配全：先在上方「部门」「岗位」里建好，再回来赋给成员。
            </span>
          ) : null}
        </div>
      </Modal>
    </>
  );
}