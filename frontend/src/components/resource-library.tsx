"use client";
import { useOperationMutation } from "@/query/business";
import { contractsApi } from "@/api/contracts";

import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Tag,
} from "antd";
import type { FormInstance } from "antd";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { LocationFilterBar, locationText } from "@/components/location-fields";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useBusinessQuery } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { resourceLibraryApi } from "@/api/resource-library";
import { ApiError, type z } from "@enterprise/contracts";
import { useSession } from "@/lib/session";

/** 资源行公共列（法律 LawyerResource 与知产 IpAgency 的公共部分）。 */
export type ResourceRowBase = {
  id: number;
  kind: string;
  name: string;
  organization?: string;
  province?: string;
  city?: string;
  intro?: string | null;
  cases?: unknown;
  licenseNo?: string;
  ownerUserId?: string;
};

/** /enterprise/contracts 行公共列。 */
export type ResourceContractBase = {
  id: number;
  providerUserId: string;
  providerOrg?: string;
  serviceType: string;
  status: string;
  designatedAgentId: number;
};

/** /enterprise/contracts/candidates 行公共列。 */
export type ResourceCandidateBase = {
  providerUserId: string;
  org_name: string;
  display_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
};

export type ResourceActionCtx = {
  contract: ResourceContractBase | null;
  providerName: string;
  /** 资源所属服务商账号（空＝平台统筹资源） */
  providerUserId: string;
  /** extraRequests 取回的数据，按 key 取值 */
  extra: Record<string, unknown>;
};

export type ResourceTabSpec<TRow extends ResourceRowBase> = {
  kind: string;
  /** 详情标题与签约备注里的实体名：律师 / 律所；代理人 / 代理机构 */
  entity: string;
  panelTitle: string;
  badge: ReactNode;
  keywordPlaceholder: string;
  emptyIcon: ReactNode;
  emptyText: string;
  /** 卡片副标题 */
  subtitleOf: (row: TRow) => ReactNode;
  /** 详情「名称」行标签（法律＝姓名/名称，知产＝名称） */
  nameLabel: string;
  /** 详情「类型」取值：执业律师 / 律师事务所；代理人 / 代理机构 */
  typeLabel: string;
  registerTitle: string;
  registerFootnote?: ReactNode;
  detailFootnote?: ReactNode;
};

export type ResourceLibrarySpec<TRow extends ResourceRowBase> = {
  rowSchema: z.ZodType<TRow>;
  /** 列表接口前缀，如 /enterprise/legal/lawyers */
  endpoint: string;
  /** 签约服务类目，如 LEGAL_SERVICE */
  serviceType: string;
  /** [个人，机构]：个人＝律师/代理人，机构＝律所/代理机构 */
  tabs: [ResourceTabSpec<TRow>, ResourceTabSpec<TRow>];
  /** 资源所属服务商账号（法律＝providerUserId，知产＝ownerType 为服务商时取 ownerUserId） */
  providerUserIdOf: (row: TRow) => string;
  tagLabel: string;
  tagsOf: (row: TRow) => string[];
  /** 服务案例文案（demo：标题（结果）以「；」连接） */
  casesText: (row: TRow) => string;
  licenseLabel: string;
  /** 个人执业者称谓：律师 / 代理人 */
  agentNoun: string;
  /** 合作机构称谓：律所 / 服务商 */
  orgNoun: string;
  /** 服务口径：法律服务 / 知识产权服务 */
  serviceLabel: string;
  /** 后续需求称谓：法律 / 知产 */
  demandNoun: string;
  /** 与主数据一并取回的附加接口（法律：本人挂靠关系）；label 用于「没读取成功」提示 */
  extraRequests?: { key: string; url: string; label: string }[];
  /** 登记按钮 / 资质未开通提示，由模块按身份决定（③＝已取回的签约，法律按其判定 canRegister） */
  renderRegisterControl: (
    openRegister: () => void,
    loaded: { contracts: ResourceContractBase[] },
  ) => ReactNode;
  /** 登记表单正文（名称、标签、所在地等字段各模块不同） */
  renderForm: (form: FormInstance, editing: TRow | null) => ReactNode;
  fillRegisterForm?: (form: FormInstance, tab: ResourceTabSpec<TRow>) => void;
  fillEditForm?: (form: FormInstance, row: TRow) => void;
  /** 模块独有提交字段（法律：organization/areas；知产：kind/organization/fields） */
  extraBody: (
    values: Record<string, unknown>,
    editing: TRow | null,
    tab: ResourceTabSpec<TRow>,
  ) => Record<string, unknown>;
  /** 默认＝平台管理员或登记人；法律额外允许资源所属服务商账号 */
  canManageOf?: (row: TRow, isAdmin: boolean, userId: string) => boolean;
  /** 详情弹窗中插在「类型」之后的模块独有行 */
  detailTopRows?: (
    row: TRow,
    ctx: ResourceActionCtx,
  ) => { key: string; label: string; children: ReactNode }[];
  /** 签约按钮之后的模块独有动作（法律：申请挂靠 / 挂靠状态） */
  extraActions?: (
    row: TRow,
    ctx: ResourceActionCtx,
    where: "card" | "detail",
  ) => ReactNode[];
  /** 面板交出刷新与关闭详情的入口（模块侧动作完成后需要刷新资源/挂靠数据） */
  onReady?: (actions: {
    reload: () => Promise<void>;
    closeDetail: () => void;
  }) => void;
};

type FilterState = { province: string; city: string; keyword: string };

const EMPTY_FILTER: FilterState = { province: "", city: "", keyword: "" };

/** 身份/签约不匹配类错误码：该身份本来就没有这份数据，属预期，静默降级（需求文档「取数失败」口径）。 */
const SILENT_CODES = new Set([401, 403, 20001, 20002]);

/**
 * 辅助数据（签约、签约候选、本人挂靠）读失败时不挡资源清单：
 * 身份不匹配类静默，其余按标签记一次「没读取成功」。
 * 签约候选是「用户（企业）」专属接口，服务商/职员访问必然 20002。
 */
async function readOptionalList<T>(
  label: string,
  run: () => Promise<T[] | null | undefined>,
  missed: string[],
): Promise<T[]> {
  try {
    return (await run()) || [];
  } catch (error) {
    if (error instanceof ApiError && SILENT_CODES.has(error.code ?? error.status ?? 0))
      return [];
    if (!missed.includes(label)) missed.push(label);
    return [];
  }
}

type DetailItem = { key: string; label: string; children: ReactNode };

/**
 * 资源库公共面板：筛选栏 + 资源卡片 + 详情弹窗 + 登记/修改弹窗 + 签约/指派。
 * 法律与知产两个模块的差异（文案、字段、所属服务商判定、登记门控、挂靠）全部由 spec 给出，
 * 面板本体不含任何模块专有名词。灵工进件（flex）不并入：与这两页重合度仅约 39%。
 */
export function ResourceLibraryPanel<TRow extends ResourceRowBase>({
  kind,
  spec,
}: {
  kind: string;
  spec: ResourceLibrarySpec<TRow>;
}) {
  const contracts_createMutation = useOperationMutation(contractsApi.create, [
    "*",
  ]);
  const createMutation = useOperationMutation(resourceLibraryApi.create, [
    spec.endpoint,
  ]);
  const updateMutation = useOperationMutation(resourceLibraryApi.update, [
    spec.endpoint,
  ]);
  const removeMutation = useOperationMutation(resourceLibraryApi.remove, [
    spec.endpoint,
  ]);
  const contracts_agentMutation = useOperationMutation(contractsApi.agent, [
    "*",
  ]);

  const { message, modal } = App.useApp();
  const { me } = useSession();
  const router = useRouter();

  const roles = me?.roles || [];
  const isEnterprise = roles.includes("ENTERPRISE_USER");
  const isAdmin = roles.includes("PLATFORM_ADMIN");
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();

  const tab = spec.tabs.find((item) => item.kind === kind) || spec.tabs[0];
  const isOrg = tab === spec.tabs[1];

  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [detail, setDetail] = useState<TRow | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState<TRow | null>(null);
  const [registerForm] = Form.useForm();

  // spec 由各模块在渲染中构造（闭包持有 me / setState），身份逐帧变化；
  // 取数只依赖 kind 与筛选条件，走 ref 读取最新 spec，避免把 spec 放进依赖引发重复加载。
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  });

  const queryState = useBusinessQuery(
    spec.endpoint,
    "resources",
    { kind, applied },
    async (signal) => {
      const current = specRef.current;
      const missed: string[] = [];
      const query = new URLSearchParams({ kind });
      if (applied.province) query.set("province", applied.province);
      if (applied.province && applied.city) query.set("city", applied.city);
      if (applied.keyword.trim()) query.set("keyword", applied.keyword.trim());
      const [rows, contracts, candidates, extras] = await Promise.all([
        resourceLibraryApi.list(
          current.endpoint,
          Object.fromEntries(query),
          current.rowSchema,
          signal,
        ),
        readOptionalList(
          "签约信息",
          () => contractsApi.options({}, { signal }),
          missed,
        ),
        readOptionalList(
          "签约候选",
          () =>
            contractsApi.candidates(
              { query: { serviceType: current.serviceType } },
              { signal },
            ),
          missed,
        ),
        Promise.all(
          (current.extraRequests || []).map(async (item) => {
            const affiliated = await readOptionalList(
              item.label,
              () => resourceLibraryApi.affiliations(item.url, signal),
              missed,
            );
            return [item.key, affiliated] as const;
          }),
        ),
      ]);
      return {
        rows,
        contracts,
        candidates,
        extra: Object.fromEntries(extras),
        missed,
      };
    },
  );
  const rows = queryState.data?.rows || [];
  const contracts = queryState.data?.contracts || [];
  const candidates = queryState.data?.candidates || [];
  const extra = queryState.data?.extra || {};
  const missed = queryState.data?.missed || [];
  const loading = queryState.isPending;
  const { refetch: refetchList } = queryState;
  const load = useCallback(async () => {
    const result = await refetchList();
    if (result.error) throw result.error;
  }, [refetchList]);

  useEffect(() => {
    specRef.current.onReady?.({
      reload: load,
      closeDetail: () => setDetail(null),
    });
  }, [load]);

  const serviceContracts = contracts.filter(
    (item) =>
      item.serviceType === spec.serviceType &&
      ["PENDING", "ACTIVE"].includes(item.status),
  );

  const contractOf = (row: TRow) => {
    const providerUserId = spec.providerUserIdOf(row);
    return providerUserId
      ? serviceContracts.find(
          (item) => item.providerUserId === providerUserId,
        ) || null
      : null;
  };

  const candidateOf = (row: TRow) =>
    candidates.find(
      (item) => item.providerUserId === spec.providerUserIdOf(row),
    ) || null;

  const providerName = (row: TRow) =>
    candidateOf(row)?.org_name || candidateOf(row)?.display_name || "机构用户";

  const ctxOf = (row: TRow): ResourceActionCtx => ({
    contract: contractOf(row),
    providerName: providerName(row),
    providerUserId: spec.providerUserIdOf(row),
    extra,
  });

  /** 与后端 requireResource 同口径：登记人 / 资源所属服务商 / 平台管理员可改删。 */
  const canManage = (row: TRow) =>
    spec.canManageOf
      ? spec.canManageOf(row, isAdmin, me?.userId || "")
      : Boolean(isAdmin || (me?.userId && row.ownerUserId === me.userId));

  const openRegister = () => {
    setEditing(null);
    registerForm.resetFields();
    spec.fillRegisterForm?.(registerForm, tab);
    setRegisterOpen(true);
  };

  const openEdit = (row: TRow) => {
    setEditing(row);
    registerForm.setFieldsValue({
      name: row.name,
      province: row.province || undefined,
      city: row.city || undefined,
      licenseNo: row.licenseNo || "",
      intro: row.intro || "",
    });
    spec.fillEditForm?.(registerForm, row);
    setRegisterOpen(true);
  };

  const saveResource = async () => {
    const values = (await registerForm.validateFields()) as Record<
      string,
      string
    >;
    if (!values.name?.trim()) {
      message.warning("名称必填");
      return;
    }
    const body = {
      name: values.name,
      province: values.province || "",
      city: values.city || "",
      licenseNo: values.licenseNo || "",
      intro: values.intro || "",
      ...spec.extraBody(values, editing, tab),
    };
    // 登记（新增）免密：只有修改/删除需要密码
    if (!editing) {
      try {
        await createMutation.mutateAsync({ path: spec.endpoint, body });
      } catch (error) {
        if (error instanceof Error)
          presentMutationError(error, (text) => message.error(text));
        return;
      }
      message.success("已登记，服务商备案通过即对外展示");
      setRegisterOpen(false);
      return;
    }
    requestPassword({
      title: "修改资源（需密码）",
      content: `确认修改「${editing.name}」？`,
      okText: "保存修改",
      onOk: async () => {
        await updateMutation.mutateAsync({
          path: spec.endpoint,
          id: editing.id,
          body,
        });
        message.success("已保存修改");
        setRegisterOpen(false);
        setEditing(null);
      },
    });
  };

  const removeResource = (row: TRow) => {
    requestPassword({
      title: "删除资源",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.name}」？已被签约或需求引用的资源不可删除。`,
      onOk: async () => {
        await removeMutation.mutateAsync({ path: spec.endpoint, id: row.id });
        message.success("已删除");
        setDetail(null);
      },
    });
  };

  /* ---------------- 签约 / 指派（后端已有接口） ---------------- */

  const signProvider = (row: TRow) => {
    modal.confirm({
      title: "发起签约",
      okText: "确认发起",
      cancelText: "取消",
      content: (
        <>
          确认向「{providerName(row)}」发起{spec.serviceLabel}签约？
          <br />
          该资源由合作服务商提供，发起后等待服务商确认，确认后签约生效。
        </>
      ),
      onOk: async () => {
        await contracts_createMutation.mutateAsync({
          body: {
            providerUserId: spec.providerUserIdOf(row),
            service_type: spec.serviceType,
            note: `${spec.serviceLabel}合作（${tab.entity}资源库发起 · ${row.name}）`,
          },
        });

        message.success(
          "签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）",
        );
      },
    });
  };

  const signAgent = (row: TRow) => {
    modal.confirm({
      title: `与${spec.agentNoun}签约`,
      okText: "确认签约",
      cancelText: "取消",
      content: (
        <>
          确认与{spec.agentNoun}「{row.name}」签约？
          <br />与{spec.agentNoun}签约即与「{providerName(row)}」建立
          {spec.serviceLabel}签约，并同时将该{spec.orgNoun}的业务指派给该
          {spec.agentNoun}承办。
          <br />
          已与该{spec.orgNoun}有签约时自动复用，仅更新承办{spec.agentNoun}。
        </>
      ),
      onOk: async () => {
        const payload = await contracts_createMutation.mutateAsync({
          body: {
            providerUserId: spec.providerUserIdOf(row),
            service_type: spec.serviceType,
            agent_id: row.id,
            note: `与${spec.agentNoun}签约（${row.name} · ${row.organization || ""}）`,
          },
        });

        const reused = Boolean(payload?.reused);
        message.success(
          reused
            ? `已与该${spec.orgNoun}有签约，业务现指派给${spec.agentNoun}「${row.name}」承办`
            : `签约申请已发起（指派${spec.agentNoun}「${row.name}」），${spec.orgNoun}确认后生效`,
        );
      },
    });
  };

  const designateAgent = (contract: ResourceContractBase, row: TRow) => {
    modal.confirm({
      title: `指派该${spec.agentNoun}`,
      okText: "确认指派",
      cancelText: "取消",
      content: (
        <>
          确认将「{contract.providerOrg || providerName(row)}」的承办
          {spec.agentNoun}指派为「{row.name}」？
          <br />该{spec.orgNoun}下后续发起的{spec.demandNoun}
          需求将自动对接该{spec.agentNoun}，可随时更换。
        </>
      ),
      onOk: async () => {
        await contracts_agentMutation.mutateAsync({
          params: { id: String(contract.id) },
          body: { agent_id: row.id },
        });

        message.success(`业务已指派给${spec.agentNoun}「${row.name}」`);
      },
    });
  };

  /* ---------------- 卡片操作区 / 详情弹窗 ---------------- */

  const signActions = (row: TRow, where: "card" | "detail") => {
    const items: ReactNode[] = [];
    const contract = contractOf(row);
    if (!spec.providerUserIdOf(row)) return items;
    if (isOrg) {
      if (!isEnterprise) return items;
      if (!contract) {
        items.push(
          <Button key="sign" type="primary" onClick={() => signProvider(row)}>
            发起签约
          </Button>,
        );
      } else if (where === "card") {
        items.push(
          <span
            key="status"
            className={`badge badge-${contract.status === "ACTIVE" ? "green" : "orange"}`}
          >
            {contract.status === "ACTIVE" ? "已签约" : "签约待确认"}
          </span>,
        );
      }
      return items;
    }
    if (!isEnterprise) return items;
    if (!contract) {
      items.push(
        <Button key="sign" type="primary" onClick={() => signAgent(row)}>
          与{spec.agentNoun}签约
        </Button>,
      );
    } else if (contract.status === "PENDING") {
      items.push(
        <span key="pending" className="badge badge-orange">
          签约待确认
        </span>,
      );
    } else if (contract.designatedAgentId === row.id) {
      items.push(
        <span key="mine" className="badge badge-green">
          {where === "card"
            ? `您的承办${spec.agentNoun}`
            : `该${spec.agentNoun}为您的承办${spec.agentNoun}`}
        </span>,
      );
    } else {
      items.push(
        <Button
          key="designate"
          type="primary"
          onClick={() => designateAgent(contract, row)}
        >
          指派该{spec.agentNoun}
        </Button>,
      );
    }
    return items;
  };

  const manageActions = (row: TRow) => {
    if (!canManage(row)) return [];
    return [
      <Button key="edit" onClick={() => openEdit(row)}>
        编辑
      </Button>,
      <Button key="remove" danger onClick={() => removeResource(row)}>
        删除
      </Button>,
    ];
  };

  const cardActions = (row: TRow) => {
    const ctx = ctxOf(row);
    return [
      ...signActions(row, "card"),
      ...(spec.extraActions?.(row, ctx, "card") || []),
      ...manageActions(row),
    ];
  };

  const detailItems = (row: TRow): DetailItem[] => {
    const ctx = ctxOf(row);
    const contract = ctx.contract;
    const candidate = candidateOf(row);
    const stText = contract
      ? contract.status === "ACTIVE"
        ? "已签约"
        : "签约待确认"
      : "可签约";
    return [
      { key: "name", label: tab.nameLabel, children: row.name || "—" },
      { key: "kind", label: "类型", children: tab.typeLabel },
      ...(spec.detailTopRows?.(row, ctx) || []),
      { key: "org", label: "所在机构", children: row.organization || "—" },
      {
        key: "license",
        label: spec.licenseLabel,
        children: row.licenseNo || "—",
      },
      {
        key: "location",
        label: "所在地",
        children: locationText(row.province, row.city) || (
          <span className="muted">所在地待补充</span>
        ),
      },
      {
        key: "tags",
        label: spec.tagLabel,
        children: spec.tagsOf(row).join("、") || "—",
      },
      {
        key: "provider",
        label: "合作服务商",
        children: ctx.providerUserId
          ? `${ctx.providerName}${stText ? `（${stText}）` : ""}`
          : "平台统筹资源（签约后由服务商匹配办理）",
      },
      {
        key: "contact",
        label: "服务商联系人",
        children:
          [candidate?.contact_name, candidate?.contact_phone]
            .filter(Boolean)
            .join(" · ") || "—",
      },
      {
        key: "email",
        label: "服务商邮箱",
        children: candidate?.contact_email || "—",
      },
      { key: "intro", label: "简介", children: row.intro || "—" },
      { key: "cases", label: "服务案例", children: spec.casesText(row) || "—" },
    ];
  };

  const detailFooter = (row: TRow) => {
    const ctx = ctxOf(row);
    const nodes: ReactNode[] = [
      ...signActions(row, "detail"),
      ...(spec.extraActions?.(row, ctx, "detail") || []),
    ];
    if (ctx.contract) {
      nodes.push(
        <Button
          key="manage"
          onClick={() => {
            setDetail(null);
            router.push("/contracts");
          }}
        >
          前往签约管理
        </Button>,
      );
    }
    nodes.push(...manageActions(row));
    nodes.push(
      <Button key="close" onClick={() => setDetail(null)}>
        关闭
      </Button>,
    );
    return (
      <Space wrap size={8}>
        {nodes}
      </Space>
    );
  };

  return (
    <Panel title={tab.panelTitle} titleBadge={tab.badge}>
      <Space wrap size={8} style={{ marginBottom: 14 }}>
        <LocationFilterBar
          value={draft}
          onChange={(next) => setDraft({ ...draft, ...next })}
        />
        <Input
          style={{ width: 200 }}
          placeholder={tab.keywordPlaceholder}
          value={draft.keyword}
          onChange={(event) =>
            setDraft({ ...draft, keyword: event.target.value })
          }
        />
        <Button onClick={() => setApplied(draft)}>筛选</Button>
        <Button
          onClick={() => {
            setDraft(EMPTY_FILTER);
            setApplied(EMPTY_FILTER);
          }}
        >
          重置
        </Button>
        {spec.renderRegisterControl(openRegister, { contracts })}
      </Space>

      {missed.length ? (
        <Notice variant="warn">
          {`有 ${missed.length} 项数据没读取成功（${missed.join("、")}），资源清单不受影响。`}
        </Notice>
      ) : null}

      {queryState.error ? (
        <Notice variant="error">{queryState.error.message}</Notice>
      ) : loading ? (
        <Notice variant="info">数据加载中…</Notice>
      ) : rows.length ? (
        <Row gutter={[14, 14]}>
          {rows.map((row) => (
            <Col key={row.id} xs={24} md={12} xl={8}>
              <Card size="small" styles={{ body: { padding: 14 } }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "#eef2ff",
                      color: "#3b5bdb",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 600,
                      flex: "0 0 auto",
                    }}
                  >
                    {(row.name || "?").slice(0, 1)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="text-12 muted">{tab.subtitleOf(row)}</div>
                  </div>
                </div>
                <div
                  style={{
                    margin: "10px 0",
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {spec.tagsOf(row).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
                <div className="text-12 muted">
                  {String(row.intro || "").length > 60
                    ? `${String(row.intro).slice(0, 60)}…`
                    : row.intro || ""}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Button onClick={() => setDetail(row)}>查看详情</Button>
                  {cardActions(row)}
                  <span
                    className="text-12 muted"
                    style={{ marginLeft: "auto" }}
                  >
                    所在地：
                    {locationText(row.province, row.city) || "所在地待补充"}
                  </span>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <EmptyState icon={tab.emptyIcon} text={tab.emptyText} />
      )}

      <Modal
        open={Boolean(detail)}
        title={`${tab.entity}详情 · ${detail?.name || ""}`}
        width={620}
        footer={detail ? detailFooter(detail) : null}
        onCancel={() => setDetail(null)}
      >
        <Descriptions
          column={1}
          size="small"
          bordered
          items={detail ? detailItems(detail) : []}
        />
        {detail && tab.detailFootnote ? (
          <p className="text-12 muted" style={{ marginTop: 10 }}>
            {tab.detailFootnote}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={registerOpen}
        title={editing ? "修改资源（需密码）" : tab.registerTitle}
        width={600}
        onCancel={() => {
          setRegisterOpen(false);
          setEditing(null);
        }}
        footer={
          <Space size={8}>
            <Button
              onClick={() => {
                setRegisterOpen(false);
                setEditing(null);
              }}
            >
              取消
            </Button>
            <Button type="primary" onClick={() => void saveResource()}>
              {editing ? "保存修改" : "提交审核"}
            </Button>
          </Space>
        }
      >
        <Form form={registerForm} layout="vertical">
          {spec.renderForm(registerForm, editing)}
        </Form>
        {tab.registerFootnote ? (
          <p className="text-12 muted" style={{ margin: 0 }}>
            {tab.registerFootnote}
          </p>
        ) : null}
      </Modal>

      {passwordModal}
    </Panel>
  );
}
