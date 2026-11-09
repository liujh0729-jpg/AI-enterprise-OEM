"use client";

import { Table } from "antd";
import { useMemo } from "react";
import { z } from "@enterprise/contracts";

export type ChartColumn = { key: string; label: string; type: string };

const chartConfigSchema = z
  .object({
    type: z.string().optional().catch(undefined),
    dimensions: z.array(z.string()).optional().catch(undefined),
    measures: z
      .array(
        z.object({
          key: z.string(),
          aggregate: z.string().optional(),
          alias: z.string().optional(),
        }),
      )
      .optional()
      .catch(undefined),
  })
  .catchall(z.unknown());

export type ChartConfig = z.output<typeof chartConfigSchema>;

/**
 * 契约里图表配置是自由 JSON（z.record），渲染侧只认 dimensions/measures。
 * 在此一处收窄：单个字段写坏时只丢该字段，不让整份配置失效或让渲染抛错。
 */
export function parseChartConfig(value: unknown): ChartConfig {
  const parsed = chartConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const COLORS = ["#3370ff", "#14c9c9", "#ff7d00", "#f53f3f", "#722ed1", "#00b42a", "#86909c", "#eb0aa4"];

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function fmt(value: unknown) {
  if (typeof value === "number") {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  return String(value ?? "");
}

export function ChartRenderer({
  type = "TABLE",
  columns,
  rows,
  config,
  height = 280,
}: {
  type?: string;
  columns: ChartColumn[];
  rows: Record<string, unknown>[];
  config?: ChartConfig;
  height?: number;
}) {
  const dims = useMemo(() => {
    const configured = (config?.dimensions || []).filter(Boolean);
    if (configured.length) return configured;
    return columns.filter((item) => item.type === "text").slice(0, 1).map((item) => item.key);
  }, [config, columns]);
  const measures = useMemo(() => {
    const configured = (config?.measures || []).map((item) => item.key).filter(Boolean);
    if (configured.length) return configured;
    return columns.filter((item) => item.type === "number").slice(0, 3).map((item) => item.key);
  }, [config, columns]);

  if (type === "TABLE" || !rows.length) {
    return (
      <Table
        rowKey={(row, index) => String(row.id ?? index)}
        size="small"
        dataSource={rows}
        pagination={rows.length > 20 ? { pageSize: 20 } : false}
        columns={columns.map((item) => ({ title: item.label, dataIndex: item.key, ellipsis: true }))}
      />
    );
  }

  if (type === "METRIC") {
    const key = measures[0];
    const value = key ? rows[0]?.[key] : rows.length;
    return (
      <div className="bi-metric">
        <div className="bi-metric-value">{fmt(value)}</div>
        <div className="muted">{key || "行数"}</div>
      </div>
    );
  }

  const dimKey = dims[0] || columns[0]?.key || "";
  const measureKey = measures[0] || columns.find((item) => item.type === "number")?.key || "";
  const labels = rows.map((row) => fmt(row[dimKey]));
  const values = rows.map((row) => num(row[measureKey]));
  const max = Math.max(...values, 1);

  if (type === "BAR" || type === "FUNNEL") {
    return (
      <div className="bi-bars" style={{ height }}>
        {rows.slice(0, 30).map((row, index) => {
          const value = values[index];
          const width = type === "FUNNEL" ? 100 - (index / Math.max(rows.length, 1)) * 60 : (value / max) * 100;
          return (
            <div className="bi-bar-row" key={String(row[dimKey] ?? index)}>
              <span className="bi-bar-label">{labels[index]}</span>
              <span className="bi-bar-track">
                <span
                  className="bi-bar-fill"
                  style={{ width: `${Math.max(2, width)}%`, background: COLORS[index % COLORS.length] }}
                />
              </span>
              <span className="bi-bar-value">{fmt(value)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === "PIE" || type === "DONUT") {
    const total = values.reduce((sum, item) => sum + Math.max(item, 0), 0) || 1;
    const radius = Math.min(height, 320) / 2 - 10;
    const center = radius + 10;
    const slices = rows.slice(0, 12).map((row, index) => {
      const before = values
        .slice(0, index)
        .reduce((sum, item) => sum + Math.max(item, 0), 0);
      const value = Math.max(values[index], 0);
      const start = -Math.PI / 2 + (before / total) * Math.PI * 2;
      const end = start + (value / total) * Math.PI * 2;
      return { key: String(row[dimKey] ?? index), index, slice: end - start, start, end };
    });
    return (
      <svg width={radius * 2 + 20} height={radius * 2 + 20} role="img" aria-label="饼图">
        {slices.map(({ key, index, slice, start, end }) => {
          const x1 = center + radius * Math.cos(start);
          const y1 = center + radius * Math.sin(start);
          const x2 = center + radius * Math.cos(end);
          const y2 = center + radius * Math.sin(end);
          const large = slice > Math.PI ? 1 : 0;
          const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
          return <path key={key} d={path} fill={COLORS[index % COLORS.length]} stroke="#fff" strokeWidth={1} />;
        })}
        {type === "DONUT" ? <circle cx={center} cy={center} r={radius * 0.55} fill="#fff" /> : null}
      </svg>
    );
  }

  if (type === "SCATTER") {
    const width = 560;
    const second = measures[1];
    const ys = second ? rows.map((row) => num(row[second])) : values;
    const maxY = Math.max(...ys, 1);
    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="散点图">
        <line x1={40} y1={height - 30} x2={width - 10} y2={height - 30} stroke="#e5e6eb" />
        <line x1={40} y1={10} x2={40} y2={height - 30} stroke="#e5e6eb" />
        {rows.slice(0, 200).map((row, index) => (
          <circle
            key={index}
            cx={40 + (values[index] / max) * (width - 60)}
            cy={height - 30 - (ys[index] / maxY) * (height - 50)}
            r={5}
            fill={COLORS[index % COLORS.length]}
            opacity={0.75}
          />
        ))}
      </svg>
    );
  }

  // LINE / AREA
  const width = 640;
  const points = values.map((value, index) => {
    const x = rows.length === 1 ? width / 2 : 40 + (index / (rows.length - 1)) * (width - 60);
    const y = height - 30 - (value / max) * (height - 50);
    return `${x},${y}`;
  });
  const areaPoints = [`40,${height - 30}`, ...points, `${width - 20},${height - 30}`].join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="折线图">
      <line x1={40} y1={height - 30} x2={width - 20} y2={height - 30} stroke="#e5e6eb" />
      <line x1={40} y1={10} x2={40} y2={height - 30} stroke="#e5e6eb" />
      {type === "AREA" ? <polygon points={areaPoints} fill="#3370ff22" /> : null}
      <polyline points={points.join(" ")} fill="none" stroke="#3370ff" strokeWidth={2} />
      {points.map((point, index) => {
        const [x, y] = point.split(",");
        return <circle key={index} cx={x} cy={y} r={3} fill="#3370ff" />;
      })}
      {labels.map((label, index) => {
        if (labels.length > 10 && index % Math.ceil(labels.length / 10) !== 0) return null;
        const x = rows.length === 1 ? width / 2 : 40 + (index / (rows.length - 1)) * (width - 60);
        return (
          <text key={index} x={x} y={height - 8} fontSize={10} fill="#86909c" textAnchor="middle">
            {label.slice(0, 8)}
          </text>
        );
      })}
    </svg>
  );
}