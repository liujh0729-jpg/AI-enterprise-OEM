"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { hrmApi, type HrmProfile } from "@/api/hrm";
import { aiApi, type AiHrmAttrition } from "@/api/ai";
import { AiLevelTag, AiList, AiResultModal } from "@/components/ai-result";
import { Panel } from "@/components/ui/panel";
import { HrmHandoverPanel } from "./hrm-handover-panel";
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_OPTIONS,
  PROFILE_STATUS_LABELS,
  PROFILE_STATUS_OPTIONS,
  STATUS_COLORS,
  formatMoney,
  hrmError,
  shortDate,
} from "./hrm-common";

type Page = { list: HrmProfile[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 20;

type FormValues = {
  memberUserId: string;
  employeeNo?: string;
  employmentType?: string;
  hourlyRate?: number;
  supervisorUserId?: string;
  department?: string;
  skills?: string;
  joinedAt?: string;
  note?: string;
};

/** 员工档案（OrgStaff 的 HR 扩展面）：管理员代录全员，普通成员只能看本人。 */
export function HrmProfilesTab({ reloadKey }: { reloadKey: number }) {
  const { message } = App.useApp();
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [department, setDepartment] = useState("");
  const [editing, setEditing] = useState<HrmProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [busy, setBusy] = useState(false);
  const [attrition, setAttrition] = useState<AiHrmAttrition | null>(null);
  const [attritionOpen, setAttritionOpen] = useState(false);
  const [attritionLoading, setAttritionLoading] = useState(false);
  const [attritionName, setAttritionName] = useState("");
  const [handoverUserId, setHandoverUserId] = useState<string | null>(null);
  const [handoverName, setHandoverName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await hrmApi.listProfiles({
        query: {
          page,
          pageSize: PAGE_SIZE,
          q: q.trim() || undefined,
          status,
          department: department.trim() || undefined,
        },
      });
      setData(next);
      setError("");
    } catch (err) {
      setError(hrmError(err));
    } finally {
      setLoading(false);
    }
  }, [page, q, status, department]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (row: HrmProfile) => {
    setEditing(row);
    form.setFieldsValue({
      memberUserId: row.memberUserId,
      employeeNo: row.employeeNo,
      employmentType: row.employmentType,
      hourlyRate: Number(row.hourlyRate) || 0,
      supervisorUserId: row.supervisorUserId,
      department: row.department,
      skills: row.skills.join("、"),
      joinedAt: shortDate(row.joinedAt) === "—" ? "" : shortDate(row.joinedAt),
      note: row.note,
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setBusy(true);
    try {
      await hrmApi.upsertProfile({
        body: {
          memberUserId: values.memberUserId.trim(),
          employeeNo: values.employeeNo || "",
          employmentType:
            (values.employmentType as "FULL_TIME" | "LABOR" | "AGENT") ||
            "FULL_TIME",
          hourlyRate: Number(values.hourlyRate) || 0,
          supervisorUserId: values.supervisorUserId || "",
          department: values.department || "",
          skills: (values.skills || "")
            .split(/[、,，\s]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          joinedAt: values.joinedAt || "",
          note: values.note || "",
        },
      });
      message.success(editing ? "档案已更新" : "档案已创建");
      setOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const runAttrition = async (row: HrmProfile) => {
    setAttritionName(row.employeeNo || row.memberUserId);
    setAttritionOpen(true);
    setAttritionLoading(true);
    setAttrition(null);
    try {
      setAttrition(
        await aiApi.hrmAttrition({ body: { memberUserId: row.memberUserId } }),
      );
    } catch (caught) {
      message.error(hrmError(caught));
      setAttritionOpen(false);
    } finally {
      setAttritionLoading(false);
    }
  };

  const changeStatus = async (row: HrmProfile, next: "ACTIVE" | "LEFT") => {
    if (next === "LEFT" && !window.confirm(`确认将 ${row.memberUserId} 标记为离职？`)) {
      return;
    }
    try {
      await hrmApi.updateProfileStatus({
        body: {
          memberUserId: row.memberUserId,
          status: next,
          leftAt: next === "LEFT" ? new Date().toISOString().slice(0, 10) : "",
        },
      });
      message.success(next === "LEFT" ? "已标记离职" : "已恢复在职");
      if (next === "LEFT") {
        setHandoverName(row.employeeNo || row.memberUserId);
        setHandoverUserId(row.memberUserId);
      }
      await load();
    } catch (err) {
      message.error(hrmError(err));
    }
  };

  return (
    <Panel
      title="员工档案"
      titleExtra={
        <span className="muted text-12">
          档案挂在「职员与代理人」成员账号上；非管理员只能维护本人
        </span>
      }
      extra={<Button type="primary" onClick={openCreate}>新增/更新档案</Button>}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="搜索账号、工号、部门"
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setQ(value);
          }}
        />
        <Select
          allowClear
          placeholder="在职状态"
          style={{ width: 140 }}
          options={PROFILE_STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
        <Input
          allowClear
          placeholder="部门"
          style={{ width: 160 }}
          value={department}
          onChange={(event) => {
            setPage(1);
            setDepartment(event.target.value);
          }}
        />
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Space>

      {error ? <div className="muted" style={{ color: "#cf1322", marginBottom: 8 }}>{error}</div> : null}

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.list || []}
        locale={{ emptyText: "还没有员工档案" }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: data?.total || 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            title: "成员",
            dataIndex: "memberUserId",
            render: (value: string, row: HrmProfile) => (
              <div>
                <div>{value}</div>
                <div className="muted text-12">
                  {row.employeeNo ? `工号 ${row.employeeNo}` : "未填工号"}
                </div>
              </div>
            ),
          },
          {
            title: "部门",
            dataIndex: "department",
            width: 120,
            render: (value: string) => value || "—",
          },
          {
            title: "雇佣类型",
            dataIndex: "employmentType",
            width: 100,
            render: (value: string) => EMPLOYMENT_LABELS[value] || value,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: string) => (
              <Tag color={STATUS_COLORS[value]}>{PROFILE_STATUS_LABELS[value] || value}</Tag>
            ),
          },
          {
            title: "时薪",
            dataIndex: "hourlyRate",
            width: 110,
            render: (value: string) => formatMoney(value),
          },
          {
            title: "入职",
            dataIndex: "joinedAt",
            width: 110,
            render: (value: string) => shortDate(value),
          },
          {
            title: "技能",
            dataIndex: "skills",
            render: (value: string[]) =>
              value.length ? (
                <Space size={4} wrap>
                  {value.slice(0, 6).map((item) => (
                    <Tag key={item}>{item}</Tag>
                  ))}
                  {value.length > 6 ? <Tag>+{value.length - 6}</Tag> : null}
                </Space>
              ) : (
                "—"
              ),
          },
          {
            title: "操作",
            width: 320,
            render: (_: unknown, row: HrmProfile) => (
              <Space size={4}>
                <Button type="link" size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button type="link" size="small" onClick={() => void runAttrition(row)}>
                  AI 离职风险
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setHandoverName(row.employeeNo || row.memberUserId);
                    setHandoverUserId(row.memberUserId);
                  }}
                >
                  离职交接
                </Button>
                {row.status === "LEFT" ? (
                  <Button type="link" size="small" onClick={() => void changeStatus(row, "ACTIVE")}>
                    恢复在职
                  </Button>
                ) : (
                  <Button type="link" size="small" danger onClick={() => void changeStatus(row, "LEFT")}>
                    离职
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <div style={{ marginTop: 12 }}>
        <HrmHandoverPanel
          memberUserId={handoverUserId}
          memberName={handoverName}
          onClosed={() => void load()}
        />
      </div>

      <Modal
        title={editing ? "编辑员工档案" : "新增员工档案"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            label="成员账号"
            name="memberUserId"
            rules={[{ required: true, message: "请填写成员登录账号 ID" }]}
          >
            <Input placeholder="登录用户名对应的账号 ID" disabled={Boolean(editing)} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="工号" name="employeeNo">
              <Input placeholder="可选" maxLength={32} />
            </Form.Item>
            <Form.Item label="部门" name="department">
              <Input placeholder="如 研发中心" maxLength={64} />
            </Form.Item>
            <Form.Item label="雇佣类型" name="employmentType" initialValue="FULL_TIME">
              <Select options={EMPLOYMENT_OPTIONS} />
            </Form.Item>
            <Form.Item label="时薪（元）" name="hourlyRate" initialValue={0}>
              <InputNumber min={0} max={100000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="入职日期" name="joinedAt">
              <Input type="date" />
            </Form.Item>
          </div>
          <Form.Item label="直属主管账号" name="supervisorUserId">
            <Input placeholder="可选，填成员账号 ID" maxLength={64} />
          </Form.Item>
          <Form.Item label="技能标签" name="skills">
            <Input placeholder="用「、」或逗号分隔，如：Java、项目管理" />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <AiResultModal
        open={attritionOpen}
        title={`AI 离职风险 · ${attritionName}`}
        loading={attritionLoading}
        mode={attrition?.mode}
        model={attrition?.model}
        onClose={() => setAttritionOpen(false)}
      >
        {attrition ? (
          <>
            <Space>
              <span>
                风险评分 <strong>{attrition.score}</strong>
              </span>
              <AiLevelTag level={attrition.level} />
            </Space>
            <AiList title="风险因素" items={attrition.reasons} />
            <AiList title="留人建议" items={attrition.suggestions} />
          </>
        ) : null}
      </AiResultModal>
    </Panel>
  );
}
