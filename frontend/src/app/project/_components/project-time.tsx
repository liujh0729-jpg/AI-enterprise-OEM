"use client";

import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Table,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { projectApi } from "@/api/project";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import {
  Toolbar,
  day,
  hours,
  pjError,
  timeStatusTag,
  type PjProject,
  type PjTimeLog,
  type PjTimesheet,
} from "./project-common";

export function PjTimeTab({ staff }: { staff: { value: string; label: string }[] }) {
  const [mode, setMode] = useState("logs");
  const [projects, setProjects] = useState<PjProject[]>([]);
  const [logs, setLogs] = useState<PjTimeLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logStatus, setLogStatus] = useState("");
  const [sheets, setSheets] = useState<PjTimesheet[]>([]);
  const [sheetTotal, setSheetTotal] = useState(0);
  const [sheetPage, setSheetPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [logOpen, setLogOpen] = useState(false);
  const [logForm] = Form.useForm();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetForm] = Form.useForm();

  useEffect(() => {
    void projectApi
      .projects({ query: { page: 1, pageSize: 100 } })
      .then((data) => setProjects(data?.list || []))
      .catch(() => setProjects([]));
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.timeLogs({
        query: { page: logPage, pageSize: 20, status: logStatus || undefined },
      });
      setLogs(data?.list || []);
      setLogTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setLoading(false);
    }
  }, [logPage, logStatus]);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.timesheets({ query: { page: sheetPage, pageSize: 20 } });
      setSheets(data?.list || []);
      setSheetTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setLoading(false);
    }
  }, [sheetPage]);

  useEffect(() => {
    if (mode === "logs") void loadLogs();
    else void loadSheets();
  }, [mode, loadLogs, loadSheets]);

  const addLog = async () => {
    try {
      const values = await logForm.validateFields();
      await projectApi.addTimeLog({
        body: {
          projectId: values.projectId,
          taskId: Number(values.taskId || 0),
          workDate: values.workDate,
          startAt: "",
          endAt: "",
          durationMinutes: Number(values.durationMinutes || 0),
          note: values.note || "",
          source: "MANUAL",
        },
      });
      message.success("已登记工时");
      setLogOpen(false);
      logForm.resetFields();
      await loadLogs();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    }
  };

  const decideLog = async (row: PjTimeLog, decision: "approve" | "reject") => {
    try {
      await projectApi.decideTimeLog({ body: { id: row.id, decision, note: "" } });
      await loadLogs();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const removeLog = async (row: PjTimeLog) => {
    try {
      await projectApi.removeTimeLog({ body: { id: row.id } });
      await loadLogs();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const generateSheet = async () => {
    try {
      const values = await sheetForm.validateFields();
      await projectApi.generateTimesheet({
        body: {
          principalType: "STAFF",
          principalId: values.principalId,
          periodStart: values.periodStart,
          periodEnd: values.periodEnd,
        },
      });
      message.success("已生成周表");
      setSheetOpen(false);
      sheetForm.resetFields();
      await loadSheets();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    }
  };

  const decideSheet = async (row: PjTimesheet, decision: "approve" | "reject") => {
    try {
      await projectApi.decideTimesheet({ body: { id: row.id, decision, note: "" } });
      await loadSheets();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const logColumns: ColumnsType<PjTimeLog> = [
    { title: "日期", dataIndex: "workDate", width: 110, render: (v: string) => day(v) },
    { title: "项目", dataIndex: "projectName", width: 160 },
    { title: "任务", dataIndex: "taskTitle", render: (v: string) => v || "—" },
    { title: "人员", dataIndex: "principalName", width: 110 },
    { title: "时长", dataIndex: "durationMinutes", width: 90, render: (v: number) => hours(v) },
    { title: "来源", dataIndex: "source", width: 90, render: (v: string) => ({ TIMER: "计时器", MANUAL: "手工", FEISHU: "飞书", WECOM: "企微" })[v] || v },
    { title: "状态", dataIndex: "status", width: 90, render: (v: string) => timeStatusTag(v) },
    { title: "备注", dataIndex: "note", render: (v: string) => v || "—" },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, row) =>
        row.status === "SUBMITTED" ? (
          <>
            <Button type="link" size="small" onClick={() => void decideLog(row, "approve")}>
              通过
            </Button>
            <Button type="link" size="small" danger onClick={() => void decideLog(row, "reject")}>
              驳回
            </Button>
          </>
        ) : (
          <Button type="link" size="small" danger onClick={() => void removeLog(row)}>
            删除
          </Button>
        ),
    },
  ];

  const sheetColumns: ColumnsType<PjTimesheet> = [
    { title: "人员", dataIndex: "principalName" },
    { title: "周期", dataIndex: "periodStart", render: (_: string, row) => `${day(row.periodStart)} ~ ${day(row.periodEnd)}` },
    { title: "项目", dataIndex: "projectName", render: (v: string) => v || "全部项目" },
    { title: "合计", dataIndex: "totalMinutes", render: (v: number) => hours(v) },
    { title: "状态", dataIndex: "status", render: (v: string) => timeStatusTag(v) },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, row) =>
        row.status === "SUBMITTED" ? (
          <>
            <Button type="link" size="small" onClick={() => void decideSheet(row, "approve")}>
              通过
            </Button>
            <Button type="link" size="small" danger onClick={() => void decideSheet(row, "reject")}>
              驳回
            </Button>
          </>
        ) : null,
    },
  ];

  return (
    <Panel
      title={mode === "logs" ? "工时流水" : "工时周表"}
      extra={
        <>
          <PillTabs
            items={[
              { key: "logs", label: "工时流水" },
              { key: "sheets", label: "工时周表" },
            ]}
            value={mode}
            onChange={setMode}
            size="small"
            variant="soft"
          />
          <Button
            type="primary"
            onClick={() => (mode === "logs" ? setLogOpen(true) : setSheetOpen(true))}
          >
            {mode === "logs" ? "登记工时" : "生成周表"}
          </Button>
        </>
      }
    >
      {mode === "logs" ? (
        <>
          <Toolbar hint={`共 ${logTotal} 条工时记录`}>
            <PillTabs
              items={[
                { key: "", label: "全部" },
                { key: "SUBMITTED", label: "待审批" },
                { key: "APPROVED", label: "已通过" },
                { key: "REJECTED", label: "已驳回" },
              ]}
              value={logStatus}
              onChange={(key) => {
                setLogStatus(key);
                setLogPage(1);
              }}
              size="small"
              variant="soft"
            />
          </Toolbar>
          {error ? <Notice variant="error">{error}</Notice> : null}
          <Table<PjTimeLog>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={logColumns}
            dataSource={logs}
            scroll={{ x: "max-content" }}
            pagination={{ current: logPage, pageSize: 20, total: logTotal, showSizeChanger: false, onChange: setLogPage }}
            locale={{ emptyText: "暂无工时记录" }}
          />
        </>
      ) : (
        <>
          {error ? <Notice variant="error">{error}</Notice> : null}
          <Table<PjTimesheet>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={sheetColumns}
            dataSource={sheets}
            scroll={{ x: "max-content" }}
            pagination={{ current: sheetPage, pageSize: 20, total: sheetTotal, showSizeChanger: false, onChange: setSheetPage }}
            locale={{ emptyText: "暂无周表" }}
          />
        </>
      )}

      <Modal
        open={logOpen}
        title="登记工时"
        onCancel={() => setLogOpen(false)}
        onOk={() => void addLog()}
        destroyOnHidden
      >
        <Form form={logForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="projectId" label="项目" rules={[{ required: true, message: "请选择项目" }]}>
                <Select options={projects.map((row) => ({ value: row.id, label: row.name }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="taskId" label="任务 ID（可选）">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="workDate" label="工作日期" rules={[{ required: true, message: "请选择日期" }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="durationMinutes" label="时长（分钟）" rules={[{ required: true, message: "请填写时长" }]}>
                <InputNumber style={{ width: "100%" }} min={0} max={1440} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="note" label="工作说明">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={sheetOpen}
        title="生成工时周表"
        onCancel={() => setSheetOpen(false)}
        onOk={() => void generateSheet()}
        destroyOnHidden
      >
        <Form form={sheetForm} layout="vertical">
          <Form.Item name="principalId" label="人员" rules={[{ required: true, message: "请选择人员" }]}>
            <Select showSearch optionFilterProp="label" options={staff} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="periodStart" label="周期开始" rules={[{ required: true, message: "请选择开始日期" }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="periodEnd" label="周期结束" rules={[{ required: true, message: "请选择结束日期" }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Panel>
  );
}
