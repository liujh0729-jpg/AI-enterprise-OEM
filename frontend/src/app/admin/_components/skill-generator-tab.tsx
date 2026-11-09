"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  Input,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  CloudDownloadOutlined,
  EyeOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  skillGeneratorApi,
  type GeneratedSkill,
  type SkillGeneratorDomain,
} from "@/api/skill-generator";
import { useSiteBase } from "@/lib/site-brand";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, useAdminData } from "./common";

/* ============================================================
   平台管理后台「生成 Skill」：
   - 目录从 MCP 动作清单派生，接口增加时自动长出新业务域；
   - 勾选部分/全部 MCP 动作，填写技能名与展示名后逐个生成；
   - 产物是根目录带 SKILL.md 的标准 zip，可直接下载并发布到 SkillHub。
   ============================================================ */

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

type Draft = { name: string; displayName: string };
type RunState = {
  status: "idle" | "running" | "done" | "error";
  message?: string;
  result?: GeneratedSkill;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-._]{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 56);
}

function defaultDraft(domain: SkillGeneratorDomain): Draft {
  return {
    name: `${slugify(domain.domain) || "skill"}-mcp`,
    displayName: `${domain.label} MCP 助手`,
  };
}

/** base64 → Blob 并触发浏览器下载；不经过服务端二次请求。 */
function downloadZip(result: GeneratedSkill) {
  const binary = atob(result.zipBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename || `${result.slug}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const STATUS_LABEL: Record<
  RunState["status"],
  { text: string; color: string }
> = {
  idle: { text: "待生成", color: "default" },
  running: { text: "生成中", color: "processing" },
  done: { text: "已生成", color: "green" },
  error: { text: "失败", color: "red" },
};

export function SkillGeneratorTab() {
  const { message } = App.useApp();
  const siteBase = useSiteBase();
  const { data, denied, loading, reload } = useAdminData(
    "admin-skill-generator-catalog",
    (signal) => skillGeneratorApi.catalog({}, { signal }),
  );

  const domains = useMemo(() => data?.domains ?? [], [data]);
  const baseUrl = data?.baseUrl || siteBase;
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<GeneratedSkill | null>(null);
  const [previewTab, setPreviewTab] = useState("skill");

  useEffect(() => {
    if (!domains.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const domain of domains) {
        if (!next[domain.domain]) next[domain.domain] = defaultDraft(domain);
      }
      return next;
    });
  }, [domains]);

  const toggleOperation = (domain: SkillGeneratorDomain, id: string) => {
    setSelected((prev) => {
      const current = new Set(prev[domain.domain] ?? []);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [domain.domain]: [...current] };
    });
  };

  const toggleDomain = (domain: SkillGeneratorDomain, checked: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [domain.domain]: checked
        ? domain.operations.map((item) => item.operationId)
        : [],
    }));
  };

  const selectAll = (checked: boolean) => {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, string[]> = {};
    for (const domain of domains) {
      next[domain.domain] = domain.operations.map((item) => item.operationId);
    }
    setSelected(next);
  };

  const patchDraft = (domain: string, part: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [domain]: { ...(prev[domain] ?? { name: "", displayName: "" }), ...part },
    }));
  };

  const targets = useMemo(
    () =>
      domains.filter(
        (domain) => (selected[domain.domain] ?? []).length > 0,
      ),
    [domains, selected],
  );

  const allSelected =
    domains.length > 0 && targets.length === domains.length;
  const someSelected = targets.length > 0 && !allSelected;
  const totalOperations = targets.reduce(
    (sum, domain) => sum + (selected[domain.domain] ?? []).length,
    0,
  );

  const invalidTarget = targets.find((domain) => {
    const draft = drafts[domain.domain];
    return !draft || !NAME_RE.test(draft.name) || !draft.displayName.trim();
  });
  const duplicateName = useMemo(() => {
    const seen = new Set<string>();
    for (const domain of targets) {
      const name = drafts[domain.domain]?.name;
      if (!name) continue;
      if (seen.has(name)) return name;
      seen.add(name);
    }
    return "";
  }, [targets, drafts]);

  const generate = async () => {
    if (!targets.length) {
      message.warning("请先勾选要生成的 MCP 动作");
      return;
    }
    if (invalidTarget) {
      message.error(
        `「${invalidTarget.label}」的技能名或展示名不合法：技能名只用小写字母、数字、点、下划线和短横线`,
      );
      return;
    }
    if (duplicateName) {
      message.error(`技能名「${duplicateName}」重复，请改成不同的名字`);
      return;
    }
    setGenerating(true);
    setRuns((prev) => {
      const next = { ...prev };
      for (const domain of targets) {
        next[domain.domain] = { status: "idle" };
      }
      return next;
    });
    let succeeded = 0;
    for (const domain of targets) {
      const draft = drafts[domain.domain]!;
      setRuns((prev) => ({
        ...prev,
        [domain.domain]: { status: "running" },
      }));
      try {
        const result = await skillGeneratorApi.generate({
          name: draft.name,
          displayName: draft.displayName.trim(),
          description: "",
          domain: domain.domain,
          operationIds: selected[domain.domain] ?? [],
          baseUrl,
        });
        if (!result) throw new Error("生成接口没有返回技能包");
        succeeded += 1;
        setRuns((prev) => ({
          ...prev,
          [domain.domain]: { status: "done", result },
        }));
      } catch (error) {
        const text =
          error instanceof Error ? error.message : "生成失败，请重试";
        setRuns((prev) => ({
          ...prev,
          [domain.domain]: { status: "error", message: text },
        }));
        if (error instanceof Error) presentMutationError(error, message.error);
      }
    }
    setGenerating(false);
    if (succeeded === targets.length) {
      message.success(`已逐个生成 ${succeeded} 个技能包，可分别下载`);
    } else if (succeeded > 0) {
      message.warning(
        `生成完成：成功 ${succeeded} 个，失败 ${targets.length - succeeded} 个，可单独重试`,
      );
    }
  };

  const downloadAll = () => {
    const results = Object.values(runs)
      .map((run) => run.result)
      .filter((item): item is GeneratedSkill => Boolean(item));
    if (!results.length) {
      message.warning("还没有可下载的技能包");
      return;
    }
    results.forEach((result) => downloadZip(result));
  };

  const doneCount = targets.filter(
    (domain) => runs[domain.domain]?.status === "done",
  ).length;
  const downloadCount = Object.values(runs).filter((run) => run.result).length;

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="MCP 能力目录"
        titleBadge={
          <span className="text-12 muted">
            目录随本系统 MCP 接口自动增长，无需维护第二份清单
          </span>
        }
        extra={<Button onClick={() => void reload()}>刷新目录</Button>}
      >
        <Notice variant={baseUrl && data?.siteConfigured === false ? "warn" : "info"}>
          {baseUrl ? (
            <>
              本系统 MCP 接入地址：<span className="mono">{baseUrl}{data?.endpointPath || "/api/v1/mcp"}</span>。
              生成时会写进技能包，用户安装后用本账号的 <span className="mono">ek_</span> Key 调用。
            </>
          ) : (
            <>
              还没确定本站对外域名。请先到
              <Link href="/admin/settings">「系统设置 → 站点设置」</Link>
              配置公网域名；只有公网 DNS 域名才能写进可公开发布的技能包。
            </>
          )}
          {baseUrl && data?.siteConfigured === false ? (
            <span>
              {" "}
              当前使用的是后台访问地址；若它不是公网域名，发布前请先配置站点域名。
            </span>
          ) : null}
        </Notice>

        {loading ? <div style={{ marginTop: 12 }}>正在读取 MCP 目录…</div> : null}
        {!loading && !domains.length ? (
          <EmptyState text="MCP 目录为空：请确认业务接口已在契约中登记。" />
        ) : null}

        {domains.length ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                margin: "14px 0 10px",
              }}
            >
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={(event) => selectAll(event.target.checked)}
              >
                全选全部 MCP
              </Checkbox>
              <span className="text-12 muted">
                已选 {targets.length} 个业务域 / {totalOperations} 个动作
              </span>
              <Button
                size="small"
                onClick={() => setSelected({})}
              >
                清空选择
              </Button>
              <span style={{ marginLeft: "auto" }} />
              <Button
                type="primary"
                icon={<ThunderboltOutlined aria-hidden />}
                loading={generating}
                disabled={
                  !targets.length || Boolean(invalidTarget) || Boolean(duplicateName)
                }
                onClick={() => void generate()}
              >
                {generating ? "正在逐个生成…" : `逐个生成（${targets.length}）`}
              </Button>
              <Button
                icon={<CloudDownloadOutlined aria-hidden />}
                disabled={!downloadCount}
                onClick={downloadAll}
              >
                下载全部（{downloadCount}）
              </Button>
            </div>

            <div className="table-wrap">
              <Table<SkillGeneratorDomain>
                rowKey="domain"
                dataSource={domains}
                pagination={false}
                size="middle"
                expandable={{
                  expandedRowRender: (domain) => (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(320px, 1fr))",
                        gap: 8,
                      }}
                    >
                      {domain.operations.map((operation) => (
                        <Checkbox
                          key={operation.operationId}
                          checked={(selected[domain.domain] ?? []).includes(
                            operation.operationId,
                          )}
                          onChange={() =>
                            toggleOperation(domain, operation.operationId)
                          }
                        >
                          <span className="text-12">
                            <span style={{ fontWeight: 500 }}>
                              {operation.label}
                            </span>{" "}
                            <span className="mono muted">
                              {operation.method.toUpperCase()} {operation.path}
                            </span>{" "}
                            <Tag
                              color={operation.write ? "orange" : "green"}
                              style={{ marginInlineEnd: 0 }}
                            >
                              {operation.write ? "写" : "读"}
                            </Tag>
                          </span>
                        </Checkbox>
                      ))}
                    </div>
                  ),
                }}
                columns={[
                  {
                    title: "选择",
                    width: 64,
                    render: (_, domain) => {
                      const count = (selected[domain.domain] ?? []).length;
                      return (
                        <Checkbox
                          checked={count > 0 && count === domain.operations.length}
                          indeterminate={
                            count > 0 && count < domain.operations.length
                          }
                          onChange={(event) =>
                            toggleDomain(domain, event.target.checked)
                          }
                        />
                      );
                    },
                  },
                  {
                    title: "业务域",
                    render: (_, domain) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>{domain.label}</div>
                        <div className="mono text-12 muted">{domain.domain}</div>
                      </div>
                    ),
                  },
                  {
                    title: "动作",
                    width: 130,
                    render: (_, domain) => (
                      <span className="text-12">
                        {domain.total} 个
                        <span className="muted">
                          （读 {domain.read} / 写 {domain.write}）
                        </span>
                      </span>
                    ),
                  },
                  {
                    title: "技能名（SkillHub 唯一标识）",
                    width: 230,
                    render: (_, domain) => {
                      const draft = drafts[domain.domain] ?? defaultDraft(domain);
                      const used = (selected[domain.domain] ?? []).length > 0;
                      return (
                        <Input
                          className="mono"
                          value={draft.name}
                          status={
                            used && !NAME_RE.test(draft.name) ? "error" : undefined
                          }
                          maxLength={64}
                          placeholder="如 crm-mcp"
                          onChange={(event) =>
                            patchDraft(domain.domain, {
                              name: event.target.value.trim(),
                            })
                          }
                        />
                      );
                    },
                  },
                  {
                    title: "展示名",
                    width: 220,
                    render: (_, domain) => {
                      const draft = drafts[domain.domain] ?? defaultDraft(domain);
                      return (
                        <Input
                          value={draft.displayName}
                          maxLength={60}
                          placeholder="如 客户管理 MCP 助手"
                          onChange={(event) =>
                            patchDraft(domain.domain, {
                              displayName: event.target.value,
                            })
                          }
                        />
                      );
                    },
                  },
                  {
                    title: "状态",
                    width: 120,
                    render: (_, domain) => {
                      const run = runs[domain.domain] ?? { status: "idle" };
                      const meta = STATUS_LABEL[run.status];
                      return (
                        <Tooltip title={run.message || ""}>
                          <Tag color={meta.color}>{meta.text}</Tag>
                        </Tooltip>
                      );
                    },
                  },
                  {
                    title: "产物",
                    width: 170,
                    render: (_, domain) => {
                      const result = runs[domain.domain]?.result;
                      if (!result) return <span className="text-12 muted">—</span>;
                      return (
                        <Space size={4}>
                          <Button
                            size="small"
                            icon={<CloudDownloadOutlined aria-hidden />}
                            onClick={() => downloadZip(result)}
                          >
                            下载
                          </Button>
                          <Button
                            size="small"
                            icon={<EyeOutlined aria-hidden />}
                            onClick={() => {
                              setPreviewTab("skill");
                              setPreview(result);
                            }}
                          >
                            预览
                          </Button>
                        </Space>
                      );
                    },
                  },
                ]}
              />
            </div>

            {targets.length ? (
              <Progress
                style={{ marginTop: 12, maxWidth: 420 }}
                size="small"
                percent={Math.round((doneCount / targets.length) * 100)}
                format={() => `${doneCount}/${targets.length}`}
              />
            ) : null}
          </>
        ) : null}
      </Panel>

      <PublishGuide skillHubUrl={data?.skillHubUrl || "https://skillhub.cn"} />

      <Modal
        open={Boolean(preview)}
        title={
          preview
            ? `${preview.displayName} · ${preview.operationCount} 个动作`
            : "技能包预览"
        }
        width={820}
        footer={
          preview ? (
            <Space>
              <Button onClick={() => setPreview(null)}>关闭</Button>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined aria-hidden />}
                onClick={() => downloadZip(preview)}
              >
                下载 zip
              </Button>
            </Space>
          ) : null
        }
        onCancel={() => setPreview(null)}
      >
        {preview ? (
          <PanelTabs
            value={previewTab}
            onChange={setPreviewTab}
            items={[
              {
                key: "skill",
                label: "SKILL.md",
                children: (
                  <pre
                    className="mono text-12"
                    style={{
                      margin: 0,
                      maxHeight: 480,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.7,
                    }}
                  >
                    {preview.skillMarkdown}
                  </pre>
                ),
              },
              ...preview.files.map((file) => ({
                key: file.path,
                label: file.path,
                children: (
                  <pre
                    className="mono text-12"
                    style={{
                      margin: 0,
                      maxHeight: 480,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.7,
                    }}
                  >
                    {file.content}
                  </pre>
                ),
              })),
            ]}
          />
        ) : null}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- 发布说明 */

function PublishGuide({ skillHubUrl }: { skillHubUrl: string }) {
  return (
    <Panel
      title="发布到 SkillHub 获取流量"
      titleBadge={
        <span className="text-12 muted">
          本站负责生成与下载，发布动作在 SkillHub 完成
        </span>
      }
      extra={
        <Button
          type="primary"
          ghost
          icon={<RocketOutlined aria-hidden />}
          href={skillHubUrl}
          target="_blank"
          rel="noreferrer"
        >
          打开 SkillHub
        </Button>
      }
    >
      <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
        <li>
          <strong>先生成并下载。</strong>
          在上方勾选业务域与动作，填好技能名、展示名，点「逐个生成」；每个业务域产出一个根目录带{" "}
          <span className="mono">SKILL.md</span> 的标准 zip。
        </li>
        <li>
          <strong>检查包内容。</strong>
          点「预览」确认动作清单与调用示例准确；包内只应出现本站域名，不应有真实密钥、内网地址或 shell
          命令。生成物已经过平台安全校验，发布前仍建议人工过一眼。
        </li>
        <li>
          <strong>到 SkillHub 发布。</strong>
          用发布者账号登录{" "}
          <a href={skillHubUrl} target="_blank" rel="noreferrer">
            {skillHubUrl}
          </a>
          ，进入「发布技能 / 上传技能包」，上传刚下载的 zip。技能名保持与包内{" "}
          <span className="mono">name</span> 一致，展示名可写业务场景（如「客户管理 MCP 助手」）。
        </li>
        <li>
          <strong>把说明写成搜索入口。</strong>
          简介里写清「能做什么 + 适合谁 + 需要什么前置条件」，关键词覆盖业务域、常见任务与「MCP」；分类选「开发编程」。
          说明越具体，被搜到和安装的概率越高。
        </li>
        <li>
          <strong>给出可复制的接入步骤。</strong>
          在详情页补充：MCP 接入地址、<span className="mono">Authorization: Bearer &lt;用户的 ek_ Key&gt;</span>{" "}
          鉴权方式、支持的客户端，以及一个读动作、一个写动作的调用示例。
        </li>
        <li>
          <strong>持续更新换流量。</strong>
          本系统新增接口后回到这里重新生成同名技能包（版本号递增、changelog 写清新增动作），在 SkillHub
          发布新版本，已安装用户会收到更新提示。
        </li>
        <li>
          <strong>流量如何回流。</strong>
          用户从 SkillHub 安装技能后，技能里的 MCP 地址指向本系统；用户用自己的{" "}
          <span className="mono">ek_</span> Key 调用，接口请求、账号注册与后续用量都回到本站。
        </li>
      </ol>
      <Notice variant="info">
        <SafetyCertificateOutlined aria-hidden /> 不要在技能包或 SkillHub 详情里写任何真实密钥、数据库连接串或
        Cookie；写动作必须提示用户先在「智能体记忆 → 可自动执行的动作」里授权，未授权时服务端只返回草案。
      </Notice>
    </Panel>
  );
}
