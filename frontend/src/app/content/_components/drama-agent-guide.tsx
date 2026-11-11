"use client";

import { ExportOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { Notice, Panel } from "@/components/ui/panel";

/** AIPDD Drama Agent 的发布页：本站只指路，不托管安装包。 */
const DRAMA_RELEASES_URL =
  "https://github.com/liujh0729-jpg/aipdd-drama-agent/releases";

const GATEWAY_OPTIONS = [
  {
    name: "官方（推荐）",
    detail:
      "粘贴 AIPDD（www.aipdd.work）或 AIworkin（www.aiworkin.com）账号的 API Key，保存即用。官方网关已经把这套工具需要的全部模型映射配好，什么都不用调，NewAPI 保持空闲。",
  },
  {
    name: "自定义",
    detail:
      "一键初始化 NewAPI，再在它自己的管理页里添加你的供应商渠道（API Key、模型 ID）。此后每一个模型都走你自己的渠道。",
  },
  {
    name: "NewAPI + 官方混合",
    detail:
      "主链路继续用官方模型，额外渠道（比如本地 ComfyUI 视频工作流）走 NewAPI。",
  },
];

/**
 * 「视频创作工具」是装在用户自己电脑上的外部项目：点卡片先看简介与网关配置，
 * 这一页唯一的对外动作是跳到它的下载页。
 */
export function DramaAgentGuide() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title="工具简介"
        titleExtra={
          <span className="text-12 muted">
            AIPDD Drama Agent · 本地部署的 AI 短剧与视频生产线
          </span>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            一套装在自己电脑上的 AI 短剧制作工具：无限画布 + 内置「导演」Agent
            自动逐镜生成，约 100 个 MCP 工具覆盖从原稿到成片的整条链路。
          </div>
          <div>
            流程：<strong>结构化导入（原稿 / 剧本）→ 剧集规划与剧本生成 →
            分镜与首帧 → 配音、合成与导出</strong>
          </div>
          <div className="text-12 muted">
            整条链路在本地跑、默认不向外发数据；本系统只做入口与配置说明，
            不托管安装包、不保存这里的创作数据，也不代管它的账号。
          </div>
        </div>
      </Panel>

      <Panel
        title="怎么配置网关"
        titleExtra={
          <span className="text-12 muted">打开工具后进入「设置 → 模型与渠道」，三选一</span>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Notice variant="success">
            最省事的一条：<strong>直接粘贴 AIPDD（www.aipdd.work）或
            AIworkin（www.aiworkin.com）账号的 API Key，保存即用</strong>
            ，模型已经全部映射好，不需要再配上游、也不需要自建网关。
          </Notice>
          <div style={{ display: "grid", gap: 10 }}>
            {GATEWAY_OPTIONS.map((option, index) => (
              <div
                key={option.name}
                style={{
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <Tag style={{ marginInlineStart: 0 }}>{`方式 ${index + 1}`}</Tag>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong>{option.name}</strong>
                  <span className="text-12 muted">{option.detail}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="text-12 muted">
            Key 从哪来：本站「模型服务 → API Key 管理」里列出的 sk- Key
            就是平台签发的那把（内容创作、数字资产、RPA 与 Workbuddy
            的模型调用都共用它），复制过来直接粘贴即可。
          </div>
        </div>
      </Panel>

      <Panel
        title="下载与安装"
        extra={
          <Button
            type="primary"
            icon={<ExportOutlined aria-hidden />}
            onClick={() =>
              window.open(DRAMA_RELEASES_URL, "_blank", "noopener,noreferrer")
            }
          >
            前往下载页面
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            1. 点右上角「前往下载页面」，在 GitHub Releases 下载最新包（也可以直接
            clone 仓库）。
          </div>
          <div>
            2. macOS 双击 <code>安装环境-Setup.command</code>，再双击{" "}
            <code>启动系统-Start.command</code>；Windows 双击{" "}
            <code>安装环境-Setup.bat</code>，再双击 <code>启动系统-Start.bat</code>。
          </div>
          <div>
            3. 浏览器打开 <code>http://localhost:8080</code>，首次进入「设置 →
            模型与渠道」粘 Key。
          </div>
          <div className="text-12 muted">
            运行环境：macOS（Apple Silicon / Intel）、Windows（WSL2）、Linux（Docker
            Engine），三种方式都需要本机装好 Docker；标准流程不需要 GPU，≥2 vCPU /
            4 GB 内存即可（构建时建议 ≥8 GB）。
          </div>
        </div>
      </Panel>
    </div>
  );
}
