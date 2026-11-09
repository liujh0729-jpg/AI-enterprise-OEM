"use client";

import { Select } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acqApi,
  intentLevelLabel,
  leadStatusLabel,
  platformLabel,
  businessStatusLabel,
} from "./acquisition-common";

/**
 * 线索 / 客户档案的远程选择器：候选可能上千条，不做全量下拉，
 * 输入即按关键词回源搜索（300ms 防抖），选中项在选项里始终保留。
 */

type Option = { value: number; label: string };

function useRemoteOptions(
  load: (keyword: string) => Promise<Option[]>,
): {
  options: Option[];
  loading: boolean;
  search: (keyword: string) => void;
} {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    (keyword: string) => {
      const current = ++seq.current;
      setLoading(true);
      load(keyword)
        .then((next) => {
          if (current === seq.current) setOptions(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (current === seq.current) setLoading(false);
        });
    },
    [load],
  );

  useEffect(() => {
    run("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // 选择器只挂载一次，按空关键词取首批候选
  }, [run]);

  const search = (keyword: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(keyword.trim()), 300);
  };

  return { options, loading, search };
}

export function AcqLeadPicker({
  value,
  onChange,
  placeholder = "搜索并选择线索",
  disabled,
}: {
  value?: number;
  onChange?: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { options, loading, search } = useRemoteOptions(async (keyword) => {
    const result = await acqApi.leads({
      query: {
        page: 1,
        pageSize: 20,
        ...(keyword ? { q: keyword } : {}),
      },
    });
    return (result?.list ?? []).map((row) => ({
      value: row.id,
      label: `${row.nickname || row.platformUserId || `线索 #${row.id}`} · ${platformLabel(row.platform)} · ${intentLevelLabel(row.intentLevel)} ${row.intentScore} · ${leadStatusLabel(row.status)}`,
    }));
  });

  return (
    <Select
      showSearch
      allowClear
      filterOption={false}
      loading={loading}
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      options={options}
      onSearch={search}
      onChange={(next) => onChange?.(next ?? undefined)}
    />
  );
}

export function AcqProfilePicker({
  value,
  onChange,
  placeholder = "搜索并选择客户档案",
}: {
  value?: number;
  onChange?: (value: number | undefined) => void;
  placeholder?: string;
}) {
  const { options, loading, search } = useRemoteOptions(async (keyword) => {
    const result = await acqApi.profiles({
      query: {
        page: 1,
        pageSize: 20,
        ...(keyword ? { q: keyword } : {}),
      },
    });
    return (result?.list ?? []).map((row) => ({
      value: row.id,
      label: `${row.displayName || `客户 #${row.id}`} · ${businessStatusLabel(row.businessStatus)}（${row.channelPeerKey || "未知渠道"}）`,
    }));
  });

  return (
    <Select
      showSearch
      allowClear
      filterOption={false}
      loading={loading}
      placeholder={placeholder}
      value={value}
      options={options}
      onSearch={search}
      onChange={(next) => onChange?.(next ?? undefined)}
    />
  );
}
