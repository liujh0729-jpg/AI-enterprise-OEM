"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { adminApi } from "@/api/admin";

import { DollarOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";

import { PermissionNotice, fmtTime, useAdminData } from "./common";

/**
 * 灵工发薪板块开关：平台管理员一键启用 / 停用，**默认启用**（无设置行＝启用）。
 * 停用后 `/flex` 不渲染「💰 灵工发薪」页签，且发薪接口一律 20002。
 */
export function FlexPayrollSwitch() {
  const admin_saveFlexPayrollMutation = useOperationMutation(
    adminApi.saveFlexPayroll,
    ["*"],
  );

  const { message, modal } = App.useApp();
  const { data, denied } = useAdminData("flexPayroll", (signal) =>
    adminApi.flexPayroll({}, { signal }),
  );
  const [busy, setBusy] = useState(false);
  const enabled = data?.enabled === true;

  const save = async (next: boolean) => {
    try {
      setBusy(true);
      try {
        await admin_saveFlexPayrollMutation.mutateAsync({
          body: {
            enabled: next,
          },
        });

        message.success(next ? "灵工发薪板块已启用" : "灵工发薪板块已停用");
      } finally {
        setBusy(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const confirm = (next: boolean) => {
    modal.confirm({
      title: next ? "启用灵工发薪" : "停用灵工发薪",
      okText: next ? "确认启用" : "确认停用",
      cancelText: "取消",
      okButtonProps: next ? undefined : { danger: true },
      content: next ? (
        <>
          启用后全部身份在「灵活用工服务」页可见「
          <DollarOutlined aria-hidden />{" "}
          灵工发薪」页签，企业可新建发薪、承办代理人可审核。
        </>
      ) : (
        <>
          停用后「
          <DollarOutlined aria-hidden />{" "}
          灵工发薪」页签对全部身份隐藏，发薪相关接口一律拒绝；已产生的发薪台账数据保留，再次启用即可继续。
        </>
      ),
      onOk: () => save(next),
    });
  };

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="灵工发薪板块"
        titleBadge={
          <span className="text-12 muted">
            {enabled ? "当前：启用" : "当前：停用"}
            {data?.updatedAt ? "" : " · 默认启用"}
          </span>
        }
        extra={
          <Button
            type={enabled ? "default" : "primary"}
            danger={enabled}
            loading={busy}
            onClick={() => confirm(!enabled)}
          >
            {enabled ? "停用灵工发薪" : "启用灵工发薪"}
          </Button>
        }
      >
        <Notice variant={enabled ? "success" : "info"}>
          {enabled ? (
            <>
              灵工发薪已启用：企业可在「灵活用工服务 →{" "}
              <DollarOutlined aria-hidden />{" "}
              灵工发薪」新建发薪，承办代理人在同栏目审核后进入台账。
            </>
          ) : (
            "灵工发薪已停用：该板块对所有身份隐藏，不影响灵活用工资源库 / 代理人资源库 / 用工需求 / 服务发布。点右上角按钮即可启用。"
          )}
        </Notice>
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          最后操作时间：{fmtTime(data?.updatedAt) || "—"}
        </div>
      </Panel>
    </>
  );
}
