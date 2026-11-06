-- 多平台内容分发：正文改存「受限 HTML」（富文本编辑器产出，样式随内容投递到支持样式的文章渠道）。
-- TEXT 上限 65535 字节，而中文 3 字节/字 + 样式标记会显著放大体积，故升到 MEDIUMTEXT（16MB）。
-- 列类型放宽不影响既有纯文本数据：老台账按纯文本通道继续投递。

-- AlterTable: distribution_contents.content TEXT -> MEDIUMTEXT
ALTER TABLE `distribution_contents` MODIFY COLUMN `content` MEDIUMTEXT NOT NULL;
