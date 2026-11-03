"use client";
import { App, Button, Checkbox, Form, Input, Select, Space, Switch } from "antd";
import { useEffect } from "react";
import { SettingOutlined } from "@ant-design/icons";
import { Panel, Notice } from "@/components/ui/panel";
import { platformApi, type SiteConfig } from "@/api/platform";
import { enterpriseRoute } from "@/config/routes";
import { normalizeSiteUrl } from "@/lib/site-url";
import { LANGUAGES } from "@/lib/i18n/langs";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, useAdminData } from "./common";

/** 业务服务菜单候选项：与侧栏菜单定义（enterpriseRoute）同源，新增/删减栏目只改 routes.ts。 */
const BUSINESS_MENU_ITEMS = (
  enterpriseRoute.routes?.find((route) => route.name === "业务服务")?.routes ?? []
).map((route) => ({ label: route.name || route.path || "", value: route.path || "" }));

/** 开放集成菜单候选项：只开放「API 文档」与「MCP Server」两项给管理员控制显隐。 */
const INTEGRATION_MENU_PATHS = ["/developer/docs", "/developer/mcp"];
const INTEGRATION_MENU_ITEMS = (
  enterpriseRoute.routes?.find((route) => route.name === "开放集成")?.routes ?? []
)
  .filter((route) => INTEGRATION_MENU_PATHS.includes(route.path || ""))
  .map((route) => ({ label: route.name || route.path || "", value: route.path || "" }));

/** 语言下拉选项：与前台 i18n 清单同源（lib/i18n/langs），后端白名单校验同一套语言码。 */
const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({ label: `${l.label}（${l.code}）`, value: l.code }));

/**
 * 站点设置：名称 / logo / 简介 / ICP 备案号 / 站点域名 / 页脚链接 / 菜单显隐。保存后前端读取即时生效（设计 §7 站点设置）。
 */
export function SiteSettingsTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm<SiteConfig>();
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
        // 后台存的是「是否隐藏」，表单用「是否可见」开关更好理解；缺省可见。
        aiServicesVisible: data.aiServicesHidden !== true,
        footerLinksText: (data.footerLinks || [])
          .map((l) => `${l.label}\t${l.url}`)
          .join("\n"),
      } as never);
    }
  }, [data, form]);

  const onSubmit = async (
    values: SiteConfig & { footerLinksText?: string; aiServicesVisible?: boolean },
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
          businessMenuHidden: values.businessMenuHidden || [],
          integrationMenuHidden: values.integrationMenuHidden || [],
          aiServicesHidden: values.aiServicesVisible === false,
          defaultLanguage: values.defaultLanguage || "zh-CN",
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
            name="businessMenuHidden"
            label="业务服务菜单显隐（勾选即隐藏）"
            extra="控制前台侧栏「业务服务」分组里各菜单项是否显示，保存后对所有用户即时生效；仅影响菜单展示，已收藏链接的直接访问不受影响；全部隐藏后「业务服务」分组自动消失。"
          >
            <Checkbox.Group options={BUSINESS_MENU_ITEMS} />
          </Form.Item>
          <Form.Item
            name="integrationMenuHidden"
            label="开放集成菜单显隐（勾选即隐藏）"
            extra="控制前台侧栏「开放集成」分组里「API 文档」与「MCP Server」两个菜单项是否显示，默认均可见；仅影响菜单展示，已收藏链接的直接访问不受影响。"
          >
            <Checkbox.Group options={INTEGRATION_MENU_ITEMS} />
          </Form.Item>
          <Form.Item
            name="aiServicesVisible"
            label="AI增值服务菜单对用户可见"
            valuePropName="checked"
            extra="关闭后前台侧栏「AI增值服务」整组隐藏（算力服务 / A2A 供需平台），默认开启；仅影响菜单展示，外部链接本身仍可直达。"
          >
            <Switch checkedChildren="可见" unCheckedChildren="隐藏" />
          </Form.Item>
          <Form.Item
            name="defaultLanguage"
            label="默认语言"
            extra="从未手动切换过语言的新访客首次进站按此语言展示界面（可选：简体中文 / English / Tiếng Việt / 日本語 / العربية / Français / Español / Русский）；每位访客在前台右上角随时可切，切换后以访客自己的选择为准。"
          >
            <Select options={LANGUAGE_OPTIONS} placeholder="简体中文（zh-CN）" />
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
