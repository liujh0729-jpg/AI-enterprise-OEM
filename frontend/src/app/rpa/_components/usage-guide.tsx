"use client";

import { Button, Modal, Steps, Typography } from "antd";
import { useState } from "react";

const { Text, Title } = Typography;

const STEP_ITEMS = [
  {
    title: "安装比特浏览器客户端",
    content:
      "在本地 Windows 机器上下载并安装比特浏览器（BitBrowser）。这是 RPA 的执行端：云端只负责建任务、存脚本和管账号，真正跑脚本的是本地这台机器上的比特浏览器。",
  },
  {
    title: "拿到本账号的 API Key",
    content:
      "在本系统「模型服务 → API Key」页面为本账号生成一个 Key。本地执行端启动后凭这个 Key 从云端认领任务、取脚本正文与账号口令。一个 Key 只能看到一个账号名下的 RPA 内容。",
  },
  {
    title: "配置执行端连接",
    content:
      "在比特浏览器的「系统设置」里把 RPA 服务地址填成本系统后端地址（形如 http(s)://your-host/api/v1/rpa），把上一步拿到的 API Key 填进「API Key」栏。保存后执行端就能与云端通信。",
  },
  {
    title: "准备脚本与账号",
    content:
      "PC 任务：在比特浏览器客户端里画好 RPA 流程，记下客户端里的「RPA 任务 ID」，在本系统「RPA 脚本」页签新建脚本时选「比特浏览器 RPA 流程」并填上这个 ID；或者选 JSON（Automa 脚本）/ JS / Python 直接粘贴正文。云手机任务：在客户端里建好云手机环境，在「RPA 账号」页签登记时选对应设备类型并填上环境 ID。",
  },
  {
    title: "建任务并等待认领",
    content:
      "在「RPA 任务」页签新建任务：选脚本、选同设备类型的账号、填运行参数、设排期。任务建好即进入「待执行」，本地执行端下一轮轮询就会认领它，拿脚本正文和账号口令在本地跑，跑完把结果回传到云端。",
  },
  {
    title: "查看执行结果",
    content:
      "任务列表里点「执行记录」可以看到每一次认领的开始时间、时长、结果（成功 / 失败 / 超时 / 取消）与报错信息。失败且还有重试次数的任务会自动退回待执行，执行端下一轮会再认领。",
  },
];

/**
 * RPA 使用说明：点页头标题右侧的「使用说明」按钮弹出。
 * 两类执行端——比特浏览器（云端配置、本地凭 Key 认领执行，六步走）与
 * 本地 Chrome 插件（浏览器代理：插件登录本系统，侧边栏一句话下目标、Agent 自主多步执行）。
 * 只读内容，不做任何数据操作。
 */
export function BitBrowserGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>使用说明</Button>
      <Modal
        open={open}
        title="RPA 使用说明"
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>知道了</Button>}
        width={760}
        destroyOnHidden
      >
        <Title level={5} style={{ marginTop: 0 }}>
          整体架构
        </Title>
        <Text type="secondary">
          云端（本系统）负责建脚本、登记账号、建任务与做 LLM 决策；本地负责真正跑动作。
          两类执行端：一是「比特浏览器客户端」——云端建任务，本地凭 API Key 认领执行并回传结果，
          Key 属于哪个账号就只能看到并认领那个账号的 RPA 内容，支持 PC（比特浏览器窗口）、安卓云手机、
          iPhone 云手机三种目标设备；二是本机「本地 Chrome 插件（浏览器代理）」——插件登录本系统后，
          本机浏览器成为该账号名下的一台在线设备，模型与工具都走本系统配置，Agent 在你已登录的站点里自主多步执行。
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          比特浏览器客户端接入步骤
        </Title>
        <Steps
          orientation="vertical"
          size="small"
          current={-1}
          items={STEP_ITEMS.map((item, index) => ({
            title: `${index + 1}. ${item.title}`,
            content: (
              <Text style={{ whiteSpace: "pre-wrap" }}>{item.content}</Text>
            ),
          }))}
        />

        <Title level={5} style={{ marginTop: 20 }}>
          本地 Chrome 插件（浏览器代理）接入步骤
        </Title>
        <Steps
          orientation="vertical"
          size="small"
          current={-1}
          items={[
            {
              title: "1. 安装插件",
              content:
                "点顶栏右侧的「浏览器插件」图标（或本页第一个页签的空状态里「下载插件」按钮）下载 zip，解压出的文件夹里直接就是 manifest.json；在 Chrome / Edge 的扩展管理页开启「开发者模式」后「加载已解压的扩展程序」选中该文件夹即可。",
            },
            {
              title: "2. 在插件里登录本系统",
              content:
                "点插件图标会从右侧拉开侧边栏，在右上角「⋯」里填本系统地址与账号密码完成登录。登录成功后，这台浏览器就会出现在「本地RPA状态」页签的设备清单里；换电脑、换浏览器或重装扩展都会生成一台新设备。",
            },
            {
              title: "3. 给一句话目标",
              content:
                "在插件侧边栏（快捷键 Alt+A）输入要完成的目标，Agent 会在你已登录的站点里逐步决策并执行——模型与工具都走本系统的配置与额度；也可用 Act / Crawl / Extract 三种模式做动作、抓取或结构化抽取。输入框上方的「执行方式」可随时切换：「确认后执行」（默认，Agent 先给出要做的事项与完成方式、等你点确认再动手）与「自动执行」（分析好方案后直接动手，不再逐次等你点确认）。",
            },
            {
              title: "4. 敏感动作先确认",
              content:
                "Agent 可在任意普通网页接管操作（无需逐站点授权），只复用你已登录的会话。遇到提交、支付、删除这类敏感动作会先停下等你点「允许本次 / 拒绝」；离线设备不会被调度。",
            },
            {
              title: "5. 需要定时就建「计划任务」",
              content:
                "在插件侧边栏的「计划」抽屉按每天 / 每周 / 每月 / 每小时 / 按分钟排期，到点自动跑一个目标；只在设备在线（插件已登录、Chrome 打开）时执行，离线的那一轮直接跳过、不补跑，账号停用会自动暂停。",
            },
          ].map((item) => ({
            title: item.title,
            content: (
              <Text style={{ whiteSpace: "pre-wrap" }}>{item.content}</Text>
            ),
          }))}
        />

        <Title level={5} style={{ marginTop: 20 }}>
          三种设备的差异
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`• PC（比特浏览器）：脚本类型支持 JSON（Automa）、比特浏览器 RPA 流程、JS、Python；账号要填浏览器窗口编号。
• 安卓云手机：脚本类型支持比特云手机 RPA 流程、JS、Python；账号要填云手机环境 ID 与计费方式（套餐 / 按时），同一任务里的云手机计费方式必须统一。
• iPhone 云手机：脚本类型只支持 JS、Python（比特浏览器未开放 iPhone 的控制 API 与 RPA 导出）；账号要填云手机环境 ID 与计费方式。`}
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          常见问题
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`Q：任务建好了但本地执行端没认领？
A：检查三件事——① 执行端配置的 API Key 与建任务的账号一致；② 执行端配置的 RPA 服务地址能访问到本系统后端；③ 任务状态是「待执行」且没被取消。

Q：脚本类型选错了能改吗？
A：能改，但设备类型不能改（脚本一旦建好就绑定了设备）。要换设备只能新建脚本。

Q：云手机任务跑完后会自动关机吗？
A：取决于建任务时选的「任务结束后」动作：保持开机 / 关机 / 挂起。按时计费的建议选挂起或关机省算力。`}
        </Text>
      </Modal>
    </>
  );
}
