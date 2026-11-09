import type { CurrentUser } from '../auth/current-user';
import type { ErpService } from './erp.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

/** §5.4 ERP 控制器：方法名与契约 `Erp_*` 后缀一一对应。 */
export class ErpController {
  constructor(private readonly service: ErpService) {}

  overview(user: CurrentUser) {
    return this.service.overview(user);
  }

  listCategories(user: CurrentUser) {
    return this.service.listCategories(user);
  }

  saveCategory(user: CurrentUser, body: Row) {
    return this.service.saveCategory(user, body);
  }

  removeCategory(user: CurrentUser, body: Row) {
    return this.service.removeCategory(user, body);
  }

  listProducts(
    user: CurrentUser,
    query: PageQuery & { q?: string; categoryId?: number; status?: string },
  ) {
    return this.service.listProducts(user, query);
  }

  saveProduct(user: CurrentUser, body: Row) {
    return this.service.saveProduct(user, body);
  }

  removeProduct(user: CurrentUser, body: Row) {
    return this.service.removeProduct(user, body);
  }

  listVariants(user: CurrentUser, query: { productId?: number; q?: string }) {
    return this.service.listVariants(user, query);
  }

  saveVariant(user: CurrentUser, body: Row) {
    return this.service.saveVariant(user, body);
  }

  removeVariant(user: CurrentUser, body: Row) {
    return this.service.removeVariant(user, body);
  }

  listWarehouses(user: CurrentUser) {
    return this.service.listWarehouses(user);
  }

  saveWarehouse(user: CurrentUser, body: Row) {
    return this.service.saveWarehouse(user, body);
  }

  removeWarehouse(user: CurrentUser, body: Row) {
    return this.service.removeWarehouse(user, body);
  }

  listStock(
    user: CurrentUser,
    query: PageQuery & { warehouseId?: number; q?: string; lowOnly?: boolean },
  ) {
    return this.service.listStock(user, query);
  }

  stockAlerts(user: CurrentUser) {
    return this.service.stockAlerts(user);
  }

  listMoves(
    user: CurrentUser,
    query: PageQuery & {
      warehouseId?: number;
      type?: string;
      variantId?: number;
    },
  ) {
    return this.service.listMoves(user, query);
  }

  saveMove(user: CurrentUser, body: Row) {
    return this.service.saveMove(user, body);
  }

  listStockRequests(user: CurrentUser, query: PageQuery & { status?: string }) {
    return this.service.listStockRequests(user, query);
  }

  saveStockRequest(user: CurrentUser, body: Row) {
    return this.service.saveStockRequest(user, body);
  }

  decideStockRequest(user: CurrentUser, body: Row) {
    return this.service.decideStockRequest(user, body);
  }

  listVendors(user: CurrentUser, query: PageQuery & { q?: string }) {
    return this.service.listVendors(user, query);
  }

  saveVendor(user: CurrentUser, body: Row) {
    return this.service.saveVendor(user, body);
  }

  removeVendor(user: CurrentUser, body: Row) {
    return this.service.removeVendor(user, body);
  }

  listPurchaseOrders(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    return this.service.listPurchaseOrders(user, query);
  }

  savePurchaseOrder(user: CurrentUser, body: Row) {
    return this.service.savePurchaseOrder(user, body);
  }

  decidePurchaseOrder(user: CurrentUser, body: Row) {
    return this.service.decidePurchaseOrder(user, body);
  }

  listReceipts(user: CurrentUser, query: PageQuery & { status?: string }) {
    return this.service.listReceipts(user, query);
  }

  createReceipt(user: CurrentUser, body: Row) {
    return this.service.createReceipt(user, body);
  }

  decideReceipt(user: CurrentUser, body: Row) {
    return this.service.decideReceipt(user, body);
  }

  listReceivables(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    return this.service.listReceivables(user, query);
  }

  saveReceivable(user: CurrentUser, body: Row) {
    return this.service.saveReceivable(user, body);
  }

  receivePayment(user: CurrentUser, body: Row) {
    return this.service.receivePayment(user, body);
  }

  listPayables(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    return this.service.listPayables(user, query);
  }

  savePayable(user: CurrentUser, body: Row) {
    return this.service.savePayable(user, body);
  }

  payPayable(user: CurrentUser, body: Row) {
    return this.service.payPayable(user, body);
  }

  listExpenses(user: CurrentUser, query: PageQuery & { status?: string }) {
    return this.service.listExpenses(user, query);
  }

  saveExpense(user: CurrentUser, body: Row) {
    return this.service.saveExpense(user, body);
  }

  decideExpense(user: CurrentUser, body: Row) {
    return this.service.decideExpense(user, body);
  }

  listTaxRates(user: CurrentUser) {
    return this.service.listTaxRates(user);
  }

  saveTaxRate(user: CurrentUser, body: Row) {
    return this.service.saveTaxRate(user, body);
  }

  removeTaxRate(user: CurrentUser, body: Row) {
    return this.service.removeTaxRate(user, body);
  }

  listPricePolicies(user: CurrentUser) {
    return this.service.listPricePolicies(user);
  }

  savePricePolicy(user: CurrentUser, body: Row) {
    return this.service.savePricePolicy(user, body);
  }

  removePricePolicy(user: CurrentUser, body: Row) {
    return this.service.removePricePolicy(user, body);
  }

  aiInsight(user: CurrentUser, body: Row) {
    return this.service.aiInsight(user, body);
  }
}
