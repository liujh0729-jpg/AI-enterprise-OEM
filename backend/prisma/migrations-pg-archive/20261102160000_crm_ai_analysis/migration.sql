-- CRM AI 商机分析：设置里的「分析指引」由负责人撰写，分析时注入模型作为判定标准。
ALTER TABLE "crm_settings" ADD COLUMN "ai_analysis_guide" TEXT NOT NULL DEFAULT '';
