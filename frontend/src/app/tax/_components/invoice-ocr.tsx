"use client";

import { CameraOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { App, Button, Modal, Upload } from "antd";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { taxApi } from '@/api/tax';
import { aiApi, type AiInvoiceExtract } from '@/api/ai';
import { AiList, AiModeTag } from '@/components/ai-result';
import { useBusinessMutation, useBusinessQuery } from '@/query/business';
import { compressInvoiceImage, validateInvoiceImage } from "@/lib/invoice-image";
import type { EditorRow } from "@/components/row-list-editor";

type OcrResult = NonNullable<Awaited<ReturnType<typeof taxApi.ocrInvoice>>>;

/**
 * 发票 OCR：企业上传发票的第二种录入方式（第一种是逐条手工录入）。
 * 识别结果不直接入库，而是预填「＋ 添加发票」的单条表单，人工核对后再保存。
 */
export function InvoiceOcrButton({
  packId,
  onRecognized,
}: {
  packId: number;
  onRecognized: (row: EditorRow) => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  /** 带材料包查询通道状态：后端按该包所属企业的税号取企享云账号凭据。 */
  const statusQuery = useBusinessQuery(
    'tax',
    'ocr-status',
    { packId },
    (signal) => taxApi.ocrStatus({ query: { packId } }, { signal }),
    'all',
    open,
  );
  const status = statusQuery.data;
  const statusLoading = statusQuery.isPending;
  const statusError = statusQuery.error?.message;
  const recognition = useBusinessMutation((body:{image_base64:string;mime:string}) => taxApi.ocrInvoice({params:{id:String(packId)},body}), []);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [aiCheck, setAiCheck] = useState<AiInvoiceExtract | null>(null);
  const [aiChecking, setAiChecking] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const closeModal = () => {
    if (busy) return;
    setOpen(false);
    setFile(null);
    setPreview("");
    setResult(null);
    setAiCheck(null);
  };

  const openModal = () => {
    setOpen(true);
    setResult(null);
    setAiCheck(null);
  };

  const pick = (next: File) => {
    if (busy) return;
    try {
      validateInvoiceImage(next);
      setFile(next);
      setResult(null);
      setAiCheck(null);
      setPreview(URL.createObjectURL(next));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法选择发票图片");
    }
  };

  const recognize = async () => {
    if (busy || !status?.configured) return;
    if (!file) {
      message.warning("请先选择发票图片（拍照或截图）");
      return;
    }
    setResult(null);
    setAiCheck(null);
    setBusy(true);
    try {
      const image = await compressInvoiceImage(file).catch(error => {
        message.error(error instanceof Error ? error.message : '图片处理失败');
        return null;
      });
      if (!image) return;
      const data = await recognition.mutateAsync({ image_base64: image.base64, mime: image.mime }).catch(() => null);
      if (!data) return;
      setResult(data);
      if (!data.invoiceNo) {
        message.warning("未识别到发票号码，请核对图片清晰度或改用手工录入");
      }
    } finally {
      setBusy(false);
    }
  };

  const runAiCheck = async () => {
    if (!result || aiChecking) return;
    const text = [
      `发票号码：${result.invoiceNo || ""}`,
      `开票日期：${result.date || ""}`,
      `购销方：${result.counterparty || ""}`,
      `金额：${result.amount ?? ""}`,
      `税额：${result.tax ?? ""}`,
      `票种：${result.kind || ""}`,
    ].join("\n");
    setAiChecking(true);
    setAiCheck(null);
    try {
      setAiCheck(await aiApi.invoiceExtract({ body: { text } }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "AI 发票校验失败");
    } finally {
      setAiChecking(false);
    }
  };

  const useResult = () => {
    if (!result) return;
    onRecognized({
      kind: result.kind || "进项",
      invoiceNo: result.invoiceNo,
      counterparty: result.counterparty,
      amount: result.amount,
      tax: result.tax,
      date: result.date,
    });
    setOpen(false);
    setFile(null);
    setPreview("");
    setResult(null);
    setAiCheck(null);
    message.success("已按识别结果预填，请核对后点击「添加」保存该条");
  };

  return (
    <>
      <Button onClick={() => void openModal()}>
        <CameraOutlined aria-hidden /> 上传发票识别
      </Button>
      <Modal
        open={open}
        title="发票识别（企享云 OCR）"
        width={560}
        okText="用识别结果填单"
        cancelText="取消"
        okButtonProps={{ disabled: !result || busy }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
        confirmLoading={busy}
        onOk={useResult}
        onCancel={closeModal}
      >
        {statusLoading ? (
          <div className="text-12 muted">正在检查发票识别服务状态…</div>
        ) : statusError ? (
          <Notice variant="warn">
            <div>{statusError}</div>
            <Button onClick={() => void statusQuery.refetch()}>重新检查</Button>
          </Notice>
        ) : !status?.configured ? (
          <Notice variant="warn">
            <div style={{ fontWeight: 600 }}>发票 OCR 尚未配置凭据</div>
            <div className="text-12" style={{ marginTop: 4 }}>
              {status?.hint || "请联系管理员配置企享云凭据并开通发票 OCR 权限；当前可使用手工录入。"}
            </div>
          </Notice>
        ) : (
          <>
            <div className="text-12 muted" style={{ marginBottom: 10 }}>
              上传增值税发票照片/截图 → 自动识别票号、开票日期、购销方、金额与税额 →
              预填「＋ 添加发票」表单，人工核对后逐条保存（识别结果不会直接入库）。支持 JPG / PNG / WebP，原图不超过 10MB。
            </div>
            <Upload
              accept=".jpg,.jpeg,.png,.webp"
              disabled={busy}
              listType="picture-card"
              showUploadList={false}
              beforeUpload={(next) => {
                pick(next);
                return false;
              }}
            >
              {preview ? (
                <RawImg
                  src={preview}
                  alt="发票"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div>
                  <div style={{ fontSize: 22 }}>＋</div>
                  <div className="text-12">选择发票图片</div>
                </div>
              )}
            </Upload>
            {result ? (
              <>
                <div className="ext-meta" style={{ marginTop: 12 }}>
                  <span>
                    发票号码 <b className="mono">{result.invoiceNo || "—"}</b>
                  </span>
                  <span>
                    开票日期 <b>{result.date || "—"}</b>
                  </span>
                  <span>
                    销方/购方 <b>{result.counterparty || "—"}</b>
                  </span>
                  <span>
                    金额 <b>{result.amount || 0}</b> · 税额 <b>{result.tax || 0}</b>
                  </span>
                  <span>
                    判定 <b>{result.kind || "待人工选择"}</b>
                  </span>
                  <span>
                    通道 <b>企享云 OCR</b>
                  </span>
                </div>
                {aiCheck ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <b>AI 发票校验</b>
                      <AiModeTag mode={aiCheck.mode} model={aiCheck.model} />
                    </div>
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      发票号码 {aiCheck.values.invoiceNo || "—"} · 开票日期{" "}
                      {aiCheck.values.invoiceDate || "—"} · 价税合计{" "}
                      {aiCheck.values.total || "—"}
                    </div>
                    {aiCheck.warnings.length ? (
                      <AiList title="需要核对" items={aiCheck.warnings} empty="未发现不一致" />
                    ) : (
                      <div className="text-12 muted" style={{ marginTop: 4 }}>
                        未发现金额/税额不一致。
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <Button
                type="primary"
                loading={busy}
                disabled={!file}
                onClick={() => void recognize()}
              >
                <PlayCircleOutlined aria-hidden /> 开始识别
              </Button>
              {result ? (
                <Button loading={aiChecking} onClick={() => void runAiCheck()}>
                  AI 发票校验
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
