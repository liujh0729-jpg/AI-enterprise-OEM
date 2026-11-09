import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Services } from './services';
import type { ApiEnv } from './types';
import { registerAdminRoutes } from './route-groups/admin';
import { registerInvoiceRoutes } from './route-groups/invoice';
import { registerTaxRoutes } from './route-groups/tax';
import { registerServicesRoutes } from './route-groups/services';
import { registerOverseasRoutes } from './route-groups/overseas';
import { registerFlexRoutes } from './route-groups/flex';
import { registerSupplyRoutes } from './route-groups/supply';
import { registerContractsRoutes } from './route-groups/contracts';
import { registerHealthRoutes } from './route-groups/health';
import { registerGeoRoutes } from './route-groups/geo';
import { registerAiworkinRoutes } from './route-groups/aiworkin';
import { registerConnectionsRoutes } from './route-groups/connections';
import { registerAssetRoutes } from './route-groups/asset';
import { registerCapabilityRoutes } from './route-groups/capability';
import { registerExternalRoutes } from './route-groups/external';
import { registerIdentityRoutes } from './route-groups/identity';
import { registerIpRoutes } from './route-groups/ip';
import { registerThinkTankRoutes } from './route-groups/think-tank';
import { registerLegalRoutes } from './route-groups/legal';
import { registerLogisticsRoutes } from './route-groups/logistics';
import { registerMarketBoardRoutes } from './route-groups/market-board';
import { registerMarketingRoutes } from './route-groups/marketing';
import { registerOpenApiRoutes } from './route-groups/open-api';
import { registerOssSettingsRoutes } from './route-groups/oss-settings';
import { registerQxyRoutes } from './route-groups/qxy';
import { registerSmartServiceRoutes } from './route-groups/smart-service';
import { registerAppsRoutes } from './route-groups/apps';

/**
 * 个人用户门控：**只锁办理动作，整页与读接口照常放行**。
 * 「财税服务」「跨境出海」要让个人主体浏览服务商名录并申请加入，因此只挂在
 * 单个写接口上（签约 / 申报 / 账套 / 发布需求），不再挂整个业务域。
 * 仅当以「用户」身份访问时生效；服务商 / 职员 / 平台管理员身份照常。
 */
const SUBJECT_LOCKS: { method: string; path: RegExp; label: string }[] = [
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/?$/,
    label: '发起申报',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/[^/]+\/form\/?$/,
    label: '填报申报表',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/[^/]+\/contacts\/?$/,
    label: '修改申报单联系方式',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/[^/]+\/run-ai\/?$/,
    label: '申报材料 AI 分析',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/[^/]+\/qc\/?$/,
    label: '申报核对',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/declarations\/[^/]+\/pay\/?$/,
    label: '申报缴款',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/account-sets\/[^/]+\/archive\/?$/,
    label: '归档账套',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/account-sets\/?$/,
    label: '新建账套',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/contacts\/?$/,
    label: '修改报税材料联系方式',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/rows\/?$/,
    label: '提交报税材料',
  },
  {
    method: 'PATCH',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/rows\/[^/]+\/?$/,
    label: '提交报税材料',
  },
  {
    method: 'DELETE',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/rows\/[^/]+\/?$/,
    label: '提交报税材料',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/submit\/?$/,
    label: '提交报税材料',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/ocr-invoice\/?$/,
    label: '发票识别',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/material-packs\/[^/]+\/generate-declarations\/?$/,
    label: '分税种提报',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/plans\/generate\/?$/,
    label: '生成申报计划',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/tax\/plans\/[^/]+\/create-decl\/?$/,
    label: '按计划发起申报',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/overseas\/?$/,
    label: '发起出海服务',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/overseas\/[^/]+\/advance\/?$/,
    label: '推进出海服务',
  },
  {
    method: 'POST',
    path: /^\/enterprise\/overseas\/[^/]+\/contacts\/?$/,
    label: '修改出海服务联系方式',
  },
];
export function registerRoutes(app: OpenAPIHono<ApiEnv>, services: Services) {
  // 按业务域注册；域内顺序与拆分前一致
  app.use('/enterprise/*', async (c, next) => {
    const path = c.req.path.replace(/^\/api\/backend(?=\/|$)/, '');
    const locked = SUBJECT_LOCKS.find(
      (rule) => rule.method === c.req.method && rule.path.test(path),
    );
    if (locked) {
      await services.identity.requireSubjectService(
        c.get('user')!,
        locked.label,
      );
    }
    await next();
  });

  registerAdminRoutes(app, services);
  registerInvoiceRoutes(app, services);
  registerTaxRoutes(app, services);
  registerServicesRoutes(app, services);
  registerOverseasRoutes(app, services);
  registerFlexRoutes(app, services);
  registerSupplyRoutes(app, services);
  registerContractsRoutes(app, services);
  registerHealthRoutes(app, services);
  registerGeoRoutes(app, services);
  registerAiworkinRoutes(app, services);
  registerConnectionsRoutes(app, services);
  registerAssetRoutes(app, services);
  registerCapabilityRoutes(app, services);
  registerExternalRoutes(app, services);
  registerIdentityRoutes(app, services);
  registerIpRoutes(app, services);
  registerThinkTankRoutes(app, services);
  registerLegalRoutes(app, services);
  registerLogisticsRoutes(app, services);
  registerMarketBoardRoutes(app, services);
  registerMarketingRoutes(app, services);
  registerOpenApiRoutes(app, services);
  registerOssSettingsRoutes(app, services);
  registerQxyRoutes(app, services);
  registerSmartServiceRoutes(app, services);
  registerAppsRoutes(app, services);
}
