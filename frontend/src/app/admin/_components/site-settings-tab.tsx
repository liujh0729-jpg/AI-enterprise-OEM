"use client";
import { App, Button, Checkbox, Form, Input, Select, Space, Switch } from "antd";
import { useEffect } from "react";
import { SettingOutlined } from "@ant-design/icons";
import { Panel, Notice } from "@/components/ui/panel";
import { platformApi, type SiteConfig } from "@/api/platform";
import { enterpriseRoute, type EnterpriseRoute } from "@/config/routes";
import { BOARD_TAB_DEFS } from "@/lib/board-tabs";
import { normalizeSiteUrl } from "@/lib/site-url";
import { LANGUAGES } from "@/lib/i18n/langs";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, useAdminData } from "./common";

/**
 * 用户侧菜单候选项：与侧栏菜单定义（enterpriseRoute）同源，新增/删减栏目只改 routes.ts。
 * 顶级单条（如首页）与每个分组各成一节；分组内的嵌套分组（如「工作台 → 内容创作」）拍平进所属节。
 * 值即菜单里的 path（「AIPDD算力平台」的外链为完整 URL）。
 */
function leafMenuItems(routes: EnterpriseRoute[]): { label: string; value: string }[] {
  return routes.flatMap((route) =>
    route.type === "group"
      ? leafMenuItems(route.routes ?? [])
      : route.path
        ? [{ label: route.name || route.path, value: route.path }]
        : [],
  );
}

const MENU_SECTIONS: { title: string; items: { label: string; value: string }[] }[] = [
  ...(enterpriseRoute.routes ?? [])
    .filter((route) => route.type !== "group")
    .map((route) => ({ title: route.name || "首页", items: leafMenuItems([route]) })),
  ...(enterpriseRoute.routes ?? [])
    .filter((route) => route.type === "group")
    .map((route) => ({ title: route.name || "未命名分组", items: leafMenuItems(route.routes ?? []) })),
].filter((section) => section.items.length > 0);

/**
 * 菜单显隐控件：antd Checkbox.Group 不支持分组标题，这里按节渲染、共享同一个表单值。
 * 每节只改本节勾选（把本节的项替换掉），其它节的隐藏项原样保留。
 */
function MenuVisibilityPicker({
  value,
  onChange,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
}) {
  const hidden = new Set(value ?? []);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {MENU_SECTIONS.map((section) => {
        const sectionPaths = new Set(section.items.map((item) => item.value));
        const hiddenCount = section.items.filter((item) => hidden.has(item.value)).length;
        return (
          <div
            key={section.title}
            style={{ border: "1px solid var(--border, #f0f0f0)", borderRadius: 8, padding: "10px 12px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{section.title}</strong>
              <span className="text-12 muted">
                {hiddenCount ? `已隐藏 ${hiddenCount} / ${section.items.length} 项` : `${section.items.length} 项全部可见`}
              </span>
            </div>
            <Checkbox.Group
              options={section.items}
              value={section.items.filter((item) => hidden.has(item.value)).map((item) => item.value)}
              onChange={(checked) =>
                onChange?.([
                  ...[...hidden].filter((path) => !sectionPaths.has(path)),
                  ...(checked as string[]),
                ])
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 板块页签显隐控件：每个「业务服务」板块一行，两个页签（需求信息 / 服务市集）勾选即隐藏。
 * 与菜单显隐同口径：仅控制页签展示，对所有身份一致生效，直链/接口不受限。
 */
function BoardTabsVisibilityPicker({
  value,
  onChange,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
}) {
  const hidden = new Set(value ?? []);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {BOARD_TAB_DEFS.map((def) => {
        const options = [
          def.demand ? { label: def.demand.label, value: `${def.board}:demand` } : null,
          def.services ? { label: def.services.label, value: `${def.board}:services` } : null,
        ].filter((o): o is { label: string; value: string } => o !== null);
        const tokens = options.map((o) => o.value);
        const hiddenCount = tokens.filter((t) => hidden.has(t)).length;
        return (
          <div
            key={def.board}
            style={{ border: "1px solid var(--border, #f0f0f0)", borderRadius: 8, padding: "10px 12px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{def.name}</strong>
              <span className="text-12 muted">
                {hiddenCount === 0
                  ? "两个页签均展示"
                  : hiddenCount === tokens.length
                    ? "两个页签均隐藏"
                    : "部分隐藏"}
              </span>
            </div>
            <Checkbox.Group
              options={options}
              value={tokens.filter((t) => hidden.has(t))}
              onChange={(checked) =>
                onChange?.([
                  ...[...hidden].filter((t) => !tokens.includes(t)),
                  ...(checked as string[]),
                ])
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/** 语言下拉选项：与前台 i18n 清单同源（lib/i18n/langs），后端白名单校验同一套语言码。 */
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ label: `${l.label}（${l.code}）`, value: l.code }));

/**
 * 站点设置：名称 / logo / 简介 / ICP 备案号 / 站点域名 / 页脚链接 / 菜单显隐。保存后前端读取即时生效（设计 §7 站点设置）。
 */
export function SiteSettingsTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm<SiteConfig & { footerLinksText?: string }>();
  const { data, denied, loading, reload } = useAdminData("site", (signal) =>
    platformApi.adminGetSite({ signal }),
  );
  const save = useOperationMutation(
    (input: { body: Partial<SiteConfig> }) => platformApi.adminSaveSite(input.body),
    ["site", "*"],
  );

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        ...data,
        footerLinksText: (data.footerLinks || [])
          .map((l) => `${l.label}\t${l.url}`)
          .join("\n"),
      });
    }
  }, [data, form]);

  const onSubmit = async (
    values: SiteConfig & { footerLinksText?: string },
  ) => {
    const footerLinks = String(values.footerLinksText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url] = line.split(/\t|,|，/).map((s) => s.trim());
        return { label: label || "", url: url || "" };
      })
      .filter((l) => l.label && l.url);
    try {
      await save.mutateAsync({
        body: {
          siteName: values.siteName,
          siteLogo: values.siteLogo,
          siteDesc: values.siteDesc,
          icpRecord: values.icpRecord,
          footerLinks,
          aipddReferralCode: values.aipddReferralCode,
          hiddenMenuPaths: values.hiddenMenuPaths || [],
          hiddenBoardTabs: values.hiddenBoardTabs || [],
          defaultLanguage: values.defaultLanguage || "zh-CN",
          extensionEntryEnabled: values.extensionEntryEnabled !== false,
          // 后端只保留「协议 + 域名」，这里先把用户输入的原值交出去（清空即回落当前访问域名）
          siteUrl: String(values.siteUrl || "").trim(),
        },
      });
      message.success("站点设置已保存，前台即时生效");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel title="站点设置" titleBadge={<span className="text-12 muted">改名称 / logo / 备案即时生效</span>}>
        <Notice variant="info">
          <SettingOutlined aria-hidden /> 这些值由前端读取渲染标题、logo 与页脚备案；留空则回落到环境变量默认或内置默认。站点域名留空时，站内各类绝对地址按访客当前访问的域名推导。
        </Notice>
        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={onSubmit}
          style={{ marginTop: 12, maxWidth: 720 }}
        >
          <Form.Item name="siteName" label="站点名称">
            <Input placeholder="企业服务工作台" maxLength={120} />
          </Form.Item>
          <Form.Item name="siteLogo" label="站点 Logo（图片地址）">
            <Input placeholder="/brand/logo.png" maxLength={512} />
          </Form.Item>
          <Form.Item name="siteDesc" label="站点简介">
            <Input.TextArea rows={2} maxLength={500} placeholder="一句话介绍本站" />
          </Form.Item>
          <Form.Item name="icpRecord" label="ICP 备案号">
            <Input placeholder="京ICP备00000000号-1" maxLength={128} />
          </Form.Item>
          <Form.Item
            name="siteUrl"
            label="站点域名（对外访问地址）"
            extra="本站对外只有一个域名时不用填：页面会跟着访客当前访问的地址走。需要固定对外地址时就填上，MCP / API 接入端点、IM 与支付回调地址、客服嵌入脚本、活码入口、邀请链接等绝对地址会统一用它拼接；只认 http/https，可以带端口。"
            rules={[
              {
                validator: (_rule, value: string) =>
                  !String(value || "").trim() || normalizeSiteUrl(value)
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error("格式不对：请填协议 + 域名（可带端口），例如 https://oa.example.com"),
                      ),
              },
            ]}
          >
            <Input placeholder="https://oa.example.com" maxLength={512} allowClear />
          </Form.Item>
          <Form.Item
            name="footerLinksText"
            label="页脚链接（每行一条：名称[Tab或逗号]URL）"
          >
            <Input.TextArea rows={3} placeholder={"关于我们\thttps://example.com/about"} />
          </Form.Item>
          <Form.Item
            name="aipddReferralCode"
            label="AIPDD 推荐码（邀请码）"
            extra="填你在 AIPDD（www.aipdd.work）的推荐码：用户绑 Key 页面会引导新用户注册时填写该码——邀请注册佣金归你，新用户获赠算力。留空则不展示引导。"
          >
            <Input placeholder="你在 AIPDD 平台的推荐码" maxLength={64} allowClear />
          </Form.Item>
          <Form.Item
            name="hiddenMenuPaths"
            label="用户侧菜单显隐（勾选即隐藏）"
            extra="控制前台侧栏每一条菜单是否显示，覆盖首页入口与每个分组（含「AIPDD算力平台」的外链），保存后对所有用户即时生效；仅影响菜单展示，已收藏链接的直接访问不受影响；某分组内的菜单项全部隐藏后该分组自动消失。"
          >
            <MenuVisibilityPicker />
          </Form.Item>
          <Form.Item
            name="hiddenBoardTabs"
            label="业务服务板块页签（勾选即隐藏）"
            extra="逐个「业务服务」板块控制其「需求信息」与「服务市集」页签是否展示：勾选即对该板块隐藏该页签，保存后对所有身份即时生效（管理员也看不到该页签）；仅影响页签展示，已收藏链接的直接访问不受影响。"
          >
            <BoardTabsVisibilityPicker />
          </Form.Item>
          <Form.Item
            name="defaultLanguage"
            label="默认语言"
            extra="从未手动切换过语言的新访客首次进站按此语言展示界面（可选：简体中文 / English / Tiếng Việt / 日本語 / العربية / Français / Español / Русский）；每位访客在前台右上角随时可切，切换后以访客自己的选择为准。"
          >
            <Select options={LANGUAGE_OPTIONS} placeholder="简体中文（zh-CN）" />
          </Form.Item>
          <Form.Item
            name="extensionEntryEnabled"
            label="顶部浏览器插件入口"
            valuePropName="checked"
            extra="开启后所有登录用户在顶栏看到统一的插件入口（下载、安装、使用说明、更新记录），与营销、获客等业务开关解耦；平台未发布插件包时入口不展示。"
          >
            <Switch />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存站点设置
            </Button>
            <Button onClick={() => reload()}>重新载入</Button>
          </Space>
        </Form>
      </Panel>
    </>
  );
}
