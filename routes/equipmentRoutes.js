const express = require("express");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Equipment = require("../models/Equipment");
const AssetCode = require("../models/AssetCode");
const Purchase = require("../models/Purchase");
const Category = require("../models/Category");
const { authenticate, authorize } = require("../middleware/auth");
const { sendApiError } = require("../utils/apiErrors");
const mongoose = require("mongoose");
const canEdit = authorize("Administrator", "Store Manager");

router.get("/api/equipment", authenticate, async (req, res) => {
  const list = await Equipment.find().populate("category", "name").sort({ name: 1 });
  const out = await Promise.all(
    list.map(async (e) => {
      const totalQty = await AssetCode.countDocuments({ equipment: e._id, status: { $ne: "scrap" } });
      const purchases = await Purchase.countDocuments({ "items.equipment": e._id });
      const codes = await AssetCode.find({ equipment: e._id, status: { $ne: "scrap" } });
      const totalValue = codes.reduce((s, c) => s + (c.unitCost || 0), 0);
      return { ...e.toObject(), totalQty, purchases, totalValue };
    })
  );
  res.json(out);
});

router.post("/api/equipment", authenticate, canEdit, async (req, res) => {
  try {
    const { name, specification, category, isConsumable, consumableModels, codePrefix, lowStockThreshold } = req.body;
    if (!String(name || "").trim() || String(name).trim().length > 120) return res.status(400).json({ error: "Enter an equipment name of 1–120 characters." });
    if (!mongoose.isValidObjectId(category)) return res.status(400).json({ error: "Choose a valid category." });
    if (!await Category.exists({ _id: category })) return res.status(400).json({ error: "The selected category does not exist." });
    const threshold = Number(lowStockThreshold ?? 2);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) return res.status(400).json({ error: "Low stock threshold must be a whole number from 0 to 1,000,000." });
    if (codePrefix && !/^[A-Z0-9-]{2,8}$/i.test(String(codePrefix).trim())) return res.status(400).json({ error: "Asset code prefix must contain 2–8 letters, numbers, or hyphens." });
    res.status(201).json(await Equipment.create({ name: String(name).trim(), specification: String(specification || "").trim(), category, isConsumable: Boolean(isConsumable), consumableModels: Array.isArray(consumableModels) ? consumableModels.map(String) : [], codePrefix: String(codePrefix || "").trim().toUpperCase(), lowStockThreshold: threshold }));
  } catch (err) { sendApiError(res, err, "Could not create equipment type."); }
});
router.put("/api/equipment/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid equipment id." });
    const changes = {};
    for (const key of ["name", "specification", "category", "isConsumable", "consumableModels", "codePrefix", "lowStockThreshold"]) {
      if (req.body[key] !== undefined) changes[key] = req.body[key];
    }
    if (changes.name !== undefined) changes.name = String(changes.name).trim();
    if (changes.specification !== undefined) changes.specification = String(changes.specification).trim();
    if (changes.codePrefix !== undefined) changes.codePrefix = String(changes.codePrefix).trim().toUpperCase();
    if (changes.lowStockThreshold !== undefined) changes.lowStockThreshold = Number(changes.lowStockThreshold);
    if (changes.name !== undefined && (!changes.name || changes.name.length > 120)) return res.status(400).json({ error: "Enter an equipment name of 1–120 characters." });
    if (changes.category !== undefined && (!mongoose.isValidObjectId(changes.category) || !await Category.exists({ _id: changes.category }))) return res.status(400).json({ error: "Choose an existing category." });
    if (changes.lowStockThreshold !== undefined && (!Number.isInteger(changes.lowStockThreshold) || changes.lowStockThreshold < 0 || changes.lowStockThreshold > 1000000)) return res.status(400).json({ error: "Low stock threshold must be a whole number from 0 to 1,000,000." });
    const item = await Equipment.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true }).populate("category", "name");
    if (!item) return res.status(404).json({ error: "Equipment type not found." });
    res.json(item);
  } catch (err) { sendApiError(res, err, "Could not update equipment type."); }
});
router.delete("/api/equipment/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid equipment id." });
  const [assets, purchases] = await Promise.all([
    AssetCode.countDocuments({ equipment: req.params.id }),
    Purchase.countDocuments({ "items.equipment": req.params.id }),
  ]);
  if (assets || purchases) return res.status(409).json({ error: "This equipment type is linked to stock or purchases and cannot be deleted." });
  const deleted = await Equipment.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Equipment type not found." });
  res.json({ message: "Deleted" });
});

module.exports = router;
