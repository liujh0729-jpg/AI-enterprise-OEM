"use client";

import { Button, Form, Input, InputNumber, Space } from "antd";

/**
 * 项目明细（逐条添加）：开票申请与自动开票共用一套录入，
 * 字段对齐企享云 xmmx（商品编码 / 名称 / 规格 / 数量 / 单价 / 税率），
 * 金额与税额由「数量 × 单价 × 税率」自动计算。
 */
export function InvoiceItemsEditor() {
  return (
    <Form.List name="items">
      {(fields, { add, remove }) => (
        <div>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            项目明细（逐条添加）
          </div>
          {fields.map((field) => (
            <Space key={field.key} wrap align="start" style={{ marginBottom: 6 }}>
              <Form.Item name={[field.name, "goodsCode"]} style={{ marginBottom: 0 }}>
                <Input style={{ width: 130 }} placeholder="商品编码" />
              </Form.Item>
              <Form.Item
                name={[field.name, "goodsName"]}
                rules={[{ required: true, message: "请填写名称" }]}
                style={{ marginBottom: 0 }}
              >
                <Input style={{ width: 190 }} placeholder="货物或服务名称" />
              </Form.Item>
              <Form.Item name={[field.name, "spec"]} style={{ marginBottom: 0 }}>
                <Input style={{ width: 110 }} placeholder="规格型号" />
              </Form.Item>
              <Form.Item name={[field.name, "quantity"]} style={{ marginBottom: 0 }}>
                <InputNumber style={{ width: 90 }} placeholder="数量" min={0} />
              </Form.Item>
              <Form.Item name={[field.name, "price"]} style={{ marginBottom: 0 }}>
                <InputNumber style={{ width: 110 }} placeholder="单价" min={0} precision={2} />
              </Form.Item>
              <Form.Item name={[field.name, "taxRate"]} style={{ marginBottom: 0 }}>
                <Input style={{ width: 90 }} placeholder="税率(%)" />
              </Form.Item>
              <Button
                danger
                type="text"
                disabled={fields.length <= 1}
                onClick={() => remove(field.name)}
              >
                删除
              </Button>
            </Space>
          ))}
          <Button onClick={() => add({ quantity: 1, taxRate: "6" })}>
            ＋ 添加明细
          </Button>
        </div>
      )}
    </Form.List>
  );
}
