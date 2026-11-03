import { fmtTime } from "@/lib/datetime";

/**
 * 排期字段（scheduleType / scheduleConfig / scheduledAt）的界面层唯一实现：
 * RPA 任务与 Workbuddy 计划任务共用同一套字段口径与控件，后端对应 backend/src/common/schedule.ts。
 * 时区 Asia/Shanghai，周期重复由服务端算下一次执行时刻，错过周期不补跑。
 */

export const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  once: "不排期",
  scheduled: "定时一次",
  recurring: "周期重复",
};

export const SCHEDULE_TYPE_OPTIONS = Object.entries(SCHEDULE_TYPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

export const RECUR_FREQ_LABEL: Record<string, string> = {
  minutes: "按分钟",
  hourly: "每小时",
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

/** 按分钟重复的可选间隔：与后端 RECUR_MINUTE_INTERVALS 同源，按整十分钟/整三十分钟对齐。 */
export const RECUR_MINUTE_INTERVALS = [10, 30] as const;

/** 重复星期与频率的中文标签：与后端 normalizeScheduleConfig 的 freq / weekdays 取值同源。 */
export const WEEKDAY_LABEL: Record<number, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};

/** 已经落库的排期三列：列表显示与表单回填都按这个形状取值。 */
export type ScheduleRow = {
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
  scheduledAt: string | null;
};

/** 表单里的排期草稿：号数与时刻保持文本，交给服务端校验，避免中途 Number() 变成 NaN。 */
export type ScheduleDraft = {
  scheduleType: string;
  scheduledAt: string;
  freq: string;
  /** freq=minutes 时的间隔分钟数（10 / 30） */
  interval: number;
  time: string;
  weekdays: number[];
  day: string;
};

export const EMPTY_SCHEDULE: ScheduleDraft = {
  scheduleType: "once",
  scheduledAt: "",
  freq: "daily",
  interval: 30,
  time: "",
  weekdays: [],
  day: "",
};

/** 已存排期 → 草稿（编辑态回填用）。 */
export function scheduleDraftFrom(row: ScheduleRow): ScheduleDraft {
  const config = row.scheduleConfig || {};
  return {
    scheduleType: row.scheduleType || "once",
    scheduledAt: row.scheduledAt ? fmtTime(row.scheduledAt) : "",
    freq: String(config.freq || "daily"),
    interval: Number(config.interval) === 10 ? 10 : 30,
    time: String(config.time || ""),
    weekdays: Array.isArray(config.weekdays)
      ? config.weekdays.map((day) => Number(day))
      : [],
    day: config.day === undefined || config.day === null ? "" : String(config.day),
  };
}

/** 草稿 → 提交体：只带当前排期方式真正用得上的字段。 */
export function scheduleBody(draft: ScheduleDraft): Record<string, unknown> {
  if (draft.scheduleType === "scheduled") {
    return { scheduleType: "scheduled", scheduledAt: draft.scheduledAt.trim() };
  }
  if (draft.scheduleType === "recurring") {
    // 每小时与按分钟都由服务端按整点/整 N 分钟对齐，执行时刻对它们没有意义，不带上去。
    const usesTime = !["minutes", "hourly"].includes(draft.freq);
    return {
      scheduleType: "recurring",
      scheduleConfig: {
        freq: draft.freq,
        ...(draft.freq === "minutes" ? { interval: draft.interval } : {}),
        ...(usesTime && draft.time.trim() ? { time: draft.time.trim() } : {}),
        ...(draft.weekdays.length ? { weekdays: draft.weekdays } : {}),
        // 号数原样交给服务端校验：在这里 Number() 一下，"12a" 会变成 NaN、
        // 序列化后是 null，服务端当成「没填」，任务就悄悄少了每月执行日。
        ...(draft.day.trim() ? { day: draft.day.trim() } : {}),
      },
    };
  }
  return { scheduleType: "once" };
}

/** 保存前的必填校验：返回空串＝可以提交。 */
export function scheduleError(draft: ScheduleDraft): string {
  if (draft.scheduleType === "scheduled" && !draft.scheduledAt.trim()) {
    return "定时任务要选择执行时间";
  }
  if (draft.scheduleType === "recurring") {
    if (!draft.freq.trim()) return "周期重复要选择重复频率";
    if (
      draft.freq === "minutes" &&
      !(RECUR_MINUTE_INTERVALS as readonly number[]).includes(draft.interval)
    ) {
      return "按分钟重复要选择间隔（10 或 30 分钟）";
    }
    // 缺了这两项服务端算不出下一次执行时刻，任务会一次都不跑；与后端
    // normalizeScheduleConfig 同口径，提交前就报出来。
    if (draft.freq === "weekly" && !draft.weekdays.length) {
      return "每周重复要选星期";
    }
    if (draft.freq === "monthly" && !draft.day.trim()) {
      return "每月重复要填几号（1-31）";
    }
  }
  return "";
}

/** 排期一句话：把 scheduleType + config + scheduledAt 合成人话，供列表显示。 */
export function scheduleText(row: ScheduleRow): string {
  if (row.scheduleType === "scheduled") {
    return row.scheduledAt ? `定时 ${fmtTime(row.scheduledAt)}` : "定时（未选时间）";
  }
  if (row.scheduleType === "recurring") {
    const config = row.scheduleConfig || {};
    const rawFreq = String(config.freq || "");
    if (rawFreq === "minutes") {
      return `每 ${Number(config.interval) === 10 ? 10 : 30} 分钟`;
    }
    const freq = RECUR_FREQ_LABEL[rawFreq] || "周期";
    const weekdays = Array.isArray(config.weekdays)
      ? config.weekdays
          .map((day) => WEEKDAY_LABEL[Number(day)] || "")
          .filter(Boolean)
          .join("、")
      : "";
    const day = config.day ? ` ${String(config.day)} 号` : "";
    const time = rawFreq !== "hourly" && config.time ? ` ${String(config.time)}` : "";
    return `${freq}${weekdays ? ` ${weekdays}` : ""}${day}${time}`;
  }
  return "不排期";
}

/** 下次执行时刻：周期重复取排期算出的 scheduledAt，一次性计划派发后不再显示。 */
export function nextRunText(row: ScheduleRow): string {
  if (row.scheduleType === "recurring" || row.scheduleType === "scheduled") {
    return row.scheduledAt ? fmtTime(row.scheduledAt) : "—";
  }
  return "—";
}

/** DatePicker 回传的是 dayjs 对象，编辑态回填的是文本：两者都归一成后端可解析的字符串。 */
export function toDateTimeText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  const format = (value as { format?: (pattern: string) => string }).format;
  return typeof format === "function" ? format("YYYY-MM-DDTHH:mm:ss") : "";
}
