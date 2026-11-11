import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 用户侧：关注绑定状态、扫码绑定场景、解绑。 */
export const wechatMpApi = {
  status: endpoint(endpoints.WechatMp_status),
  bindScene: endpoint(endpoints.WechatMp_bindScene),
  unbind: endpoint(endpoints.WechatMp_unbind),
};

/** 平台管理后台「微信服务号设置」：配置、模板、菜单、绑定与推送记录。 */
export const wechatMpAdminApi = {
  settings: endpoint(endpoints.WechatMpAdmin_settings),
  saveSettings: endpoint(endpoints.WechatMpAdmin_saveSettings),
  test: endpoint(endpoints.WechatMpAdmin_test),
  templates: endpoint(endpoints.WechatMpAdmin_templates),
  testSend: endpoint(endpoints.WechatMpAdmin_testSend),
  saveTemplates: endpoint(endpoints.WechatMpAdmin_saveTemplates),
  menu: endpoint(endpoints.WechatMpAdmin_menu),
  saveMenu: endpoint(endpoints.WechatMpAdmin_saveMenu),
  publishMenu: endpoint(endpoints.WechatMpAdmin_publishMenu),
  pullMenu: endpoint(endpoints.WechatMpAdmin_pullMenu),
  bindings: endpoint(endpoints.WechatMpAdmin_bindings),
  unbindBinding: endpoint(endpoints.WechatMpAdmin_unbindBinding),
  messages: endpoint(endpoints.WechatMpAdmin_messages),
  retry: endpoint(endpoints.WechatMpAdmin_retry),
  stats: endpoint(endpoints.WechatMpAdmin_stats),
};

export type WechatMpSettingsView = NonNullable<
  Awaited<ReturnType<typeof wechatMpAdminApi.settings>>
>;
export type WechatMpBindingRow = NonNullable<
  Awaited<ReturnType<typeof wechatMpAdminApi.bindings>>
>["list"][number];
export type WechatMpMessageRow = NonNullable<
  Awaited<ReturnType<typeof wechatMpAdminApi.messages>>
>["list"][number];
export type WechatMpStats = NonNullable<
  Awaited<ReturnType<typeof wechatMpAdminApi.stats>>
>;
export type WechatMpTemplateCatalog = NonNullable<
  Awaited<ReturnType<typeof wechatMpAdminApi.templates>>
>[number];
