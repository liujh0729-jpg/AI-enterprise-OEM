"use client";

import { DatePicker, Input, Select } from "antd";
import {
  RECUR_FREQ_LABEL,
  RECUR_MINUTE_INTERVALS,
  SCHEDULE_TYPE_OPTIONS,
  WEEKDAY_LABEL,
  toDateTimeText,
  type ScheduleDraft,
} from "@/lib/schedule";

/**
 * 排期控件（唯一实现）：RPA 任务与 Workbuddy 计划任务共用，字段口径同 backend/src/common/schedule.ts。
 * 放在父级 `div.data-table-form` 网格里使用；执行时间已存值时传 text，用文本框回填而不是重选。
 */
export function ScheduleFields({
  draft,
  onChange,
  textDate = false,
  allowOnce = true,
  allowMinuteInterval = false,
}: {
  draft: ScheduleDraft;
  onChange: (patch: Partial<ScheduleDraft>) => void;
  /** 编辑态：回填的是已格式化的时间文本，此时用输入框改。 */
  textDate?: boolean;
  /** Workbuddy 定时任务分类必须排期（后端拒绝 once），此时不提供「不排期」。 */
  allowOnce?: boolean;
  /** 只有需要「每 10/30 分钟」的任务（Agent 定时任务）才开放按分钟重复。 */
  allowMinuteInterval?: boolean;
}) {
  const typeOptions = allowOnce
    ? SCHEDULE_TYPE_OPTIONS
    : SCHEDULE_TYPE_OPTIONS.filter((option) => option.value !== "once");
  const freqOptions = Object.entries(RECUR_FREQ_LABEL)
    .filter(([value]) => allowMinuteInterval || value !== "minutes")
    .map(([value, label]) => ({ value, label }));
  // 每小时按整点、按分钟按整 N 分钟对齐，执行时刻对两者都不生效，不渲染控件。
  const usesTime = !["minutes", "hourly"].includes(draft.freq);
  return (
    <>
      <label className="data-table-form-item">
        <span className="data-table-form-label">排期方式</span>
        <Select
          value={draft.scheduleType}
          options={typeOptions}
          onChange={(value) => onChange({ scheduleType: value })}
        />
      </label>
      {draft.scheduleType === "scheduled" ? (
        <label className="data-table-form-item">
          <span className="data-table-form-label">
            执行时间<b style={{ color: "var(--danger)" }}> *</b>
          </span>
          {textDate ? (
            <Input
              value={draft.scheduledAt}
              placeholder="YYYY-MM-DD HH:mm"
              onChange={(event) => onChange({ scheduledAt: event.target.value })}
            />
          ) : (
            <DatePicker
              showTime
              style={{ width: "100%" }}
              onChange={(value) => onChange({ scheduledAt: toDateTimeText(value) })}
            />
          )}
        </label>
      ) : null}
      {draft.scheduleType === "recurring" ? (
        <>
          <label className="data-table-form-item">
            <span className="data-table-form-label">重复频率</span>
            <Select
              value={draft.freq}
              options={freqOptions}
              onChange={(value) => onChange({ freq: value })}
            />
          </label>
          {draft.freq === "minutes" ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                执行间隔<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Select
                value={draft.interval}
                options={RECUR_MINUTE_INTERVALS.map((value) => ({
                  value,
                  label: `每 ${value} 分钟`,
                }))}
                onChange={(value) => onChange({ interval: value })}
              />
            </label>
          ) : null}
          {usesTime ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">执行时刻</span>
              <Input
                value={draft.time}
                maxLength={5}
                placeholder="HH:MM，如 02:00"
                onChange={(event) => onChange({ time: event.target.value })}
              />
            </label>
          ) : null}
          {draft.freq === "weekly" ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                重复星期<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Select
                mode="multiple"
                value={draft.weekdays}
                options={Object.entries(WEEKDAY_LABEL).map(([value, label]) => ({
                  value: Number(value),
                  label,
                }))}
                onChange={(value) => onChange({ weekdays: value })}
              />
            </label>
          ) : null}
          {draft.freq === "monthly" ? (
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                每月几号<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Input
                value={draft.day}
                maxLength={2}
                placeholder="1-31"
                onChange={(event) => onChange({ day: event.target.value })}
              />
            </label>
          ) : null}
        </>
      ) : null}
    </>
  );
}
