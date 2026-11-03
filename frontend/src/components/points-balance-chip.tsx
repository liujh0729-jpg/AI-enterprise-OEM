"use client";

import { WalletOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useRouter } from "next/navigation";
import { pointsApi } from "@/api/points";
import { useBusinessQuery } from "@/query/business";
import { useI18n } from "@/lib/i18n/i18n";

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

/**
 * 顶栏积分余额（本站积分，只读快照）：点击进「积分中心」充值/赠送/查流水。
 * 未登录或接口异常时显示 --，不打断顶栏其余操作。
 */
export function PointsBalanceChip() {
  const { t } = useI18n();
  const router = useRouter();
  const query = useBusinessQuery("points", "summary", {}, (signal) =>
    pointsApi.summary({ signal }),
  );
  const balance = query.data?.points.balance;

  return (
    <Tooltip title={`${t("积分中心")}：${t("可用余额")} ${fmtPoints(balance)}`}>
      <Button
        type="text"
        size="small"
        icon={<WalletOutlined aria-hidden />}
        loading={query.isPending}
        onClick={() => router.push("/points")}
        aria-label={t("积分中心")}
      >
        <span style={{ fontWeight: 600 }}>{fmtPoints(balance)}</span>
      </Button>
    </Tooltip>
  );
}