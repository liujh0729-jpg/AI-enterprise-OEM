-- 组织职能目录（部门 / 岗位）+ 服务商职员的职能落列
-- 用途：职员/代理人管理「职能管理」页签维护目录并赋给成员；OA 流程可按「部门 + 岗位」选签批人。
CREATE TABLE "org_departments" (
  "id" SERIAL NOT NULL,
  "org_type" VARCHAR(16) NOT NULL,
  "org_user_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "description" VARCHAR(500) NOT NULL DEFAULT '',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "org_departments_org_type_org_user_id_name_key" ON "org_departments"("org_type","org_user_id","name");
CREATE INDEX "org_departments_org_type_org_user_id_idx" ON "org_departments"("org_type","org_user_id");

CREATE TABLE "org_positions" (
  "id" SERIAL NOT NULL,
  "org_type" VARCHAR(16) NOT NULL,
  "org_user_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "description" VARCHAR(500) NOT NULL DEFAULT '',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_positions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "org_positions_org_type_org_user_id_name_key" ON "org_positions"("org_type","org_user_id","name");
CREATE INDEX "org_positions_org_type_org_user_id_idx" ON "org_positions"("org_type","org_user_id");

ALTER TABLE "provider_staff" ADD COLUMN "department" VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE "provider_staff" ADD COLUMN "positions" JSONB NOT NULL DEFAULT '[]';