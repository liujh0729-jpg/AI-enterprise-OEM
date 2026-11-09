import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const erpApi = {
  overview: endpoint(endpoints.Erp_overview),

  categories: endpoint(endpoints.Erp_listCategories),
  saveCategory: endpoint(endpoints.Erp_saveCategory),
  removeCategory: endpoint(endpoints.Erp_removeCategory),

  products: endpoint(endpoints.Erp_listProducts),
  saveProduct: endpoint(endpoints.Erp_saveProduct),
  removeProduct: endpoint(endpoints.Erp_removeProduct),

  variants: endpoint(endpoints.Erp_listVariants),
  saveVariant: endpoint(endpoints.Erp_saveVariant),
  removeVariant: endpoint(endpoints.Erp_removeVariant),

  warehouses: endpoint(endpoints.Erp_listWarehouses),
  saveWarehouse: endpoint(endpoints.Erp_saveWarehouse),
  removeWarehouse: endpoint(endpoints.Erp_removeWarehouse),

  stock: endpoint(endpoints.Erp_listStock),
  stockAlerts: endpoint(endpoints.Erp_stockAlerts),
  moves: endpoint(endpoints.Erp_listMoves),
  saveMove: endpoint(endpoints.Erp_saveMove),

  stockRequests: endpoint(endpoints.Erp_listStockRequests),
  saveStockRequest: endpoint(endpoints.Erp_saveStockRequest),
  decideStockRequest: endpoint(endpoints.Erp_decideStockRequest),

  vendors: endpoint(endpoints.Erp_listVendors),
  saveVendor: endpoint(endpoints.Erp_saveVendor),
  removeVendor: endpoint(endpoints.Erp_removeVendor),

  purchaseOrders: endpoint(endpoints.Erp_listPurchaseOrders),
  savePurchaseOrder: endpoint(endpoints.Erp_savePurchaseOrder),
  decidePurchaseOrder: endpoint(endpoints.Erp_decidePurchaseOrder),
  receipts: endpoint(endpoints.Erp_listReceipts),
  createReceipt: endpoint(endpoints.Erp_createReceipt),
  decideReceipt: endpoint(endpoints.Erp_decideReceipt),

  receivables: endpoint(endpoints.Erp_listReceivables),
  saveReceivable: endpoint(endpoints.Erp_saveReceivable),
  receivePayment: endpoint(endpoints.Erp_receivePayment),

  payables: endpoint(endpoints.Erp_listPayables),
  savePayable: endpoint(endpoints.Erp_savePayable),
  payPayable: endpoint(endpoints.Erp_payPayable),

  expenses: endpoint(endpoints.Erp_listExpenses),
  saveExpense: endpoint(endpoints.Erp_saveExpense),
  decideExpense: endpoint(endpoints.Erp_decideExpense),

  taxRates: endpoint(endpoints.Erp_listTaxRates),
  saveTaxRate: endpoint(endpoints.Erp_saveTaxRate),
  removeTaxRate: endpoint(endpoints.Erp_removeTaxRate),

  pricePolicies: endpoint(endpoints.Erp_listPricePolicies),
  savePricePolicy: endpoint(endpoints.Erp_savePricePolicy),
  removePricePolicy: endpoint(endpoints.Erp_removePricePolicy),

  aiInsight: endpoint(endpoints.Erp_aiInsight),
};
