"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "antd";
import { CanvasEditor } from "../_components/canvas-editor";

/** 画布编辑器独立页：从「我的画布」卡片进入，整屏编排。 */
export default function CanvasEditorPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div style={{ padding: 24 }}>
        <p>画布编号无效。</p>
        <Link href="/content/canvas">
          <Button>返回我的画布</Button>
        </Link>
      </div>
    );
  }
  return <CanvasEditor id={id} />;
}
