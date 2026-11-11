"use client";

import {
  CheckCircleOutlined,
  ChromeOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { Badge, Button, Drawer, Spin, Tooltip } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { platformApi, type ExtensionInfo } from "@/api/platform";
import { rpaChromeApi } from "@/api/rpa-chrome";
import { Notice, PanelTabs } from "@/components/ui/panel";
import { pingExtension } from "@/lib/extension-bridge";
import { useSession } from "@/lib/session";

type DetectState = "checking" | "missing" | "installed" | "manual";
type Detect = { state: DetectState; version: string };

/** 顶栏插件入口的四态灯：灰=未检测到插件；橙=版本过时；绿=有在线设备；红=插件在但无在线设备。 */
const CHROME_PHASE_COLOR: Record<string, string> = {
  checking: "#d9d9d9",
  missing: "#d9d9d9",
  outdated: "#ff7d00",
  online: "#52c41a",
  offline: "#ff4d4f",
};
const CHROME_PHASE_TEXT: Record<string, string> = {
  checking: "正在检测浏览器插件…",
  missing: "未检测到浏览器插件",
  outdated: "插件版本过时，请更新后再使用",
  online: "插件在线，Agent 可以控制本机浏览器",
  offline: "插件已安装但没有在线设备，请在插件里登录本系统",
};

/** 把 "1.3.0" 拆成数字段；非数字段（beta 等）按缺失处理，不影响主版本比较。 */
function versionParts(value: string): number[] {
  return value
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

/** actual 是否达到 required（逐段比较，缺段按 0）。 */
function versionAtLeast(actual: string, required: string): boolean {
  const a = versionParts(actual);
  const b = versionParts(required);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

const TABS = [
  { key: "install", label: "下载与安装" },
  { key: "usage", label: "使用说明" },
  { key: "changelog", label: "更新记录" },
];

const FAQ = [
  {
    question: "为什么检测不到插件？",
    answer:
      "插件需在桌面版 Chrome / Edge 中安装并在扩展管理页保持启用；打包版（zip）解压出的文件夹里直接就是 manifest.json，开启开发者模式后选该文件夹即可加载。手机浏览器不支持安装。",
  },
  {
    question: "插件能读取我的网页 Cookie 吗？",
    answer:
      "不读取。插件复用浏览器里你已经登录的会话，只在你主动点击后执行页面操作，不会回传登录凭据。",
  },
  {
    question: "Agent 能在哪些页面操作？",
    answer:
      "所有普通网页都可以被 Agent 接管，这是默认行为，无需逐站点授权。插件只复用你已登录的会话执行页面动作，不会越过登录墙或验证码。",
  },
];

/**
 * 顶部统一浏览器插件入口（方案 §10.6）：平台级客户端的下载、安装与能力入口，
 * 与营销、获客等业务开关解耦；未发布插件包或管理员关闭入口时整个图标不渲染。
 */
export function ExtensionEntry() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("install");
  const [info, setInfo] = useState<ExtensionInfo | null>(null);
  const [detect, setDetect] = useState<Detect>({ state: "checking", version: "" });
  const [onlineDevices, setOnlineDevices] = useState(0);

  const loadChromeStatus = useCallback(async () => {
    const result = await rpaChromeApi.devices();
    if (result.data) {
      setOnlineDevices(result.data.devices.filter((item) => item.online).length);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    void loadChromeStatus();
    const timer = setInterval(() => void loadChromeStatus(), 60_000);
    return () => clearInterval(timer);
  }, [me, loadChromeStatus]);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    platformApi
      .extensionInfo()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch(() => {
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [me]);

  const detectPlugin = useCallback(async () => {
    setDetect({ state: "checking", version: "" });
    const pong = await pingExtension(1000);
    const next: Detect = pong
      ? { state: "installed", version: pong.version }
      : { state: "missing", version: "" };
    setDetect(next);
    return next;
  }, []);

  // 手动确认：检测不到时允许用户先确认已安装，但业务执行前仍会真实探测。
  const confirmInstalled = async () => {
    const next = await detectPlugin();
    if (next.state === "missing") {
      setDetect({ state: "manual", version: "" });
    }
  };

  if (!me || !info?.enabled) return null;

  const outdated =
    detect.state === "installed" &&
    !versionAtLeast(detect.version, info.minVersion);

  // 四态灯：检测中/未装 → 灰；版本过时 → 橙；已装且有在线设备 → 绿；已装但无在线设备 → 红。
  const chromePhase: string = (() => {
    if (detect.state === "checking") return "checking";
    if (outdated) return "outdated";
    if (detect.state !== "installed" && detect.state !== "manual") return "missing";
    return onlineDevices > 0 ? "online" : "offline";
  })();

  const statusNotice = (() => {
    if (detect.state === "checking") {
      return (
        <Notice>
          <Spin size="small" /> 正在检测本机插件…
        </Notice>
      );
    }
    if (detect.state === "installed") {
      return outdated ? (
        <Notice variant="warn">
          已安装 v{detect.version}，低于当前业务最低版本 v{info.minVersion}，
          请按下方步骤更新后再使用分发、获客等能力。
        </Notice>
      ) : (
        <Notice variant="success">
          <CheckCircleOutlined /> 已安装 v{detect.version}，可以使用全部业务能力。
        </Notice>
      );
    }
    if (detect.state === "manual") {
      return (
        <Notice variant="warn">
          已手动确认安装，但浏览器未响应插件握手。执行分发、获客等动作前页面仍会真实验证，
          未响应则不会发起任务。
        </Notice>
      );
    }
    return (
      <Notice>
        未检测到已安装的插件。请按下方步骤安装；如果已经装好，可能需要在扩展管理页启用后重新打开本面板。
      </Notice>
    );
  })();

  const installTab = (
    <div>
      {statusNotice}

      <div className="ext-detail" style={{ marginTop: 14 }}>
        <div className="ext-detail-row">
          <span className="ext-detail-label">当前版本</span>
          <span>v{info.version}</span>
        </div>
        <div className="ext-detail-row">
          <span className="ext-detail-label">最低兼容版本</span>
          <span>v{info.minVersion}</span>
        </div>
        <div className="ext-detail-row">
          <span className="ext-detail-label">支持浏览器</span>
          <span>{info.browsers.join("；")}</span>
        </div>
        <div className="ext-detail-row">
          <span className="ext-detail-label">下载包</span>
          <span>
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              href={info.downloadUrl}
              download
              style={{ padding: 0 }}
            >
              下载 v{info.version} 安装包（zip）
            </Button>
          </span>
        </div>
        {info.checksum ? (
          <div className="ext-detail-row">
            <span className="ext-detail-label">校验值</span>
            <span className="mono text-12" style={{ wordBreak: "break-all" }}>
              {info.checksum}
            </span>
          </div>
        ) : null}
        {info.chromeStoreUrl || info.edgeStoreUrl ? (
          <div className="ext-detail-row">
            <span className="ext-detail-label">商店链接</span>
            <span>
              {info.chromeStoreUrl ? (
                <a href={info.chromeStoreUrl} target="_blank" rel="noreferrer">
                  Chrome 应用商店
                </a>
              ) : null}
              {info.chromeStoreUrl && info.edgeStoreUrl ? " / " : null}
              {info.edgeStoreUrl ? (
                <a href={info.edgeStoreUrl} target="_blank" rel="noreferrer">
                  Edge 加载项
                </a>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="text-12 muted" style={{ marginBottom: 6 }}>
          安装步骤
        </div>
        <ol className="ext-steps">
          {info.installSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      {detect.state === "missing" ? (
        <div style={{ marginTop: 10 }}>
          <Button size="small" onClick={() => void confirmInstalled()}>
            我已安装
          </Button>
          <span className="text-12 muted" style={{ marginLeft: 8 }}>
            检测受浏览器限制时，可手动确认；执行动作前仍会真实验证。
          </span>
        </div>
      ) : null}
    </div>
  );

  const usageTab = (
    <div>
      <div className="text-12 muted" style={{ marginBottom: 6 }}>
        业务能力
      </div>
      <div className="ext-cap-list">
        {info.capabilities.map((capability) => (
          <div className="ext-cap" key={capability.key}>
            <div className="ext-cap-main">
              <div className="ext-cap-title">
                {capability.label}
                <span className="text-12 muted" style={{ marginLeft: 6 }}>
                  v{capability.minVersion}+
                </span>
              </div>
              <div className="text-12 muted">{capability.description}</div>
            </div>
            <Link href={capability.entry} onClick={() => setOpen(false)}>
              打开
            </Link>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="text-12 muted" style={{ marginBottom: 6 }}>
          使用要点
        </div>
        <ul className="ext-steps">
          {info.usage.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="text-12 muted" style={{ marginBottom: 6 }}>
          常见问题
        </div>
        {FAQ.map((item) => (
          <div key={item.question} style={{ marginBottom: 10 }}>
            <div>{item.question}</div>
            <div className="text-12 muted">{item.answer}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const changelogTab = (
    <div>
      {info.changelog.map((entry) => (
        <div className="ext-log" key={entry.version}>
          <div className="ext-log-head">
            <span>
              v{entry.version}
              {entry.version === info.version ? (
                <span className="text-12 muted" style={{ marginLeft: 6 }}>
                  当前版本
                </span>
              ) : null}
            </span>
            <span className="text-12 muted">{entry.date}</span>
          </div>
          <ul className="ext-steps">
            {entry.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ))}
      <div className="text-12 muted">
        当前业务最低兼容版本 v{info.minVersion}，低于该版本的插件会被业务侧拦截。
      </div>
    </div>
  );

  return (
    <>
      <Tooltip
        title={
          outdated
            ? `浏览器插件（v${detect.version} 过低，需 ≥ v${info.minVersion}）`
            : `浏览器插件 · ${CHROME_PHASE_TEXT[chromePhase] || ""}（Agent 只能控制在线设备）`
        }
      >
        <Button
          type="text"
          size="small"
          className="extension-entry-btn"
          style={{ opacity: 0.65 }}
          aria-label="浏览器插件"
          onClick={() => {
            setTab("install");
            setOpen(true);
          }}
          icon={
            <Badge
              dot
              color={CHROME_PHASE_COLOR[chromePhase] || "#d9d9d9"}
              offset={[2, -2]}
            >
              <ChromeOutlined />
            </Badge>
          }
        />
      </Tooltip>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size={560}
        title={`${info.name} v${info.version}`}
        destroyOnHidden
      >
        <PanelTabs
          items={[
            { key: "install", label: TABS[0].label, children: installTab },
            { key: "usage", label: TABS[1].label, children: usageTab },
            { key: "changelog", label: TABS[2].label, children: changelogTab },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Drawer>
    </>
  );
}
