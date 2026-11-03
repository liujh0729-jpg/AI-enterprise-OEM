"use client";

import { App, Button } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { identityApi } from "@/api/identity";
import { presentMutationError } from "@/query/errors";
import { isPersonalSubject } from "@/lib/subject";
import { useSession } from "@/lib/session";

/** 本人发起的加入申请（`GET /enterprise/staff/affiliations/mine`）。 */
type MyApplication = {
  id: number;
  providerUserId: string;
  category: string;
  status: string;
};

/**
 * 本人「加入申请」的共享内存态：同一页里名录卡片与服务商详情弹窗各挂一个本组件实例，
 * 若各自 fetch 一份，从弹窗提交后卡片仍会停在「申请加入」。这里收口成一份数据 + 订阅，
 * 任一实例提交/撤回后全部实例同步翻转（后端仍是唯一裁判）。
 */
let myAppsOwner: string | null = null;
let myAppsCache: MyApplication[] | null = null;
const myAppsListeners = new Set<() => void>();

function notifyMyApps() {
  myAppsListeners.forEach((listener) => listener());
}

/** 重新拉取本人发起的加入申请并广播给所有「申请加入」控件。 */
async function refreshMyApps() {
  try {
    const rows = await identityApi.myAffiliations();
    myAppsCache = rows || [];
  } catch {
    myAppsCache = [];
  }
  notifyMyApps();
}

function useMyApplications(userId: string | undefined, enabled: boolean) {
  const [apps, setApps] = useState<MyApplication[]>(myAppsCache ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (myAppsOwner !== (userId ?? null)) {
      myAppsOwner = userId ?? null;
      myAppsCache = null;
    }
    const sync = () => setApps(myAppsCache ?? []);
    myAppsListeners.add(sync);
    if (!myAppsCache) void refreshMyApps();
    return () => {
      myAppsListeners.delete(sync);
    };
  }, [userId, enabled]);

  return apps;
}

/** 本人是否已在该机构在册（provider_staff 里的一条 ACTIVE 绑定）。 */
function boundAt(staffOf: unknown, providerUserId?: string) {
  return (
    Array.isArray(staffOf) &&
    staffOf.some(
      (item) =>
        (item as { providerUserId?: string; status?: string }).providerUserId ===
          providerUserId &&
        (item as { status?: string }).status === "ACTIVE",
    )
  );
}

/**
 * 「撤回加入申请」按钮：卡片待审批态与职员侧「我的加入申请」清单共用同一份实现
 * （DELETE /enterprise/staff/affiliations/:id，仅申请人本人的待审批申请可撤回）。
 */
export function WithdrawApplicationButton({
  applicationId,
  providerName,
  categoryLabel,
  onDone,
}: {
  applicationId: number;
  providerName: string;
  categoryLabel: string;
  onDone?: () => void;
}) {
  const { message, modal } = App.useApp();

  const withdraw = () => {
    modal.confirm({
      title: "撤回加入申请",
      okText: "确认撤回",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: `撤回对「${providerName}」的「${categoryLabel}」加入申请？撤回后可重新申请。`,
      onOk: async () => {
        try {
          await identityApi.cancelAffiliation({
            params: { id: String(applicationId) },
          });
          message.success("已撤回加入申请");
          void refreshMyApps();
          onDone?.();
        } catch (error) {
          presentMutationError(error, (text) => message.error(text));
        }
      },
    });
  };

  return <Button onClick={withdraw}>撤回申请</Button>;
}

/**
 * 「申请加入服务商」动作（职员/代理人与个人用户在服务商详情、名录卡片上使用）：
 * 未提交个人资料 → 引导去「身份与资质」；已加入该机构 → 只显示「已加入」；
 * 已提交待审批 → 「待审批」+ 撤回；一个职员可同时加入多家机构。
 */
export function StaffApplyAction({
  providerUserId,
  providerName,
  category,
  categoryLabel,
  onChanged,
}: {
  providerUserId?: string;
  providerName: string;
  /** 申请加入的分类编码：带细项的板块传细项 code，其余板块传板块 code。 */
  category: string;
  /** 分类的界面名（弹窗与提示里说清申请的是哪一块业务）。 */
  categoryLabel: string;
  onChanged?: () => void;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { me } = useSession();

  // 机构账号看自己不看；能申请的人＝提交过职员/代理人资料的账号，或个人用户（点击后引导补资料）
  const isSelf = Boolean(me && providerUserId && me.userId === providerUserId);
  const eligible =
    Boolean(me?.staffProfile) ||
    (me?.roles || []).includes("PROVIDER_STAFF") ||
    isPersonalSubject(
      (me?.enterprise as { subjectType?: string } | null)?.subjectType,
    );
  const visible = Boolean(providerUserId) && !isSelf && eligible;
  const bound = boundAt(me?.staffOf, providerUserId);
  const apps = useMyApplications(me?.userId, visible && !bound);

  const pending = apps.find(
    (item) =>
      item.providerUserId === providerUserId &&
      item.category === category &&
      item.status === "PENDING",
  );

  const submit = async () => {
    try {
      await identityApi.apply({ body: { providerUserId, category } });
      message.success(
        `已向「${providerName}」提交「${categoryLabel}」加入申请，待机构审核通过后即成为其职员/代理人`,
      );
      await refreshMyApps();
      onChanged?.();
    } catch (error) {
      presentMutationError(error, (text) => message.error(text));
    }
  };

  const apply = () => {
    if (!me?.staffProfile) {
      modal.confirm({
        title: "申请加入前先提交个人资料",
        content: `机构审核「${categoryLabel}」加入申请时看的是你在「身份与资质」提交的个人资料（真实姓名 / 手机号 / 服务类目 / 个人简介）。先提交资料，再回来申请加入。`,
        okText: "去提交资料",
        cancelText: "稍后再说",
        onOk: () => router.push("/identity?identity=PROVIDER_STAFF"),
      });
      return;
    }
    modal.confirm({
      title: "申请加入服务商",
      okText: "提交申请",
      cancelText: "取消",
      content: `确认向「${providerName}」申请加入「${categoryLabel}」？提交后由该机构在「职员/代理人管理」审核，通过后你即成为其职员/代理人（可同时加入多家机构）。`,
      onOk: submit,
    });
  };

  if (!visible) return null;
  if (bound) return <span className="badge badge-green">已加入该服务商</span>;
  if (pending)
    return (
      <>
        <span className="badge badge-orange">加入申请待审批</span>
        <WithdrawApplicationButton
          applicationId={pending.id}
          providerName={providerName}
          categoryLabel={categoryLabel}
          onDone={() => {
            onChanged?.();
          }}
        />
      </>
    );
  return (
    <Button type="primary" onClick={apply}>
      申请加入
    </Button>
  );
}
