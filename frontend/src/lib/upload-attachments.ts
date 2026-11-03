import type { EndpointResponse } from '@enterprise/contracts';

type UploadResult=NonNullable<EndpointResponse<'Identity_upload'>['data']>;
type UploadedAttachment=UploadResult['files'][number];
type UploadBody={files:{name:string;size:number;contentType:string;contentBase64:string}[]};

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const EXTENSIONS = /\.(jpe?g|png|pdf|docx?|xlsx?)$/i;

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error(`读取「${file.name}」失败`));
    reader.onabort = () => reject(new Error(`读取「${file.name}」已取消`));
    reader.readAsDataURL(file);
  });
}

/** 逐个请求，避免多文件 Base64 超过代理或后端容量；立即保留每次成功的结果。 */
export async function uploadAttachments(
  upload:(input:{body:UploadBody})=>Promise<{files:UploadedAttachment[]}|null>,
  files: File[],
  onUploaded: (files: UploadedAttachment[]) => void,
) {
  for (const file of files) {
    if (!EXTENSIONS.test(file.name)) {
      throw new Error(
        `「${file.name}」仅支持 jpg / jpeg / png / pdf / doc / docx / xls / xlsx 格式`,
      );
    }
    if (!file.size) throw new Error(`「${file.name}」文件内容为空`);
    if (file.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(`「${file.name}」超过 10MB，请压缩后重试`);
    }
  }
  let uploaded = 0;
  for (const file of files) {
    try {
      const result = await upload({body:{
        files: [
          {
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
            contentBase64: await readBase64(file),
          },
        ],
      }});
      if (!Array.isArray(result?.files) || result.files.length !== 1) {
        throw new Error("文件上传结果异常，请重试");
      }
      onUploaded(result.files);
      uploaded += result.files.length;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "文件上传失败";
      throw new Error(
        `「${file.name}」上传失败：${reason}${uploaded ? `；已保留 ${uploaded} 个成功上传的文件` : ""}`,
      );
    }
  }
  return uploaded;
}
