const express = require("express");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const { authenticate, authorize } = require("../middleware/auth");
const AssetCode = require("../models/AssetCode");
const Purchase = require("../models/Purchase");
const Maintenance = require("../models/Maintenance");
const Consumable = require("../models/Consumable");
const Department = require("../models/Department");
const Category = require("../models/Category");
const Vendor = require("../models/Vendor");
const Equipment = require("../models/Equipment");
const Location = require("../models/Location");

const csvCell = (value) => {
  let text = value == null ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const rowsToCsv = (headers, rows) => [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

const datasets = {
  "asset-codes": async () => {
    const rows = await AssetCode.find().populate("equipment", "name").populate("location", "name").populate("department", "code").sort({ code: 1 }).lean();
    return [["Asset Code", "Equipment", "Location", "Department", "Status", "Purchase Date", "Unit Cost", "Serial Number", "Remarks"], rows.map((item) => [item.code, item.equipment?.name, item.location?.name, item.department?.code, item.status, item.purchaseDate, item.unitCost, item.serialNo, item.remarks])];
  },
  purchases: async () => {
    const records = await Purchase.find().populate("vendor", "companyName").populate("items.equipment", "name").sort({ purchaseDate: -1 }).lean();
    return [["Purchase Date", "Invoice", "Vendor", "Equipment", "Specification", "Quantity", "Unit Cost", "GST %", "Grand Total", "Notes"], records.flatMap((purchase) => purchase.items.map((line) => [purchase.purchaseDate, purchase.invoiceNumber, purchase.vendor?.companyName, line.equipment?.name, line.specification, line.qty, line.unitCost, line.gstPercent, purchase.grandTotal, purchase.notes]))];
  },
  maintenance: async () => {
    const rows = await Maintenance.find().populate({ path: "assetCode", select: "code equipment", populate: { path: "equipment", select: "name" } }).sort({ date: -1 }).lean();
    return [["Date", "Asset Code", "Equipment", "Issue", "Engineer", "Cost", "Status", "Notes"], rows.map((item) => [item.date, item.assetCode?.code, item.assetCode?.equipment?.name, item.issue, item.serviceEngineer, item.cost, item.status, item.notes])];
  },
  consumables: async () => {
    const rows = await Consumable.find().populate("equipment", "name").populate("assetCode", "code").sort({ installedDate: -1 }).lean();
    return [["Installed Date", "Equipment", "Asset Code", "Model", "Cost", "Status"], rows.map((item) => [item.installedDate, item.equipment?.name, item.assetCode?.code, item.modelName, item.cost, item.status])];
  },
  departments: async () => {
    const rows = await Department.find().sort({ code: 1 }).lean();
    return [["Code", "Description", "Head of Department"], rows.map((item) => [item.code, item.description, item.headOfDept])];
  },
  categories: async () => {
    const rows = await Category.find().populate("discipline", "name").sort({ name: 1 }).lean();
    return [["Category", "Discipline", "Description"], rows.map((item) => [item.name, item.discipline?.name, item.description])];
  },
  vendors: async () => {
    const rows = await Vendor.find().sort({ companyName: 1 }).lean();
    return [["Company", "Contact", "Email", "Phone", "Address", "City", "State", "Pincode", "GST Number", "Active"], rows.map((item) => [item.companyName, item.contactPerson, item.email, item.phone, item.address, item.city, item.state, item.pincode, item.gstNumber, item.active !== false ? "Yes" : "No"])];
  },
  equipment: async () => {
    const rows = await Equipment.find().populate("category", "name").sort({ name: 1 }).lean();
    return [["Equipment", "Specification", "Category", "Consumable", "Code Prefix", "Low Stock Threshold"], rows.map((item) => [item.name, item.specification, item.category?.name, item.isConsumable ? "Yes" : "No", item.codePrefix, item.lowStockThreshold])];
  },
  locations: async () => {
    const rows = await Location.find().populate("department", "code").sort({ name: 1 }).lean();
    return [["Location", "Type", "Department", "Area/Floor", "Central Store", "Scrap Store"], rows.map((item) => [item.name, item.type, item.department?.code, item.areaFloor, item.isCentralStore ? "Yes" : "No", item.isScrapStore ? "Yes" : "No"])];
  },
};

router.get("/api/export/:dataset.csv", authenticate, authorize("Administrator", "Store Manager"), async (req, res) => {
  const exportDataset = datasets[req.params.dataset];
  if (!exportDataset) return res.status(404).json({ error: "Unknown export dataset." });
  const [headers, rows] = await exportDataset();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="stock-${req.params.dataset}.csv"`);
  res.send(`\uFEFF${rowsToCsv(headers, rows)}`);
});

module.exports = router;
