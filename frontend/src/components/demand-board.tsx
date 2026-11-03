"use client";

import { App, Button, Form, Space } from "antd";
import type { FormInstance } from "antd";
import { useCallback, useState, type ReactNode } from "react";
import {
  ChannelMessagesModal,
  type ChannelConversation,
  type ChannelDetail,
} from "@/components/channel-messages-modal";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { demandDetails, type DemandFields } from "@/components/demand-columns";
import type { LocationValue } from "@/components/location-fields";
import { loadDemandPage, demandBoardApi } from "@/api/demand-board";
import {
  useBusinessInfiniteQuery,
  useBusinessFetchQuery,
  useOperationMutation,
} from "@/query/business";
import { presentMutationError } from "@/query/errors";
import type { z } from "@enterprise/contracts";

/**
 * 需求看板共享层（2026-09-26 分层优化 Tier 2 ⑦）。
 *
 * 七页需求（营销 / 物流 / 资产 / IT服务 / 法律 / 知产 / 灵工）的**机制**完全一致：
 * 列表加载（省市筛选）→ 创建人或平台管理员改删（改删需密码）→ 查看消息（n）→ 通道内回复。
 * 各页不同的只有**文案、行结构映射与身份门控**，所以这里只收口机制：
 * - 不合并单据模型：每页仍用自己的 Row 类型与 `toDemand` 映射，接口字段差异留在页面里；
 * - 不改判权语义：`canManage` / `canReply` / `canView` 由页面传入，本层不做身份推断
 *   （规则 16：只按身份判定，不看业务状态）；
 * - 文案（面板标题、空态、弹窗与密码框标题）全部留在页面，避免被统一掉。
 */

/** YYYY-MM-DD 归一：值既可能是 DatePicker 对象，也可能是编辑态的文本输入。 */
export function toDateInput(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim().slice(0, 10);
  return typeof (value as { format?: unknown }).format === "function"
    ? (value as { format: (pattern: string) => string }).format("YYYY-MM-DD")
    : "";
}

export type DemandChannel = {
  id: string | number;
  no: string;
  fields: DemandFields;
  conversations: ChannelConversation[];
};

export type DemandBoardConfig<Row> = {
  rowSchema: z.ZodType<Row>;
  /** 增删改查与消息接口的根路径，如 `/enterprise/logistics`。 */
  endpoint: string;
  /** 列表接口的固定附加参数（营销按 `as=provider` 取服务商可见集）。 */
  listParams?: Record<string, string>;
  /** 本地台账是自增 id；平台直连看板（财税 / 供销 / 出海）是 AIworkin 挂单 UUID。 */
  rowId: (row: Row) => string | number;
  rowNo: (row: Row) => string;
  rowTitle: (row: Row) => string;
  toDemand: (row: Row) => DemandFields;
  /** 编辑态回填的表单值（含各页专属字段）。 */
  formValues: (row: Row) => Record<string, unknown>;
  /**
   * 表单值 → 请求体。不传则用通用映射（`expect_start` / `deadline` 归一为
   * YYYY-MM-DD，`email_sync` 缺省补 "0"）；有专属字段的页面自行处理。
   */
  buildBody?: (values: Record<string, unknown>) => Record<string, unknown>;
  /** 修改接口的请求体包装（法律 / 知产把明细塞进 `fields` JSON 列）。 */
  patchBody?: (
    body: Record<string, unknown>,
    row: Row,
  ) => Record<string, unknown>;
  /** 新增 / 保存成功提示：接口返回 `tip` 时优先用接口的。 */
  createdTip: string;
  savedTip?: string;
  /**
   * 提交成功后直接打开该需求的消息通道（法律 / 知产：发起即进通道，
   * 企业当场就能在通道里补材料说明）。
   */
  openChannelOnCreate?: boolean;
  /** 修改与删除的密码框标题（文案留在页面）。 */
  editPasswordTitle: string;
  removePasswordTitle: string;
  /** 列表加载失败是否静默（默认弹 message）。 */
  silentErrors?: boolean;
  /** 挂载与省市筛选变化时自动加载（默认是）。 */
  autoLoad?: boolean;
};

export type DemandBoard<Row> = {
  message: ReturnType<typeof App.useApp>["message"];
  passwordModal: ReactNode;
  requestPassword: ReturnType<typeof usePasswordConfirm>["request"];

  rows: Row[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  /**
   * 重取列表：筛选变化之外，回复成功后也要调（回复即接单会换承办人）。
   * 返回本次取到的行，供「提交后定位新建单据并打开通道」这类流程使用。
   */
  load: () => Promise<Row[]>;

  demandRegion: LocationValue;
  setDemandRegion: (value: LocationValue) => void;

  form: FormInstance;
  editing: Row | null;
  createOpen: boolean;
  submitting: boolean;
  openCreate: () => void;
  openEdit: (row: Row) => void;
  /** 关闭新增/修改弹窗（清空编辑态）。 */
  closeCreate: () => void;
  save: () => Promise<void>;
  removeRow: (row: Row) => void;

  channel: DemandChannel | null;
  /** 通道对应的当前行（回复重取后随之刷新）；页面据此判定发言侧。 */
  channelRow: Row | null;
  openChannel: (row: Row) => Promise<void>;
  closeChannel: () => void;
  reply: (conversationId: string, text: string) => Promise<void>;
};

/** 需求看板的全部状态与动作：列表、增删改、需求消息通道。 */
export function useDemandBoard<Row>(
  config: DemandBoardConfig<Row>,
): DemandBoard<Row> {
  const {
    endpoint,
    listParams,
    rowId,
    rowNo,
    rowTitle,
    toDemand,
    formValues,
    buildBody,
    patchBody,
    createdTip,
    savedTip,
    openChannelOnCreate,
    editPasswordTitle,
    removePasswordTitle,
    autoLoad,
  } = config;

  const { message } = App.useApp();
  const fetchQuery = useBusinessFetchQuery(endpoint);
  const createMutation = useOperationMutation(demandBoardApi.create, [
    endpoint,
    "dashboard",
  ]);
  const updateMutation = useOperationMutation(demandBoardApi.update, [
    endpoint,
    "dashboard",
  ]);
  const removeMutation = useOperationMutation(demandBoardApi.remove, [
    endpoint,
    "dashboard",
  ]);
  const replyMutation = useOperationMutation(demandBoardApi.reply, [
    endpoint,
    "dashboard",
  ]);
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [form] = Form.useForm();
  const [demandRegion, setDemandRegion] = useState<LocationValue>({
    province: "",
    city: "",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [channel, setChannel] = useState<DemandChannel | null>(null);

  const listParamsKey = JSON.stringify(listParams || {});

  const query = useBusinessInfiniteQuery<Row>(
    endpoint,
    "list",
    { listParamsKey, demandRegion },
    async (signal, cursor) => {
      const params = new URLSearchParams(JSON.parse(listParamsKey));
      if (demandRegion.province) params.set("province", demandRegion.province);
      if (demandRegion.city) params.set("city", demandRegion.city);
      return loadDemandPage<Row>(
        endpoint,
        Object.fromEntries(params),
        cursor,
        signal,
        config.rowSchema,
      );
    },
    autoLoad !== false,
  );
  const rows = query.data?.pages.flatMap((page) => page.list) || [];
  const loading = query.isPending;
  const { refetch: refetchList } = query;
  const load = useCallback(async () => {
    const result = await refetchList();
    if (result.error) throw result.error;
    return result.data?.pages.flatMap((page) => page.list) || [];
  }, [refetchList]);
  const loadMore = async () => {
    await query.fetchNextPage();
  };

  const fetchConversations = useCallback(
    async (id: string | number) => {
      return fetchQuery("messages", { id }, (signal) =>
        demandBoardApi.messages(endpoint, id, signal),
      );
    },
    [endpoint, fetchQuery],
  );
  const fetchDetail = useCallback(
    (id: string | number) =>
      fetchQuery("detail", { id }, (signal) =>
        demandBoardApi.detail(endpoint, id, config.rowSchema, signal),
      ),
    [endpoint, fetchQuery, config.rowSchema],
  );

  const openChannelById = useCallback(
    async (id: string | number) => {
      try {
        const detail = await fetchDetail(id);
        const conversations = await fetchConversations(id);
        if (!conversations) return;
        setChannel({
          id,
          no: rowNo(detail),
          fields: toDemand(detail),
          conversations,
        });
      } catch (error) {
        presentMutationError(error, (text) => message.error(text));
      }
    },
    [message, fetchConversations, fetchDetail, rowNo, toDemand],
  );
  const openChannel = useCallback(
    (row: Row) => openChannelById(rowId(row)),
    [openChannelById, rowId],
  );

  /** 当前打开通道对应的那一行（回复重取后随之刷新）：页面据此判定发言侧。 */
  const channelRow = channel
    ? rows.find((item) => rowId(item) === channel.id) || null
    : null;

  const reply = useCallback(
    async (conversationId: string, text: string) => {
      if (!channel) return;
      try {
        await replyMutation.mutateAsync({
          path: endpoint,
          id: channel.id,
          text,
          conversationId,
        });
      } catch (error) {
        if (error instanceof Error)
          presentMutationError(error, (text) => message.error(text));
        return;
      }
      const conversations = await fetchConversations(channel.id);
      if (conversations) {
        setChannel((current) =>
          current ? { ...current, conversations } : current,
        );
      }
    },
    [channel, endpoint, fetchConversations, message, replyMutation],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    form.resetFields();
    setCreateOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (row: Row) => {
      const apply = async () => {
        try {
          const detail = await fetchDetail(rowId(row));
          setEditing(detail);
          form.setFieldsValue(formValues(detail));
          setCreateOpen(true);
        } catch (error) {
          presentMutationError(error, (text) => message.error(text));
        }
      };
      void apply();
    },
    [fetchDetail, rowId, form, formValues, message],
  );

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setEditing(null);
  }, []);

  const save = useCallback(async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    const body = buildBody
      ? buildBody(values)
      : {
          ...values,
          expect_start: toDateInput(values.expect_start),
          deadline: toDateInput(values.deadline),
          email_sync: values.email_sync || "0",
        };
    // 提交（新增）免密：只有修改/删除需要密码
    if (!editing) {
      setSubmitting(true);
      try {
        const payload = await createMutation.mutateAsync({
          path: endpoint,
          body,
        });
        message.success(payload?.tip || createdTip);
        setCreateOpen(false);
        form.resetFields();
        if (openChannelOnCreate && payload?.id !== undefined)
          await openChannelById(payload.id);
      } catch (error) {
        if (error instanceof Error)
          presentMutationError(error, (text) => message.error(text));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    const target = editing;
    requestPassword({
      title: editPasswordTitle,
      content: `确认修改「${rowTitle(target)}」？`,
      okText: "保存修改",
      onOk: async () => {
        const payload = await updateMutation.mutateAsync({
          path: endpoint,
          id: rowId(target),
          body: patchBody ? patchBody(body, target) : body,
        });
        message.success(payload?.tip || savedTip || "已保存修改");
        setCreateOpen(false);
        setEditing(null);
      },
    });
  }, [
    createMutation,
    updateMutation,
    buildBody,
    createdTip,
    editing,
    editPasswordTitle,
    endpoint,
    form,
    message,
    openChannelById,
    openChannelOnCreate,
    patchBody,
    requestPassword,
    rowId,
    rowTitle,
    savedTip,
  ]);

  const removeRow = useCallback(
    (row: Row) => {
      const id = rowId(row);
      requestPassword({
        title: removePasswordTitle,
        danger: true,
        okText: "确认删除",
        content: `确认删除「${rowTitle(row)}」？删除后不可恢复。`,
        onOk: async () => {
          await removeMutation.mutateAsync({ path: endpoint, id });
          message.success("已删除");
          setChannel((current) => (current?.id === id ? null : current));
        },
      });
    },
    [
      endpoint,
      message,
      removePasswordTitle,
      removeMutation,
      requestPassword,
      rowId,
      rowTitle,
    ],
  );

  return {
    message,
    passwordModal,
    requestPassword,
    rows,
    loading,
    error: query.error,
    hasMore: !!query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore,
    load,
    demandRegion,
    setDemandRegion,
    form,
    editing,
    createOpen,
    submitting,
    openCreate,
    openEdit,
    closeCreate,
    save,
    removeRow,
    channel,
    channelRow,
    openChannel,
    closeChannel: () => setChannel(null),
    reply,
  };
}

/** 列表「操作」列：查看消息（n）＋ 编辑 ＋ 删除；判权全部由页面传入。 */
export function demandActionsColumn<Row>(options: {
  /** 服务商一侧显示「回复」，其余显示「查看消息」（资产按行判定：承接方≠发布方）。 */
  canReply: (row: Row) => boolean;
  canManage: (row: Row) => boolean;
  /** 不传＝所有行都给消息入口。 */
  canView?: (row: Row) => boolean;
  conversationCount: (row: Row) => number | null | undefined;
  openChannel: (row: Row) => void;
  openEdit: (row: Row) => void;
  removeRow: (row: Row) => void;
}) {
  return {
    title: "操作",
    width: 240,
    render: (_: unknown, row: Row) => {
      const ops: ReactNode[] = [];
      if (!options.canView || options.canView(row)) {
        const reply = options.canReply(row);
        ops.push(
          <Button
            key="msg"
            type={reply ? "primary" : "default"}
            onClick={() => void options.openChannel(row)}
          >
            {reply ? "回复" : "查看消息"}
            {options.conversationCount(row) == null
              ? "（待加载）"
              : `（${options.conversationCount(row)}）`}
          </Button>,
        );
      }
      if (options.canManage(row)) {
        ops.push(
          <Button key="edit" onClick={() => options.openEdit(row)}>
            编辑
          </Button>,
        );
        ops.push(
          <Button key="remove" danger onClick={() => options.removeRow(row)}>
            删除
          </Button>,
        );
      }
      return ops.length ? (
        <Space size={6} wrap>
          {ops}
        </Space>
      ) : (
        <span className="text-12 muted">—</span>
      );
    },
  };
}

/** 需求明细弹窗（ChannelMessagesModal）的公共装配：明细 + 会话 + 回复。 */
export function DemandChannelModal<Row>(options: {
  board: DemandBoard<Row>;
  /** 弹窗副标题文案（各板块口径不同，留在页面）。 */
  description: string;
  /**
   * 通道内是否给回复入口。不传＝打开通道即可回复（营销 / 物流 / 资产 / IT服务）；
   * 法律 / 知产按发言侧传入（企业当事人或承办方才给输入框，其余只读）。
   */
  canReply?: (row: Row) => boolean;
  /** 板块自有字段（如灵工「用工形式」）：排在 15 项统一字段之前。 */
  extraDetails?: (row: Row) => ChannelDetail[];
  /** 回复按钮文案按发言侧变化（灵工：承办方「回复企业」，其余「回复服务商」）。 */
  replyLabel?: (row: Row) => string;
}) {
  const { board, description, canReply, extraDetails, replyLabel } = options;
  const row = board.channelRow;
  const replyOpen =
    Boolean(board.channel) && (!canReply || (row !== null && canReply(row)));
  return (
    <ChannelMessagesModal
      open={Boolean(board.channel)}
      title={board.channel?.no || ""}
      description={description}
      details={
        board.channel
          ? [
              ...(extraDetails && row ? extraDetails(row) : []),
              ...demandDetails(board.channel.fields),
            ]
          : undefined
      }
      conversations={board.channel?.conversations || []}
      replyLabel={replyLabel && row ? replyLabel(row) : undefined}
      onReply={
        replyOpen
          ? async (conversationId, text) => {
              await board.reply(conversationId, text);
            }
          : undefined
      }
      onClose={board.closeChannel}
    />
  );
}
