-- Sparse enterprise/staff pages and tax-plan filters; rehearsed with EXPLAIN ANALYZE in an owned local database.
CREATE INDEX "marketing_orders_enterprise_id_id_idx" ON "marketing_orders" ("enterprise_id", "id");
CREATE INDEX "marketing_orders_staff_user_id_id_idx" ON "marketing_orders" ("staff_user_id", "id");
CREATE INDEX "logistics_orders_enterprise_id_id_idx" ON "logistics_orders" ("enterprise_id", "id");
CREATE INDEX "logistics_orders_staff_user_id_id_idx" ON "logistics_orders" ("staff_user_id", "id");
CREATE INDEX "smart_service_orders_enterprise_id_id_idx" ON "smart_service_orders" ("enterprise_id", "id");
CREATE INDEX "smart_service_orders_staff_user_id_id_idx" ON "smart_service_orders" ("staff_user_id", "id");
CREATE INDEX "asset_requests_enterprise_id_id_idx" ON "asset_requests" ("enterprise_id", "id");
CREATE INDEX "asset_requests_staff_user_id_id_idx" ON "asset_requests" ("staff_user_id", "id");
CREATE INDEX "tax_plans_provider_user_id_period_id_idx" ON "tax_plans" ("provider_user_id", "period", "id");
CREATE INDEX "tax_plans_staff_user_id_period_id_idx" ON "tax_plans" ("staff_user_id", "period", "id");
CREATE INDEX "tax_plans_account_set_id_period_id_idx" ON "tax_plans" ("account_set_id", "period", "id");
