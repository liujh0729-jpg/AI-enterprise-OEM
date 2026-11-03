export const queryKeys = {
  scope: (
    account: string,
    identity: string,
    enterprise: string | number = "all",
  ) => ["private", account, identity, enterprise] as const,
  resource: (
    scope: readonly unknown[],
    module: string,
    resource: string,
    params: unknown = {},
  ) => [...scope, module, resource, params] as const,
};
