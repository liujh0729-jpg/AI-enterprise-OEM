export function validateInvoiceImage(file: File) {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error("发票图片仅支持 JPG / PNG / WebP 格式，请转换后重试");
  }
  if (!file.size) throw new Error("发票图片内容为空，请重新选择");
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("发票原图超过 10MB，请压缩后重试");
  }
}

/** 压缩到长边 1600 / JPEG 0.85，并确认结果能被后端接收。 */
export async function compressInvoiceImage(file: File) {
  validateInvoiceImage(file);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取发票图片失败，请重新选择"));
    reader.onabort = () => reject(new Error("读取发票图片已取消，请重新选择"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败，请确认图片未损坏"));
    img.src = dataUrl;
  });
  if (!image.width || !image.height) throw new Error("发票图片尺寸无效");
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法处理图片，请更换浏览器后重试");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = jpeg.startsWith("data:image/jpeg;base64,") ? jpeg.split(",")[1] : "";
  if (!base64) throw new Error("发票图片压缩失败，请重新选择");
  // 保守估算解码大小；正常的 1600px JPEG 远小于此限制。
  if (Math.ceil(base64.length / 4) * 3 > 8 * 1024 * 1024) {
    throw new Error("压缩后的发票图片超过 8MB，请缩小原图后重试");
  }
  return { base64, mime: "image/jpeg" };
}
