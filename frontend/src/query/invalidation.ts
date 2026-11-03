/** 写操作影响的读取模块；同一模块可能在多个工作台中作为组合查询出现。 */
const dependencies: Record<string, readonly string[]> = {
  contracts: ["contracts", "tax", "supply", "flex", "overseas", "dashboard"],
  capability: ["capability", "tax", "admin", "dashboard"],
  external: ["external", "tax", "dashboard"],
  invoice: ["invoice", "tax", "dashboard"],
  identity: ["*"],
};
export function matchesInvalidationModule(module: unknown, target: string) {
  return (dependencies[target] || [target]).some(key => key === "*" ||
    module === key || (typeof module === "string" && module.startsWith(`/enterprise/${key}`)));
}
