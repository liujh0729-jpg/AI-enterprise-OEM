import { z, ApiError } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

type Definition<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType<{ data: unknown }>,
> = {
  method: string;
  path: string;
  params: P;
  query: Q;
  body: B;
  response: R;
};
/**
 * 调用方给的是 schema 的输入类型，运行期 parse 之后才变成输出类型。
 * 带 .default() / coerce 的字段在输入侧可选、输出侧必填，用输出类型当入参会
 * 逼调用方补齐本该由默认值填的字段（与契约 EndpointInput<K> 的 z.input 口径一致）。
 */
export function endpoint<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  R extends z.ZodType<{ data: unknown }>,
>(definition: Definition<P, Q, B, R>, defaults: HttpOptions = {}) {
  return async (
    input: { params?: z.input<P>; query?: z.input<Q>; body?: z.input<B> } = {},
    options: HttpOptions = {},
  ): Promise<z.output<R>["data"]> => {
    const params = definition.params.parse(input.params ?? {});
    const query = definition.query.parse(input.query ?? {});
    const body = definition.body.parse(input.body);
    const path = definition.path.replace(
      /:([A-Za-z0-9_]+)/g,
      (_, name: string) => {
        const value =
          params && typeof params === "object"
            ? Reflect.get(params, name)
            : undefined;
        if (
          value === undefined ||
          value === null ||
          ["undefined", "null", "NaN"].includes(String(value))
        )
          throw new Error("请求缺少有效编号");
        return encodeURIComponent(String(value));
      },
    );
    const result = await http(`/api/backend${path}`, definition.response, {
      timeoutMs: /attachments|external|qxy|upload/.test(definition.path)
        ? 90000
        : 30000,
      ...defaults,
      ...options,
      method: definition.method.toUpperCase(),
      body,
      query:
        query && typeof query === "object"
          ? Object.fromEntries(Object.entries(query))
          : undefined,
    });
    return result.data.data;
  };
}

/** 多态业务组件按已登记的操作选择契约，输入和输出均经过 Schema 校验。 */
export async function catalogEndpoint(
  id: import("@enterprise/contracts").EndpointId,
  input: { params?: unknown; query?: unknown; body?: unknown } = {},
  options: HttpOptions = {},
) {
  const { endpoints } = await import("@enterprise/contracts");
  const definition: Definition<
    z.ZodType,
    z.ZodType,
    z.ZodType,
    z.ZodType<{ data: unknown }>
  > = endpoints[id];
  return endpoint(definition)(input, options);
}
export function parseData<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("接口响应与约定不一致", "protocol");
  return parsed.data;
}
