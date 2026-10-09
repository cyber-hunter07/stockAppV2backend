const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Consumable = require("../models/Consumable");
const { authenticate, authorize } = require("../middleware/auth");
const Equipment = require("../models/Equipment");
const AssetCode = require("../models/AssetCode");
const AuditLog = require("../models/AuditLog");
const { sendApiError } = require("../utils/apiErrors");
const canEdit = authorize("Administrator", "Store Manager");

router.get("/api/consumables", authenticate, async (req, res) => {
  const list = await Consumable.find()
    .populate("equipment", "name")
    .populate("assetCode", "code location")
    .sort({ createdAt: -1 });
  res.json(list);
});

router.post("/api/consumables", authenticate, canEdit, async (req, res) => {
  try {
    const { equipment, assetCode, modelName, installedDate, status = "installed" } = req.body;
    const cost = Number(req.body.cost ?? 0);
    if (!mongoose.isValidObjectId(equipment)) return res.status(400).json({ error: "Choose a valid printer type." });
    if (assetCode && !mongoose.isValidObjectId(assetCode)) return res.status(400).json({ error: "Choose a valid printer asset." });
    if (!String(modelName || "").trim()) return res.status(400).json({ error: "Consumable model is required." });
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: "Cost must be zero or greater." });
    if (installedDate && Number.isNaN(new Date(installedDate).getTime())) return res.status(400).json({ error: "Enter a valid fitted date." });
    if (!["installed", "needs_toner", "ordered"].includes(status)) return res.status(400).json({ error: "Choose a valid consumable status." });
    const printer = await Equipment.findById(equipment);
    if (!printer || !printer.isConsumable) return res.status(400).json({ error: "Choose an equipment type marked as using toner or ink." });
    if (assetCode) {
      const code = await AssetCode.findById(assetCode).select("equipment status");
      if (!code || String(code.equipment) !== String(equipment) || code.status === "scrap") return res.status(400).json({ error: "The selected asset must be an active asset of the selected printer type." });
    }
    const item = await Consumable.create({ equipment, assetCode: assetCode || undefined, modelName: String(modelName).trim(), cost, installedDate: installedDate || undefined, status });
    await AuditLog.create({ action: "CONSUMABLE_RECORDED", entity: "Consumable", entityId: item._id, performedBy: req.user.email, details: `${item.modelName} recorded for ${printer.name}` });
    res.status(201).json(item);
  } catch (err) { sendApiError(res, err, "Could not save consumable record."); }
});

router.put("/api/consumables/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid consumable id." });
    const changes = {};
    for (const field of ["status", "modelName", "cost", "installedDate"]) if (req.body[field] !== undefined) changes[field] = req.body[field];
    if (changes.status && !["installed", "needs_toner", "ordered"].includes(changes.status)) return res.status(400).json({ error: "Choose a valid consumable status." });
    if (changes.modelName !== undefined) changes.modelName = String(changes.modelName).trim();
    if (changes.cost !== undefined) {
      changes.cost = Number(changes.cost);
      if (!Number.isFinite(changes.cost) || changes.cost < 0) return res.status(400).json({ error: "Cost must be zero or greater." });
    }
    if (changes.installedDate && Number.isNaN(new Date(changes.installedDate).getTime())) return res.status(400).json({ error: "Enter a valid fitted date." });
    const item = await Consumable.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: "Consumable record not found." });
    await AuditLog.create({ action: "CONSUMABLE_UPDATED", entity: "Consumable", entityId: item._id, performedBy: req.user.email, details: `${item.modelName} status: ${item.status}` });
    res.json(item);
  } catch (err) { sendApiError(res, err, "Could not update consumable record."); }
});

module.exports = router;
