type Dependency = {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

/** 只汇总当前视图实际使用的依赖；缓存数据和请求仍由各自的 Query 管理。 */
export function workspaceState<T>(data: T, dependencies: Dependency[]) {
  const state = {
    data,
    isPending: dependencies.some(query => query.isPending),
    isFetching: dependencies.some(query => query.isFetching),
    refetch: async () => { await Promise.all(dependencies.map(query => query.refetch())); },
  };
  const failed = dependencies.find(query => query.isError);
  return failed ? { ...state, isError: true as const, error: failed.error ?? new Error("数据加载失败") }
    : { ...state, isError: false as const, error: null };
}
