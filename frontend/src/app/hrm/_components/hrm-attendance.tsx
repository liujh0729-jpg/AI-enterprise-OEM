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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hrmApi,
  type HrmAttendanceLog,
  type HrmBalance,
  type HrmHoliday,
  type HrmPolicy,
  type HrmTimeOff,
} from "@/api/hrm";
import { Panel } from "@/components/ui/panel";
import {
  STATUS_COLORS,
  TIMEOFF_STATUS_LABELS,
  TIMEOFF_STATUS_OPTIONS,
  TIMEOFF_TYPE_LABELS,
  TIMEOFF_TYPE_OPTIONS,
  hrmError,
  shortDate,
} from "./hrm-common";

const PAGE_SIZE = 20;
const QUOTA_TYPES = ["ANNUAL", "SICK", "PERSONAL", "MARRY", "BEREAVEMENT", "UNPAID"] as const;
const DEFAULT_QUOTAS: Record<string, number> = {
  ANNUAL: 5,
  SICK: 10,
  PERSONAL: 3,
  MARRY: 3,
  BEREAVEMENT: 3,
  UNPAID: 0,
};

type TimeOffPage = { list: HrmTimeOff[]; total: number; page: number; pageSize: number };
type AttendancePage = { list: HrmAttendanceLog[]; total: number; page: number; pageSize: number };

/** 假勤：打卡/补卡、请假审批、假期政策与余额、节假日。 */
export function HrmAttendanceTab({ reloadKey }: { reloadKey: number }) {
  const { message } = App.useApp();
  const year = useMemo(() => new Date().getFullYear(), []);
  const [policies, setPolicies] = useState<HrmPolicy[]>([]);
  const [balances, setBalances] = useState<HrmBalance[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffPage | null>(null);
  const [attendance, setAttendance] = useState<AttendancePage | null>(null);
  const [holidays, setHolidays] = useState<HrmHoliday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [leavePage, setLeavePage] = useState(1);
  const [leaveStatus, setLeaveStatus] = useState<string | undefined>();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [remedyOpen, setRemedyOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaveForm] = Form.useForm();
  const [remedyForm] = Form.useForm();
  const [policyForm] = Form.useForm();
  const [holidayForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [policyRows, balanceRows, leave, attendanceRows, holidayRows] =
        await Promise.all([
          hrmApi.listPolicies({ query: { year } }),
          hrmApi.listBalances({ query: { year } }),
          hrmApi.listTimeOff({
            query: { page: leavePage, pageSize: PAGE_SIZE, status: leaveStatus },
          }),
          hrmApi.listAttendance({ query: { page: 1, pageSize: PAGE_SIZE } }),
          hrmApi.listHolidays({ query: { year } }),
        ]);
      setPolicies(policyRows || []);
      setBalances(balanceRows || []);
      setTimeOff(leave);
      setAttendance(attendanceRows);
      setHolidays(holidayRows || []);
      setError("");
    } catch (err) {
      setError(hrmError(err));
    } finally {
      setLoading(false);
    }
  }, [year, leavePage, leaveStatus]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      message.success(success);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const clock = (checkType: "CLOCK_IN" | "CLOCK_OUT") =>
    run(
      () => hrmApi.clock({ body: { note: "" } }),
      checkType === "CLOCK_IN" ? "上班卡已记录" : "下班卡已记录",
    );

  const submitLeave = async () => {
    const values = await leaveForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.createTimeOff({
        body: {
          type: values.type,
          startDate: values.startDate,
          endDate: values.endDate,
          reason: values.reason || "",
        },
      });
      message.success("请假申请已提交");
      setLeaveOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRemedy = async () => {
    const values = await remedyForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.remedyClock({
        body: {
          logDate: values.logDate,
          checkType: values.checkType,
          at: `${values.logDate}T${values.time || "09:00"}:00`,
          reason: values.reason,
        },
      });
      message.success("补卡已提交");
      setRemedyOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPolicy = async () => {
    const values = await policyForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.savePolicy({
        body: {
          year: Number(values.year),
          name: values.name || "默认",
          quotas: Object.fromEntries(
            QUOTA_TYPES.map((type) => [type, Number(values[type]) || 0]),
          ),
          isDefault: true,
        },
      });
      message.success("假期政策已保存");
      setPolicyOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitHoliday = async () => {
    const values = await holidayForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.addHoliday({
        body: {
          holidayDate: values.holidayDate,
          name: values.name,
          days: Number(values.days) || 1,
        },
      });
      message.success("节假日已添加");
      setHolidayOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const currentPolicy = policies.find((item) => item.isDefault) || policies[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error ? <div style={{ color: "#cf1322" }}>{error}</div> : null}

      <Panel
        title="今日打卡"
        titleExtra={<span className="muted text-12">打卡记录进入考勤台账；漏卡可提交补卡申请</span>}
        extra={
          <Space>
            <Button loading={busy} onClick={() => void clock("CLOCK_IN")}>
              上班卡
            </Button>
            <Button loading={busy} onClick={() => void clock("CLOCK_OUT")}>
              下班卡
            </Button>
            <Button onClick={() => setRemedyOpen(true)}>补卡</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={attendance?.list || []}
          locale={{ emptyText: "还没有打卡记录" }}
          pagination={{ pageSize: PAGE_SIZE, total: attendance?.total || 0, showSizeChanger: false }}
          columns={[
            { title: "日期", dataIndex: "logDate", width: 120, render: (v: string) => shortDate(v) },
            {
              title: "类型",
              dataIndex: "checkType",
              width: 100,
              render: (v: string) =>
                ({ CLOCK_IN: "上班", CLOCK_OUT: "下班", REMEDY: "补卡" } as Record<string, string>)[v] || v,
            },
            { title: "时间", dataIndex: "at", width: 180, render: (v: string) => v || "—" },
            {
              title: "结果",
              dataIndex: "mark",
              width: 100,
              render: (v: string) => (
                <Tag color={({ NORMAL: "green", LATE: "gold", EARLY: "orange", ABSENT: "red" } as Record<string, string>)[v]}>
                  {({ NORMAL: "正常", LATE: "迟到", EARLY: "早退", ABSENT: "缺勤" } as Record<string, string>)[v] || v}
                </Tag>
              ),
            },
            { title: "来源", dataIndex: "source", width: 100 },
            { title: "备注", dataIndex: "note", render: (v: string) => v || "—" },
          ]}
        />
      </Panel>

      <Panel
        title="请假申请"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="状态"
              style={{ width: 140 }}
              options={TIMEOFF_STATUS_OPTIONS}
              value={leaveStatus}
              onChange={(value) => {
                setLeavePage(1);
                setLeaveStatus(value);
              }}
            />
            <Button type="primary" onClick={() => {
              leaveForm.resetFields();
              setLeaveOpen(true);
            }}>
              发起请假
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={timeOff?.list || []}
          locale={{ emptyText: "还没有请假记录" }}
          pagination={{
            current: leavePage,
            pageSize: PAGE_SIZE,
            total: timeOff?.total || 0,
            showSizeChanger: false,
            onChange: setLeavePage,
          }}
          columns={[
            { title: "成员", dataIndex: "staffUserId", width: 140 },
            {
              title: "假别",
              dataIndex: "type",
              width: 100,
              render: (v: string) => TIMEOFF_TYPE_LABELS[v] || v,
            },
            {
              title: "起止",
              width: 190,
              render: (_: unknown, row: HrmTimeOff) => `${shortDate(row.startDate)} ~ ${shortDate(row.endDate)}`,
            },
            { title: "天数", dataIndex: "days", width: 80 },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => (
                <Tag color={STATUS_COLORS[v]}>{TIMEOFF_STATUS_LABELS[v] || v}</Tag>
              ),
            },
            { title: "事由", dataIndex: "reason", render: (v: string) => v || "—" },
            {
              title: "操作",
              width: 200,
              render: (_: unknown, row: HrmTimeOff) => (
                <Space size={4}>
                  {row.status === "PENDING" ? (
                    <>
                      <Button type="link" size="small" onClick={() => void run(() => hrmApi.decideTimeOff({ body: { id: row.id, decision: "approve", note: "" } }), "已批准")}>
                        批准
                      </Button>
                      <Button type="link" size="small" danger onClick={() => void run(() => hrmApi.decideTimeOff({ body: { id: row.id, decision: "reject", note: "" } }), "已驳回")}>
                        驳回
                      </Button>
                      <Button type="link" size="small" onClick={() => void run(() => hrmApi.decideTimeOff({ body: { id: row.id, decision: "cancel", note: "" } }), "已撤销")}>
                        撤销
                      </Button>
                    </>
                  ) : null}
                  {row.status === "APPROVED" ? (
                    <Button type="link" size="small" onClick={() => void run(() => hrmApi.decideTimeOff({ body: { id: row.id, decision: "revoke", note: "" } }), "已收回")}>
                      收回
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="假期政策与余额"
        titleExtra={
          <span className="muted text-12">
            {currentPolicy
              ? `当前政策：${currentPolicy.name}（${currentPolicy.year} 年）`
              : "还没有政策，保存后自动为成员建余额"}
          </span>
        }
        extra={<Button onClick={() => {
          policyForm.resetFields();
          policyForm.setFieldsValue({
            year,
            name: currentPolicy?.name || "默认",
            ...Object.fromEntries(
              QUOTA_TYPES.map((type) => [type, Number(currentPolicy?.quotas?.[type] ?? DEFAULT_QUOTAS[type])]),
            ),
          });
          setPolicyOpen(true);
        }}>配置政策</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={balances}
          locale={{ emptyText: "还没有假期余额" }}
          pagination={false}
          columns={[
            { title: "成员", dataIndex: "staffUserId", width: 160 },
            { title: "年度", dataIndex: "year", width: 90 },
            {
              title: "假别",
              dataIndex: "type",
              width: 100,
              render: (v: string) => TIMEOFF_TYPE_LABELS[v] || v,
            },
            { title: "年度额度", dataIndex: "totalDays", width: 110 },
            { title: "已用", dataIndex: "usedDays", width: 100 },
          ]}
        />
      </Panel>

      <Panel
        title="节假日"
        titleExtra={<span className="muted text-12">请假天数按工作日计算，会扣减这里维护的节假日</span>}
        extra={<Button onClick={() => {
          holidayForm.resetFields();
          setHolidayOpen(true);
        }}>添加节假日</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={holidays}
          locale={{ emptyText: "还没有节假日" }}
          pagination={false}
          columns={[
            { title: "日期", dataIndex: "holidayDate", width: 140, render: (v: string) => shortDate(v) },
            { title: "名称", dataIndex: "name" },
            { title: "天数", dataIndex: "days", width: 90 },
          ]}
        />
      </Panel>

      <Modal title="发起请假" open={leaveOpen} onCancel={() => setLeaveOpen(false)} onOk={() => void submitLeave()} confirmLoading={busy} destroyOnHidden>
        <Form form={leaveForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="假别" name="type" rules={[{ required: true, message: "请选择假别" }]} initialValue="ANNUAL">
            <Select options={TIMEOFF_TYPE_OPTIONS} />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="开始日期" name="startDate" rules={[{ required: true, message: "请选择开始日期" }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item label="结束日期" name="endDate" rules={[{ required: true, message: "请选择结束日期" }]}>
              <Input type="date" />
            </Form.Item>
          </div>
          <Form.Item label="事由" name="reason">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="补卡" open={remedyOpen} onCancel={() => setRemedyOpen(false)} onOk={() => void submitRemedy()} confirmLoading={busy} destroyOnHidden>
        <Form form={remedyForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="补卡日期" name="logDate" rules={[{ required: true, message: "请选择日期" }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item label="补卡时间" name="time" initialValue="09:00">
              <Input type="time" />
            </Form.Item>
            <Form.Item label="类型" name="checkType" initialValue="CLOCK_IN">
              <Select options={[
                { value: "CLOCK_IN", label: "上班卡" },
                { value: "CLOCK_OUT", label: "下班卡" },
              ]} />
            </Form.Item>
          </div>
          <Form.Item label="原因" name="reason" rules={[{ required: true, message: "请填写补卡原因" }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="假期政策" open={policyOpen} onCancel={() => setPolicyOpen(false)} onOk={() => void submitPolicy()} confirmLoading={busy} destroyOnHidden>
        <Form form={policyForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="年度" name="year" rules={[{ required: true }]} initialValue={year}>
              <InputNumber min={2000} max={2100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="政策名称" name="name" initialValue="默认">
              <Input maxLength={64} />
            </Form.Item>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {QUOTA_TYPES.map((type) => (
              <Form.Item key={type} label={`${TIMEOFF_TYPE_LABELS[type]}（天）`} name={type}>
                <InputNumber min={0} max={365} style={{ width: "100%" }} />
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>

      <Modal title="添加节假日" open={holidayOpen} onCancel={() => setHolidayOpen(false)} onOk={() => void submitHoliday()} confirmLoading={busy} destroyOnHidden>
        <Form form={holidayForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="日期" name="holidayDate" rules={[{ required: true, message: "请选择日期" }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item label="名称" name="name" rules={[{ required: true, message: "请填写名称" }]}>
              <Input maxLength={64} placeholder="如 国庆节" />
            </Form.Item>
            <Form.Item label="天数" name="days" initialValue={1}>
              <InputNumber min={0} max={3} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
