"use client";

import { SaveOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Collapse, Input, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { memoryApi, type AgentGrantItem, type AgentGrants } from "./common";

type DomainGroup = {
  domain: string;
  label: string;
  items: AgentGrantItem[];
  granted: number;
};

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const bag = new Set(right);
  return left.every((item) => bag.has(item));
}

/**
 * 授权闸：外部 MCP 客户端与 Agent 代用户执行写动作时，只执行这里勾选过的接口；
 * 未勾选与永久排除的只返回草案。整份覆盖保存（取消勾选＝收回授权），不自作主张自动提交。
 * 新增授权等于把「不必问我」的范围扩大，因此要验登录密码；收回授权随时可行，不设门槛。
 */
export function AgentGrantsPanel() {
  const { message } = App.useApp();
  const { request: confirmPassword, modal: passwordModal } = usePasswordConfirm();
  const [data, setData] = useState<AgentGrants | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await memoryApi.grants();
    if (result.data) {
      const granted = result.data.items
        .filter((item) => item.allowed)
        .map((item) => item.action);
      setData(result.data);
      setSelected(granted);
      setSaved(granted);
      setOpenKeys(
        result.data.domains
          .filter((domain) => domain.granted > 0)
          .map((domain) => domain.domain),
      );
      setError("");
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo<DomainGroup[]>(() => {
    if (!data) return [];
    const word = keyword.trim().toLowerCase();
    const labels = new Map(data.domains.map((domain) => [domain.domain, domain.label]));
    const bucket = new Map<string, DomainGroup>();
    for (const item of data.items) {
      if (word) {
        const haystack = `${item.actionLabel} ${item.action} ${item.path} ${labels.get(item.domain) ?? ""}`.toLowerCase();
        if (!haystack.includes(word)) continue;
      }
      const group = bucket.get(item.domain) ?? {
        domain: item.domain,
        label: labels.get(item.domain) ?? item.domainLabel,
        items: [],
        granted: 0,
      };
      group.items.push(item);
      if (selected.includes(item.action)) group.granted += 1;
      bucket.set(item.domain, group);
    }
    return [...bucket.values()];
  }, [data, keyword, selected]);

  const dirty = !sameSet(selected, saved);
  const grantableCount = data ? data.total - data.forbiddenCount : 0;
  // 本次相比已保存的勾选多放开多少个动作：只有净新增才要验密
  const addedCount = useMemo(
    () => selected.filter((action) => !saved.includes(action)).length,
    [saved, selected],
  );

  const toggle = (item: AgentGrantItem, checked: boolean) => {
    if (item.forbidden) return;
    setSelected((prev) =>
      checked
        ? [...prev.filter((action) => action !== item.action), item.action]
        : prev.filter((action) => action !== item.action),
    );
  };

  const persist = async (password?: string) => {
    setSaving(true);
    try {
      const result = await memoryApi.saveGrants(selected, password);
      message.success(
        `已保存：新增授权 ${result.granted} 个、收回 ${result.revoked} 个`,
      );
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "授权保存失败");
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!addedCount) {
      void persist();
      return;
    }
    confirmPassword({
      title: "新增自动执行授权",
      content: `本次要新放开 ${addedCount} 个写动作：保存后 Agent 与 MCP 客户端执行它们不再逐次确认。要放开就输入本站登录密码；取消授权不需要密码。`,
      okText: "验证并保存",
      onOk: (password) => persist(password),
    });
  };

  return (
    <Panel
      title="可自动执行的动作"
      titleExtra={
        <span className="text-12 muted">
          MCP 客户端与 Agent 代你执行写动作时，只执行这里勾选过的接口；未勾选的只返回草案，签约、报税提交、开票、外呼导入永久排除
        </span>
      }
      extra={
        <Button
          type="primary"
          icon={<SaveOutlined aria-hidden />}
          loading={saving}
          disabled={!dirty}
          onClick={save}
        >
          保存设置
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}

      {!loading && data ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="text-12 muted">
              已授权 {selected.length} 个 / 可授权 {grantableCount} 个 · 永久排除{" "}
              {data.forbiddenCount} 个
              {addedCount ? (
                <Tag color="warning" style={{ marginLeft: 8 }}>
                  本次新增 {addedCount} 个，保存要验密码
                </Tag>
              ) : null}
            </span>
            <span style={{ flex: 1 }} />
            <Input
              allowClear
              value={keyword}
              placeholder="按动作名或接口路径搜索"
              style={{ width: 260 }}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>

          {groups.length ? (
            <Collapse
              ghost
              activeKey={keyword.trim() ? groups.map((group) => group.domain) : openKeys}
              onChange={(keys) =>
                setOpenKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])
              }
              items={groups.map((group) => ({
                key: group.domain,
                label: (
                  <span>
                    {group.label}
                    <span className="text-12 muted" style={{ marginLeft: 8 }}>
                      {group.granted} / {group.items.length}
                    </span>
                  </span>
                ),
                children: (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                      gap: "6px 16px",
                    }}
                  >
                    {group.items.map((item) => (
                      <Checkbox
                        key={item.action}
                        checked={!item.forbidden && selected.includes(item.action)}
                        disabled={item.forbidden}
                        onChange={(event) => toggle(item, event.target.checked)}
                      >
                        <span>{item.actionLabel}</span>
                        <span className="mono text-12 muted" style={{ marginLeft: 8 }}>
                          {item.method} {item.path}
                        </span>
                        {item.forbidden ? (
                          <Tag style={{ marginLeft: 8 }}>永久排除：{item.forbiddenReason}</Tag>
                        ) : null}
                      </Checkbox>
                    ))}
                  </div>
                ),
              }))}
            />
          ) : (
            <span className="text-12 muted">没有匹配的动作</span>
          )}
        </div>
      ) : null}
      {passwordModal}
    </Panel>
  );
}
