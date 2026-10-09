const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Purchase = require("../models/Purchase");
const Equipment = require("../models/Equipment");
const AssetCode = require("../models/AssetCode");
const Location = require("../models/Location");
const CompanyProfile = require("../models/CompanyProfile");
const AuditLog = require("../models/AuditLog");
const Maintenance = require("../models/Maintenance");
const StockMovement = require("../models/StockMovement");
const { authenticate, authorize } = require("../middleware/auth");
const { sendApiError } = require("../utils/apiErrors");
const { withMongoTransaction } = require("../utils/mongoTransaction");
const canEdit = authorize("Administrator", "Store Manager");

function validPurchaseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

router.get("/api/purchases", authenticate, async (req, res) => {
  const purchases = await Purchase.find()
    .populate("vendor", "companyName")
    .populate("items.equipment", "name")
    .sort({ purchaseDate: -1 });
  res.json(purchases);
});

router.post("/api/purchases", authenticate, canEdit, async (req, res) => {
  const { purchaseDate, invoiceNumber = "", vendor, items, notes = "" } = req.body;
  if (!validPurchaseDate(purchaseDate)) return res.status(400).json({ error: "Enter a valid purchase date." });
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return res.status(400).json({ error: "Add between 1 and 100 purchase lines." });
  if (vendor && !mongoose.isValidObjectId(vendor)) return res.status(400).json({ error: "Choose a valid vendor." });
  if (String(invoiceNumber).length > 100 || String(notes).length > 1000) return res.status(400).json({ error: "Invoice number or notes are too long." });

  const cleanItems = [];
  let units = 0;
  for (const item of items) {
    const qty = Number(item.qty);
    const unitCost = Number(item.unitCost);
    const gstPercent = Number(item.gstPercent ?? 18);
    if (!mongoose.isValidObjectId(item.equipment)) return res.status(400).json({ error: "Choose equipment on every purchase line." });
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) return res.status(400).json({ error: "Each purchase quantity must be a whole number from 1 to 500." });
    if (!Number.isFinite(unitCost) || unitCost < 0) return res.status(400).json({ error: "Unit cost must be zero or greater." });
    if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return res.status(400).json({ error: "GST must be between 0 and 100 percent." });
    units += qty;
    cleanItems.push({ equipment: item.equipment, specification: String(item.specification || "").trim().slice(0, 500), qty, unitCost, gstPercent });
  }
  if (units > 500) return res.status(400).json({ error: "A purchase may generate at most 500 asset codes at a time." });

  let result;
  try {
    await withMongoTransaction(async (session) => {
      const equipmentIds = [...new Set(cleanItems.map((item) => String(item.equipment)))];
      const equipmentRows = await Equipment.find({ _id: { $in: equipmentIds } }).session(session);
      if (equipmentRows.length !== equipmentIds.length) { const error = new Error("One or more equipment types no longer exist."); error.status = 409; throw error; }
      const vendorExists = vendor ? await require("../models/Vendor").exists({ _id: vendor }).session(session) : true;
      if (!vendorExists) { const error = new Error("Vendor not found."); error.status = 404; throw error; }
      let profile = await CompanyProfile.findOne().session(session);
      if (!profile) [profile] = await CompanyProfile.create([{}], { session });
      let storeRoom = await Location.findOne({ isCentralStore: true }).session(session);
      if (!storeRoom) [storeRoom] = await Location.create([{ name: "Store Room", type: "Store", isCentralStore: true }], { session });
      const date = new Date(`${purchaseDate}T00:00:00`);
      let taxableTotal = 0;
      let gstTotal = 0;
      for (const item of cleanItems) {
        const taxable = item.qty * item.unitCost;
        taxableTotal += taxable;
        gstTotal += taxable * item.gstPercent / 100;
      }
      const [purchase] = await Purchase.create([{
        purchaseDate: date, invoiceNumber: String(invoiceNumber).trim(), vendor: vendor || undefined,
        items: cleanItems, notes: String(notes).trim(), taxableTotal, gstTotal,
        grandTotal: taxableTotal + gstTotal, createdBy: req.user.email,
      }], { session });

      const equipmentById = new Map(equipmentRows.map((item) => [String(item._id), item]));
      const nextSerial = new Map();
      const codes = [];
      const monthYear = `${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
      const orgCode = String(profile.orgCode || "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{2,8}$/.test(orgCode)) { const error = new Error("Set a valid asset code prefix in Company Profile before recording a purchase."); error.status = 409; throw error; }
      for (const item of cleanItems) {
        const equipment = equipmentById.get(String(item.equipment));
        const prefix = String(equipment.codePrefix || equipment.name.slice(0, 4)).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8) || "ITEM";
        const base = `${orgCode}-${prefix}-${monthYear}-`;
        if (!nextSerial.has(base)) {
          const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const latest = await AssetCode.findOne({ code: new RegExp(`^${escaped}\\d+$`) }).sort({ code: -1 }).session(session);
          nextSerial.set(base, latest ? Number(latest.code.slice(base.length)) + 1 : 1);
        }
        for (let index = 0; index < item.qty; index += 1) {
          const serial = nextSerial.get(base);
          nextSerial.set(base, serial + 1);
          codes.push({
            code: `${base}${String(serial).padStart(3, "0")}`,
            equipment: item.equipment, purchase: purchase._id, location: storeRoom._id,
            status: "in_store", purchaseDate: date, unitCost: item.unitCost,
          });
        }
      }
      const createdCodes = await AssetCode.insertMany(codes, { session, ordered: true });
      await AuditLog.create([{
        action: "PURCHASE_RECORDED", entity: "Purchase", entityId: purchase._id,
        performedBy: req.user.email, details: `${createdCodes.length} units purchased, invoice ${purchase.invoiceNumber || "-"}`,
      }], { session });
      result = { purchase, assetCodes: createdCodes };
    });
    res.status(201).json(result);
  } catch (err) { sendApiError(res, err, "Could not save the purchase. Check the purchase and asset register before retrying."); }
});

router.delete("/api/purchases/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid purchase id." });
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) return res.status(404).json({ error: "Purchase not found." });
  const assets = await AssetCode.find({ purchase: purchase._id }).select("_id status");
  if (assets.some((asset) => asset.status !== "in_store")) return res.status(409).json({ error: "This purchase has assets that were moved or serviced. Its stock history must be retained." });
  const assetIds = assets.map((asset) => asset._id);
  const [maintenance, movements] = await Promise.all([
    Maintenance.exists({ assetCode: { $in: assetIds } }),
    StockMovement.exists({ "items.assetCode": { $in: assetIds } }),
  ]);
  if (maintenance || movements) return res.status(409).json({ error: "This purchase has linked maintenance or movement history and cannot be deleted." });

  try {
    await withMongoTransaction(async (session) => {
      await AssetCode.deleteMany({ purchase: purchase._id }, { session });
      await Purchase.findByIdAndDelete(purchase._id, { session });
      await AuditLog.create([{ action: "PURCHASE_DELETED", entity: "Purchase", entityId: purchase._id, performedBy: req.user.email, details: `Removed purchase ${purchase.invoiceNumber || purchase._id}` }], { session });
    });
    res.json({ message: "Purchase and unused asset codes deleted." });
  } catch (err) { sendApiError(res, err, "Could not delete the purchase."); }
});

module.exports = router;
