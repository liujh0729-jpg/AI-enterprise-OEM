import { describe, expect, it } from "vitest";
import { enterpriseRoute, navigationFor, type EnterpriseRoute } from "./routes";
import type { EnterpriseMe } from "../lib/session";
import { stub } from "../test/doubles";

const me = stub<EnterpriseMe>({
  userId: 1,
  currentIdentity: "ENTERPRISE_USER",
  identities: ["ENTERPRISE_USER"],
  enterprise: { subjectType: "COMPANY" },
});

const leaves = (menu: EnterpriseRoute, groupName: string): string[] =>
  (menu.routes ?? [])
    .find((route) => route.name === groupName)
    ?.routes?.map((child) => child.path ?? "") ?? [];

const topPaths = (menu: EnterpriseRoute): string[] =>
  (menu.routes ?? []).map((route) => route.path ?? route.name ?? "");

describe("navigationFor 站点级菜单显隐", () => {
  it("默认不隐藏任何菜单：驾驶舱入口与各分组菜单项都在", () => {
    const menu = navigationFor(me, []);
    expect(topPaths(menu)).toContain("/dashboard");
    expect(leaves(menu, "工作台")).toEqual(
      expect.arrayContaining([
        "/tasks",
        "/agent",
        "/kb",
        "/crm",
        "/erp",
        "/question-hall",
      ]),
    );
    // 「工作流」已收进 Agent 的「工作流」页签，不再是工作台独立菜单项
    expect(leaves(menu, "工作台")).not.toContain("/workflow");
    expect(leaves(menu, "业务服务")).toHaveLength(12);
    expect(leaves(menu, "商务人脉")).toEqual(["/social", "/hiring"]);
    expect(leaves(menu, "管理设置")).toContain("/points");
    expect(leaves(menu, "管理设置")).toContain("/developer/mechanisms");
    expect(leaves(menu, "模型服务")).toContain("/developer/api-mcp-skill");
    expect(leaves(menu, "模型服务")).toContain("https://app.aipdd.work");
    expect(leaves(menu, "智能硬件")).toEqual([
      "/hardware",
      "/hardware/devices",
      "/hardware/mcp",
      "/hardware/api",
    ]);
    expect(topPaths(menu)).not.toContain("AI增值服务");
  });

  it("按路径隐藏：工作台 / 模型服务 / 外链菜单可逐项隐藏，同组其它项保留", () => {
    const menu = navigationFor(me, ["/crm", "/developer/api-mcp-skill", "https://app.aipdd.work"]);
    expect(leaves(menu, "工作台")).not.toContain("/crm");
    expect(leaves(menu, "工作台")).toContain("/erp");
    expect(leaves(menu, "模型服务")).not.toContain("/developer/api-mcp-skill");
    expect(leaves(menu, "模型服务")).not.toContain("https://app.aipdd.work");
    expect(leaves(menu, "模型服务")).toContain("/model-settings");
    expect(leaves(menu, "管理设置")).toContain("/developer/mechanisms");
  });

  it("嵌套分组（工作台 → 内容创作）里的菜单项同样可隐藏", () => {
    const menu = navigationFor(me, ["/community"]);
    const workbench = (menu.routes ?? []).find((route) => route.name === "工作台");
    const content = (workbench?.routes ?? []).find((route) => route.name === "内容创作");
    expect(content?.routes?.map((child) => child.path)).toEqual([
      "/content",
      "/content/canvas",
      "/content/video-templates",
    ]);
  });

  it("驾驶舱入口可隐藏（兼容历史 / 配置），分组内全部隐藏后该分组整体消失", () => {
    const businessPaths = (enterpriseRoute.routes ?? [])
      .find((route) => route.name === "业务服务")!
      .routes!.map((child) => child.path!);
    const menu = navigationFor(me, ["/", ...businessPaths, "/social", "/hiring"]);
    expect(topPaths(menu)).not.toContain("/dashboard");
    expect((menu.routes ?? []).some((route) => route.name === "业务服务")).toBe(false);
    expect((menu.routes ?? []).some((route) => route.name === "商务人脉")).toBe(false);
  });
});
