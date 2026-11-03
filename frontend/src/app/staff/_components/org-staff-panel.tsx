"use client";

import {
  App,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { useEffect, useState } from "react";
import {
  MEMBER_KINDS,
  MEMBER_KIND_LABELS,
  ORG_BUSINESS_SCOPES,
  ORG_BUSINESS_SCOPE_LABELS,
  type OrgApplicationRow,
  type OrgStaffPosition,
  type OrgStaffRow,
} from "@enterprise/contracts";
import { orgStaffApi } from "@/api/collab";
import { SendMessageButton } from "./send-message-button";

type Workspace = {
  orgType: string;
  orgName: string;
  manageable: boolean;
  staff: OrgStaffRow[];
  applications: OrgApplicationRow[];
  myInvitations: OrgApplicationRow[];
};

const MAX_POSITIONS = 5;

/** 岗位可以一人多岗，逐条添加；名称必填，职责说明可选。 */
function PositionsEditor({
  value,
  onChange,
}: {
  value: OrgStaffPosition[];
  onChange: (next: OrgStaffPosition[]) => void;
}) {
  const patch = (index: number, part: Partial<OrgStaffPosition>) => {
    onChange(value.map((item, at) => (at === index ? { ...item, ...part } : item)));
  };
  return (
    <div>
      <div className="field-label">岗位（可多个，最多 {MAX_POSITIONS} 个）</div>
      <Space orientation="vertical" style={{ width: "100%" }} size={8}>
        {value.map((item, index) => (
          <div key={index} style={{ display: "flex", gap: 8 }}>
            <Input
              placeholder="岗位名称，如：产品经理"
              maxLength={64}
              value={item.name}
              onChange={(event) => patch(index, { name: event.target.value })}
            />
            <Input
              placeholder="职责说明（可选）"
              maxLength={500}
              value={item.description}
              onChange={(event) => patch(index, { description: event.target.value })}
            />
            <Button
              type="link"
              danger
              onClick={() => onChange(value.filter((_, at) => at !== index))}
            >
              删除
            </Button>
          </div>
        ))}
        <Button
          block
          disabled={value.length >= MAX_POSITIONS}
          onClick={() => onChange([...value, { name: "", description: "" }])}
        >
          ＋ 添加岗位
        </Button>
      </Space>
    </div>
  );
}

/** 提交前收口：去掉整条空行；填了说明却没填名称的直接拦下。 */
function cleanPositions(list: OrgStaffPosition[]): OrgStaffPosition[] | null {
  const cleaned: OrgStaffPosition[] = [];
  for (const item of list) {
    const name = item.name.trim();
    const description = item.description.trim();
    if (!name && !description) continue;
    if (!name) return null;
    cleaned.push({ name, description });
  }
  return cleaned;
}

export function OrgStaffPanel() {
  const { message } = App.useApp();
  const [data, setData] = useState<Workspace | null>(null);
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState<
    { userId: string; realName: string; phone: string; inOrg: boolean }[]
  >([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberKind, setMemberKind] = useState<"STAFF" | "AGENT">("STAFF");
  const [roles, setRoles] = useState<string[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [department, setDepartment] = useState("");
  const [positions, setPositions] = useState<OrgStaffPosition[]>([]);
  const [capabilities, setCapabilities] = useState("");
  const [editing, setEditing] = useState<OrgStaffRow | null>(null);
  const [editDepartment, setEditDepartment] = useState("");
  const [editPositions, setEditPositions] = useState<OrgStaffPosition[]>([]);
  const [editCapabilities, setEditCapabilities] = useState("");
  const [detail, setDetail] = useState<OrgStaffRow | null>(null);

  const load = async () => {
    try {
      setData(await orgStaffApi.workspace());
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async (value: string) => {
    setKeyword(value);
    if (!value.trim()) {
      setCandidates([]);
      return;
    }
    try {
      setCandidates((await orgStaffApi.search({ query: { q: value } })) || []);
    } catch (error) {
      message.error((error as Error).message || "搜索失败");
    }
  };

  const resetInvite = () => {
    setMemberUserId("");
    setRoles([]);
    setScope([]);
    setDepartment("");
    setPositions([]);
    setCapabilities("");
  };

  const invite = async () => {
    if (!memberUserId) {
      message.warning("请选择要添加的账号");
      return;
    }
    const cleaned = cleanPositions(positions);
    if (!cleaned) {
      message.warning("岗位名称不能为空");
      return;
    }
    try {
      await orgStaffApi.invite({
        body: {
          memberUserId,
          memberKind,
          roles: memberKind === "STAFF" ? roles : [],
          scope: memberKind === "AGENT" ? scope : [],
          department: department.trim(),
          positions: cleaned,
          capabilities: capabilities.trim(),
        },
      });
      message.success("邀请已发出，等待本人确认");
      setOpen(false);
      resetInvite();
      void load();
    } catch (error) {
      message.error((error as Error).message || "邀请失败");
    }
  };

  const openEdit = (row: OrgStaffRow) => {
    setEditing(row);
    setEditDepartment(row.department);
    setEditPositions(row.positions.map((item) => ({ ...item })));
    setEditCapabilities(row.capabilities);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const cleaned = cleanPositions(editPositions);
    if (!cleaned) {
      message.warning("岗位名称不能为空");
      return;
    }
    try {
      await orgStaffApi.update({
        params: { id: String(editing.id) },
        body: {
          department: editDepartment.trim(),
          positions: cleaned,
          capabilities: editCapabilities.trim(),
        },
      });
      message.success("已保存");
      setEditing(null);
      void load();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    }
  };

  const decide = async (id: number, action: "APPROVE" | "REJECT") => {
    try {
      await orgStaffApi.decide({ params: { id: String(id) }, body: { action } });
      message.success(action === "APPROVE" ? "已确认" : "已拒绝");
      void load();
    } catch (error) {
      message.error((error as Error).message || "操作失败");
    }
  };

  const remove = async (row: OrgStaffRow) => {
    try {
      await orgStaffApi.remove({ params: { id: String(row.id) } });
      message.success("已移除");
      void load();
    } catch (error) {
      message.error((error as Error).message || "移除失败");
    }
  };

  if (!data) return <div className="muted">加载中…</div>;

  return (
    <>
      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <strong>{data.orgName || "本企业"} · 职员与代理人</strong>
        <span className="muted">
          企业职员可处理本企业全部业务；代理人只处理被指派的范围。
        </span>
        <Button style={{ marginLeft: "auto" }} type="primary" onClick={() => setOpen(true)}>
          添加成员
        </Button>
      </div>

      {data.myInvitations.length ? (
        <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
          <strong>待我确认的邀请</strong>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            dataSource={data.myInvitations}
            columns={[
              { title: "来自", dataIndex: "orgName" },
              { title: "身份", dataIndex: "memberKindLabel" },
              {
                title: "操作",
                width: 140,
                render: (_: unknown, row: OrgApplicationRow) => (
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => void decide(row.id, "APPROVE")}
                    >
                      接受
                    </Button>
                    <Button size="small" onClick={() => void decide(row.id, "REJECT")}>
                      拒绝
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      ) : null}

      <Table
        rowKey="id"
        dataSource={data.staff}
        pagination={false}
        columns={[
          { title: "姓名", dataIndex: "realName" },
          { title: "电话", dataIndex: "phone" },
          { title: "身份", dataIndex: "memberKindLabel", width: 90 },
          {
            title: "业务范围",
            render: (_: unknown, row: OrgStaffRow) =>
              row.memberKind === "AGENT"
                ? row.scopeLabels.join("、") || "未指派"
                : "全部业务",
          },
          {
            title: "部门",
            width: 120,
            render: (_: unknown, row: OrgStaffRow) => row.department || "—",
          },
          {
            title: "岗位",
            render: (_: unknown, row: OrgStaffRow) =>
              row.positions.length
                ? row.positions.map((item, index) => (
                    <Tag key={`${item.name}-${index}`}>{item.name}</Tag>
                  ))
                : "—",
          },
          {
            title: "能力说明",
            width: 220,
            render: (_: unknown, row: OrgStaffRow) =>
              row.capabilities ? (
                <Tooltip title={row.capabilities}>
                  <span>
                    {row.capabilities.length > 30
                      ? `${row.capabilities.slice(0, 30)}…`
                      : row.capabilities}
                  </span>
                </Tooltip>
              ) : (
                "—"
              ),
          },
          {
            title: "状态",
            dataIndex: "statusLabel",
            width: 90,
            render: (value: string) => <Tag>{value}</Tag>,
          },
          {
            title: "操作",
            width: 220,
            render: (_: unknown, row: OrgStaffRow) => (
              <Space size={4} wrap>
                <SendMessageButton userId={row.memberUserId} name={row.realName} />
                {data.manageable ? (
                  <>
                    <Button type="link" size="small" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    <Button type="link" size="small" onClick={() => setDetail(row)}>
                      详情
                    </Button>
                    <Button type="link" size="small" danger onClick={() => void remove(row)}>
                      移除
                    </Button>
                  </>
                ) : (
                  <Button type="link" size="small" onClick={() => setDetail(row)}>
                    详情
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      {data.applications.length ? (
        <div style={{ marginTop: 24 }}>
          <strong>邀请记录</strong>
          <Table
            rowKey="id"
            size="small"
            style={{ marginTop: 8 }}
            dataSource={data.applications}
            pagination={false}
            columns={[
              { title: "成员", dataIndex: "memberName" },
              { title: "身份", dataIndex: "memberKindLabel", width: 90 },
              { title: "状态", dataIndex: "statusLabel", width: 100 },
              {
                title: "发起时间",
                dataIndex: "createdAt",
                width: 160,
                render: (value: string) => value.replace("T", " ").slice(0, 16),
              },
            ]}
          />
        </div>
      ) : null}

      <Modal
        open={open}
        title="添加职员或代理人"
        onCancel={() => setOpen(false)}
        onOk={() => void invite()}
        okText="发出邀请"
        width={720}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <div className="field-label">按姓名 / 手机号搜索已注册账号</div>
            <Input.Search
              value={keyword}
              onChange={(event) => void search(event.target.value)}
              placeholder="输入姓名或手机号"
              allowClear
            />
            <Select
              style={{ width: "100%", marginTop: 8 }}
              value={memberUserId || undefined}
              onChange={setMemberUserId}
              placeholder="选择账号"
              options={candidates.map((item) => ({
                value: item.userId,
                label: `${item.realName}${item.phone ? `（${item.phone}）` : ""}${
                  item.inOrg ? " · 已在组织内" : ""
                }`,
                disabled: item.inOrg,
              }))}
            />
          </div>
          <div>
            <div className="field-label">身份</div>
            <Select
              style={{ width: "100%" }}
              value={memberKind}
              onChange={setMemberKind}
              options={MEMBER_KINDS.map((item) => ({
                value: item,
                label: MEMBER_KIND_LABELS[item],
              }))}
            />
          </div>
          {memberKind === "STAFF" ? (
            <div>
              <div className="field-label">可处理的业务板块（职员＝全部业务）</div>
              <select
                multiple
                style={{ width: "100%", minHeight: 80 }}
                value={roles}
                onChange={(event) =>
                  setRoles(
                    Array.from(event.target.selectedOptions).map((item) => item.value),
                  )
                }
              >
                {ORG_BUSINESS_SCOPES.map((item) => (
                  <option key={item} value={item}>
                    {ORG_BUSINESS_SCOPE_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <div className="field-label">指派范围（代理人只处理勾选的业务）</div>
              <select
                multiple
                style={{ width: "100%", minHeight: 80 }}
                value={scope}
                onChange={(event) =>
                  setScope(
                    Array.from(event.target.selectedOptions).map((item) => item.value),
                  )
                }
              >
                {ORG_BUSINESS_SCOPES.map((item) => (
                  <option key={item} value={item}>
                    {ORG_BUSINESS_SCOPE_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Input
            placeholder="部门（可选）"
            maxLength={64}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          />
          <PositionsEditor value={positions} onChange={setPositions} />
          <div>
            <div className="field-label">能力说明（可选，用于 OKR 拆解与工作分配）</div>
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
              placeholder="如：8 年 B 端产品经验，熟悉供销与财税流程"
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={`编辑 ${editing?.realName || ""}`}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText="保存"
        width={720}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size={12}>
          <Input
            placeholder="部门（可选）"
            maxLength={64}
            value={editDepartment}
            onChange={(event) => setEditDepartment(event.target.value)}
          />
          <PositionsEditor value={editPositions} onChange={setEditPositions} />
          <div>
            <div className="field-label">能力说明（可选，用于 OKR 拆解与工作分配）</div>
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              value={editCapabilities}
              onChange={(event) => setEditCapabilities(event.target.value)}
              placeholder="如：8 年 B 端产品经验，熟悉供销与财税流程"
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`${detail?.realName || ""} · ${detail?.memberKindLabel || ""}`}
        onCancel={() => setDetail(null)}
        footer={
          <Button onClick={() => setDetail(null)}>关闭</Button>
        }
        width={640}
      >
        {detail ? (
          <Space orientation="vertical" style={{ width: "100%" }} size={10}>
            <div>电话：{detail.phone || "—"}</div>
            <div>邮箱：{detail.email || "—"}</div>
            <div>部门：{detail.department || "—"}</div>
            <div>
              岗位：
              {detail.positions.length
                ? detail.positions.map((item, index) => (
                    <Tag key={`${item.name}-${index}`}>
                      {item.name}
                      {item.description ? `：${item.description}` : ""}
                    </Tag>
                  ))
                : "—"}
            </div>
            <div>能力说明：{detail.capabilities || "—"}</div>
            <div>
              业务范围：
              {detail.memberKind === "AGENT"
                ? detail.scopeLabels.join("、") || "未指派"
                : "全部业务"}
            </div>
            <div>状态：{detail.statusLabel}</div>
          </Space>
        ) : null}
      </Modal>
    </>
  );
}
