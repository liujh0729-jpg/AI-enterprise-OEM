"use client";

import { Button } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ImConnector, ImOverview } from "@enterprise/contracts";
import { imApi } from "@/api/im";
import { Notice } from "@/components/ui/panel";
import { ImMappingOverview } from "./im-mapping-overview";
import {
  ConnectorPanel,
  DeptPanel,
  ImOverviewCards,
  LogPanel,
  NotifyPanel,
  ObjectPanel,
} from "./im-panels";

export type StaffImView =
  | "mapping"
  | "connectors"
  | "departments"
  | "objects"
  | "notify"
  | "logs";

/** 职员/代理人管理里的 IM 页签：连接器与映射都按当前组织归属，不跨组织复用。 */
export function StaffImWorkspace({ view }: { view: StaffImView }) {
  const [connectors, setConnectors] = useState<ImConnector[]>([]);
  const [overview, setOverview] = useState<ImOverview | null>(null);
  const [failed, setFailed] = useState("");

  const reload = useCallback(async () => {
    try {
      const [rows, summary] = await Promise.all([
        imApi.connectors(),
        imApi.overview(),
      ]);
      setConnectors(rows || []);
      setOverview(summary);
      setFailed("");
    } catch (caught) {
      setFailed((caught as Error).message || "IM 连接读取失败");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (failed) {
    return (
      <Notice variant="error">
        {failed} <Button onClick={() => void reload()}>重试</Button>
      </Notice>
    );
  }

  if (view === "mapping") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <ImOverviewCards overview={overview} />
        <ImMappingOverview connectors={connectors} reload={reload} />
      </div>
    );
  }

  if (view === "connectors") {
    return <ConnectorPanel connectors={connectors} reload={reload} />;
  }
  if (view === "departments") return <DeptPanel connectors={connectors} />;
  if (view === "objects") return <ObjectPanel connectors={connectors} />;
  if (view === "notify") return <NotifyPanel connectors={connectors} />;
  return <LogPanel connectors={connectors} />;
}