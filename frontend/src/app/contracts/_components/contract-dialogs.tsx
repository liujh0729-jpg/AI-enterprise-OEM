"use client";

import { App, Modal } from "antd";
import { useEffect, useState } from "react";
import { useContractActions } from '@/query/contract-actions';
import { categoryLabel } from "@/app/staff/_components/common";

type PickerOption = {
  value: string;
  title: string;
  badge?: string;
  desc?: string;
};

/** 选择行样式（对齐 demo 分配/指定弹窗的可选中行）。 */
function rowStyle(active: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: `1px solid ${active ? "#4f46e5" : "#e4eaf2"}`,
    borderRadius: 8,
    marginBottom: 8,
    cursor: "pointer",
    background: active ? "#eef2ff" : "#fff",
  };
}

function PickerList({
  options,
  selected,
  onSelect,
}: {
  options: PickerOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      {options.map((option) => (
        <div
          key={option.value}
          style={rowStyle(option.value === selected)}
          onClick={() => onSelect(option.value)}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{option.title}</span>
              {option.badge ? (
                <span className="badge badge-sky" style={{ marginLeft: 8 }}>
                  {option.badge}
                </span>
              ) : null}
            </div>
            {option.desc ? <div className="text-12 muted">{option.desc}</div> : null}
          </div>
          <span className="text-12 muted">选择</span>
        </div>
      ))}
    </div>
  );
}

export type ProviderStaffOption = {
  staffUserId: string;
  staff_name?: string;
  roles?: string[];
  profile?: { realName?: string; phone?: string; categories?: string[] } | null;
};

/** 分配/改派企业给职员（服务商视角；未完结业务随分配自动流转）。 */
export function AssignStaffModal({
  open,
  enterpriseId,
  enterpriseName,
  staff,
  current,
  onCancel,
  onDone,
}: {
  open: boolean;
  enterpriseId: number;
  enterpriseName: string;
  staff: ProviderStaffOption[];
  current: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const actions=useContractActions();
  const [picked, setPicked] = useState(current);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPicked(current);
  }, [open, current]);

  return (
    <Modal
      open={open}
      title={`分配企业 · ${enterpriseName}`}
      width={520}
      okText="确认分配"
      cancelText="取消"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={async () => {
        if (!picked) {
          message.warning("请选择要分配的职员");
          return;
        }
        setSubmitting(true);
        try {
          await actions.assign.mutateAsync({body:{
            enterpriseId,
            staffUserId: picked,
          }});
          const name =
            staff.find((item) => item.staffUserId === picked)?.staff_name ||
            picked;
          message.success(`已将「${enterpriseName}」分配给「${name}」`);
          onDone();
        } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="muted">
        分配后，该企业的企业资料与未完结业务（财税申报、出海、物流、法律、知产、灵活用工等）将自动流转给该职员承办；可随时改派。
      </div>
      <div style={{ marginTop: 12 }}>
        <PickerList
          options={staff.map((item) => ({
            value: item.staffUserId,
            title: item.staff_name || item.profile?.realName || item.staffUserId,
            badge: (item.roles || []).join(" / "),
            desc: [
              item.profile?.phone,
              (item.profile?.categories || [])
                .map((item) => categoryLabel(item))
                .join("、"),
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          selected={picked}
          onSelect={setPicked}
        />
      </div>
    </Modal>
  );
}

export type BusinessStaffOption = {
  name?: string;
  title?: string;
  phone?: string;
  email?: string;
};

/** 指定/更换业务人员（从服务商已绑定生效的职员中选择对接人）。 */
export function DesignateStaffModal({
  open,
  contractId,
  categoryLabel,
  staff,
  current,
  onCancel,
  onDone,
}: {
  open: boolean;
  contractId: number;
  categoryLabel: string;
  staff: BusinessStaffOption[];
  current: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const actions=useContractActions();
  const [picked, setPicked] = useState(current);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPicked(current);
  }, [open, current]);

  return (
    <Modal
      open={open}
      title={`指定业务人员 · ${categoryLabel}`}
      width={520}
      okText="确认指定"
      cancelText="取消"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={async () => {
        if (!picked) {
          message.warning("请选择业务人员");
          return;
        }
        setSubmitting(true);
        try {
          await actions.staff.mutateAsync({params:{id:String(contractId)},body:{staff_name:picked}});
          message.success(`已指定业务人员「${picked}」，对该签约生效`);
          onDone();
        } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="muted">指定后，该业务人员成为本次签约的对接人；可随时更换。</div>
      <div style={{ marginTop: 12 }}>
        <PickerList
          options={staff.map((item) => ({
            value: String(item.name || ""),
            title: String(item.name || "—"),
            badge: item.title || undefined,
            desc: [item.phone || "—", item.email || ""]
              .filter(Boolean)
              .join(" · "),
          }))}
          selected={picked}
          onSelect={setPicked}
        />
      </div>
    </Modal>
  );
}
