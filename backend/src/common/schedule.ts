import { Prisma } from '../../generated/prisma';
import { toJsonObject } from '../shared/json-value';
import { text } from './api';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';

/**
 * 排期字段的唯一口径，RPA 任务与 Workbuddy 计划共用同一套列名与算法：
 * `scheduleType`＝once（不排期）| scheduled（定时一次）| recurring（周期重复），
 * `scheduledAt`＝下一次执行时刻，`scheduleConfig`＝{ freq, interval, time, weekdays, day, minute }。
 * 周期推算统一按 Asia/Shanghai；错过周期不补跑，直接推到未来。
 */

export const SCHEDULE_TYPES = ['once', 'scheduled', 'recurring'] as const;

export const SCHEDULE_TYPE_LABELS: Record<string, string> = {
  once: '不排期',
  scheduled: '定时一次',
  recurring: '周期重复',
};

export const RECUR_FREQS = [
  'minutes',
  'hourly',
  'daily',
  'weekly',
  'monthly',
] as const;

export const RECUR_FREQ_LABELS: Record<string, string> = {
  minutes: '按分钟',
  hourly: '每小时',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

/** freq=minutes 的可选间隔：按整十分钟/整三十分钟对齐，不按「上次跑完 + N 分」。 */
export const RECUR_MINUTE_INTERVALS = [10, 30] as const;

export type ScheduleFields = {
  scheduleType?: string;
  scheduleConfig?: Prisma.InputJsonValue;
  scheduledAt?: Date | null;
};

/**
 * 从请求体读排期字段：给了 scheduleType 就整组重算（once 清空时间与周期配置，
 * scheduled 必须给得出时间），只给 scheduleConfig / scheduledAt 时按改动项处理。
 */
export function readScheduleFields(
  body: Record<string, unknown>,
  partial = false,
): ScheduleFields {
  const data: ScheduleFields = {};
  if (body.scheduleType !== undefined) {
    const scheduleType = normalizeScheduleType(body.scheduleType);
    data.scheduleType = scheduleType;
    if (scheduleType === 'scheduled') {
      const at = parseScheduleDate(body.scheduledAt);
      if (!at) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '定时任务要选择执行时间',
        );
      }
      data.scheduledAt = at;
    } else if (scheduleType === 'once') {
      data.scheduledAt = null;
      data.scheduleConfig = {};
    } else {
      data.scheduleConfig = toJsonObject(
        normalizeScheduleConfig(body.scheduleConfig),
      );
    }
  } else if (body.scheduleConfig !== undefined) {
    data.scheduleConfig = toJsonObject(
      normalizeScheduleConfig(body.scheduleConfig),
    );
  }
  if (body.scheduledAt !== undefined && body.scheduleType === undefined) {
    const at = parseScheduleDate(body.scheduledAt);
    if (at) data.scheduledAt = at;
    else if (partial) data.scheduledAt = null;
  }
  return data;
}

export function normalizeScheduleType(raw: unknown): string {
  const value = text(raw).trim().toLowerCase();
  if (!value) return 'once';
  if (!(SCHEDULE_TYPES as readonly string[]).includes(value)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `排期方式只能是：${SCHEDULE_TYPES.join(' / ')}`,
    );
  }
  return value;
}

export function normalizeScheduleConfig(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '排期配置不是合法 JSON',
      );
    }
  }
  if (!isObject(raw)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '排期配置要写成 { freq, time, weekdays, day }',
    );
  }
  const config = raw as Record<string, unknown>;
  const freq = text(config.freq).trim();
  if (freq && !(RECUR_FREQS as readonly string[]).includes(freq)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '重复频率只能是 minutes / hourly / daily / weekly / monthly',
    );
  }
  const minuteInterval = optionalNumber(config.interval);
  if (
    minuteInterval !== null &&
    (!(RECUR_MINUTE_INTERVALS as readonly number[]).includes(minuteInterval) ||
      !Number.isInteger(minuteInterval))
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '按分钟重复的间隔只能是 10 或 30 分钟',
    );
  }
  if (freq === 'minutes' && minuteInterval === null) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '按分钟重复要选择间隔（10 或 30 分钟）',
    );
  }
  const time = text(config.time).trim();
  if (time) {
    const [hourText, minuteText, extra] = time.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const valid =
      extra === undefined &&
      /^\d{2}$/.test(hourText) &&
      /^\d{2}$/.test(minuteText) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59;
    if (!valid) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '执行时刻要写成 HH:MM，例如 02:00',
      );
    }
  }
  const weekdays: number[] = [];
  const rawWeekdays = Array.isArray(config.weekdays)
    ? config.weekdays
    : typeof config.weekdays === 'string'
      ? config.weekdays.split(/[,，、;；\s]+/)
      : [];
  for (const item of rawWeekdays) {
    const value = Number(text(item).trim());
    if (!Number.isInteger(value) || value < 1 || value > 7) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '重复星期取值 1-7（1＝周一）',
      );
    }
    if (!weekdays.includes(value)) weekdays.push(value);
  }
  // 数值项一旦落到范围外，调度器永远匹配不上，任务会安静地一次都不跑；
  // 这里不收口成 0，直接报出来。
  const dayOfMonth = optionalNumber(config.day);
  if (
    dayOfMonth !== null &&
    (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '每月执行日取值 1-31（号数）',
    );
  }
  // 缺了这两项就永远算不出下一次执行时刻，任务会安静地一次都不跑；
  // 和号数、分钟一样直接报出来，不当成「没填」放行。
  if (freq === 'weekly' && !weekdays.length) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '每周重复要选星期');
  }
  if (freq === 'monthly' && dayOfMonth === null) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '每月重复要填几号（1-31）',
    );
  }
  const minuteOfHour = optionalNumber(config.minute);
  if (
    minuteOfHour !== null &&
    (!Number.isInteger(minuteOfHour) || minuteOfHour < 0 || minuteOfHour > 59)
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '每小时执行分钟取值 0-59',
    );
  }
  return {
    ...(freq ? { freq } : {}),
    ...(freq === 'minutes' && minuteInterval !== null
      ? { interval: minuteInterval }
      : {}),
    ...(time ? { time } : {}),
    ...(weekdays.length ? { weekdays } : {}),
    ...(dayOfMonth !== null ? { day: dayOfMonth } : {}),
    ...(minuteOfHour !== null ? { minute: minuteOfHour } : {}),
  };
}

/**
 * 按 scheduleConfig 计算下一次执行时刻（时区 Asia/Shanghai）。
 * freq=minutes: 下一个「整 N 分钟」边界；freq=hourly: 下一个整点 + minute 分钟；
 * freq=daily: 明天 time；freq=weekly: 下一个匹配的 weekday；freq=monthly: 下一个匹配的 day。
 * 错过周期不补跑，直接推到未来。
 */
export function computeNextOccurrence(
  config: Record<string, unknown>,
  from: Date,
): Date | null {
  const freq = text(config.freq).trim();
  if (!freq) return null;
  const tz = 'Asia/Shanghai';
  const base = new Date(from.toLocaleString('en-US', { timeZone: tz }));
  const time = text(config.time).trim();
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr) || 0;
  const minute = Number(minuteStr) || 0;
  if (freq === 'minutes') {
    const interval = Number(config.interval);
    if (
      !Number.isInteger(interval) ||
      !(RECUR_MINUTE_INTERVALS as readonly number[]).includes(interval)
    ) {
      return null;
    }
    const next = new Date(base);
    next.setSeconds(0, 0);
    next.setMinutes(
      Math.floor(next.getMinutes() / interval) * interval + interval,
    );
    return next;
  }
  if (freq === 'hourly') {
    const m = Number(config.minute) || 0;
    const next = new Date(base);
    next.setHours(next.getHours() + 1, m, 0, 0);
    return next;
  }
  if (freq === 'daily') {
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    next.setHours(hour, minute, 0, 0);
    return next;
  }
  if (freq === 'weekly') {
    const weekdays = Array.isArray(config.weekdays)
      ? config.weekdays.map((item) => Number(item))
      : [];
    const matched = weekdays.filter((item) => Number.isInteger(item));
    if (!matched.length) return null;
    const currentDay = base.getDay() || 7;
    let daysAhead = 8;
    for (const wd of matched) {
      let diff = wd - currentDay;
      if (diff <= 0) diff += 7;
      if (diff < daysAhead) daysAhead = diff;
    }
    const next = new Date(base);
    next.setDate(next.getDate() + daysAhead);
    next.setHours(hour, minute, 0, 0);
    return next;
  }
  if (freq === 'monthly') {
    const day = Number(config.day);
    if (!day || day < 1 || day > 31) return null;
    const next = new Date(base);
    next.setMonth(next.getMonth() + 1, day);
    next.setHours(hour, minute, 0, 0);
    return next;
  }
  return null;
}

/** 执行时刻文本 → Date：解析不出来返回 null，由调用方决定报错还是当成「没填」。 */
export function parseScheduleDate(raw: unknown): Date | null {
  const value = text(raw).trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function scheduleConfigOf(value: unknown): Record<string, unknown> {
  return isObject(value) ? (value as Record<string, unknown>) : {};
}

/** 可选整数：没填（含 null / 空串）返回 null，填了原样交给范围校验判定。 */
function optionalNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return Number(raw);
}

function isObject(value: unknown) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
