const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const PowerUnit = require("../models/PowerUnit");
const AssetCode = require("../models/AssetCode");
const Location = require("../models/Location");
const AuditLog = require("../models/AuditLog");
const { authenticate, authorize } = require("../middleware/auth");
const { sendApiError } = require("../utils/apiErrors");
const canEdit = authorize("Administrator", "Store Manager");
const validDate = (value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const dateInputValue = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value;

router.get("/api/power-units", authenticate, async (req, res) => {
  res.json(await PowerUnit.find().populate({ path: "assetCode", select: "code equipment department", populate: [{ path: "equipment", select: "name specification" }, { path: "department", select: "code" }] }).populate("location", "name").sort({ createdAt: -1 }));
});

function validBody(body) {
  const numeric = {};
  for (const field of ["kvaRating", "batteryCount", "backupMinutes", "loadWatts"]) {
    const value = Number(body[field] ?? 0);
    if (!Number.isFinite(value) || value < 0 || (field === "batteryCount" && !Number.isInteger(value)) || value > 1000000) return { error: `${field} must be a valid non-negative ${field === "batteryCount" ? "whole number" : "number"}.` };
    numeric[field] = value;
  }
  if (!body.assetCode || !mongoose.isValidObjectId(body.assetCode)) return { error: "Select a valid UPS asset code." };
  if (body.location && !mongoose.isValidObjectId(body.location)) return { error: "Choose a valid location." };
  if (body.makeModel && String(body.makeModel).length > 160) return { error: "Make/model must be 160 characters or fewer." };
  if (body.remarks && String(body.remarks).length > 1000) return { error: "Remarks must be 1,000 characters or fewer." };
  if (!validDate(body.installedDate) || !validDate(body.lastServiceDate)) return { error: "Enter valid installation and service dates." };
  if (body.status && !["working", "needs_service", "not_working"].includes(body.status)) return { error: "Choose a valid UPS status." };
  return { value: { ...numeric, assetCode: body.assetCode, location: body.location || undefined, makeModel: String(body.makeModel || "").trim(), installedDate: body.installedDate || undefined, lastServiceDate: body.lastServiceDate || undefined, status: body.status || "working", remarks: String(body.remarks || "").trim() } };
}

async function validateReferences(value) {
  const asset = await AssetCode.findById(value.assetCode).populate({ path: "equipment", populate: { path: "category" } });
  if (!asset || asset.status === "scrap") return "Select an active UPS/power asset.";
  const equipmentText = `${asset.equipment?.name || ""} ${asset.equipment?.category?.name || ""}`;
  if (!/ups|power/i.test(equipmentText)) return "The selected equipment type must be UPS or power equipment.";
  if (value.location && !await Location.exists({ _id: value.location })) return "The selected location does not exist.";
  return null;
}

router.post("/api/power-units", authenticate, canEdit, async (req, res) => {
  try {
    const parsed = validBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const referenceError = await validateReferences(parsed.value);
    if (referenceError) return res.status(400).json({ error: referenceError });
    const exists = await PowerUnit.exists({ assetCode: parsed.value.assetCode });
    if (exists) return res.status(409).json({ error: "This asset already has a UPS register entry." });
    const record = await PowerUnit.create({ ...parsed.value, updatedBy: req.user.email });
    await AuditLog.create({ action: "UPS_REGISTERED", entity: "PowerUnit", entityId: record._id, performedBy: req.user.email, details: `UPS asset ${record.assetCode} registered` });
    res.status(201).json(record);
  } catch (error) { sendApiError(res, error, "Could not save UPS record."); }
});

router.put("/api/power-units/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid UPS record id." });
    const existing = await PowerUnit.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "UPS record not found." });
    const parsed = validBody({ ...existing.toObject(), ...req.body, installedDate: dateInputValue(req.body.installedDate ?? existing.installedDate), lastServiceDate: dateInputValue(req.body.lastServiceDate ?? existing.lastServiceDate), assetCode: req.body.assetCode || existing.assetCode });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const referenceError = await validateReferences(parsed.value);
    if (referenceError) return res.status(400).json({ error: referenceError });
    const duplicate = await PowerUnit.exists({ _id: { $ne: existing._id }, assetCode: parsed.value.assetCode });
    if (duplicate) return res.status(409).json({ error: "This asset already has a UPS register entry." });
    Object.assign(existing, parsed.value, { updatedBy: req.user.email });
    await existing.save();
    await AuditLog.create({ action: "UPS_UPDATED", entity: "PowerUnit", entityId: existing._id, performedBy: req.user.email, details: `UPS asset ${existing.assetCode} updated` });
    res.json(existing);
  } catch (error) { sendApiError(res, error, "Could not update UPS record."); }
});

router.delete("/api/power-units/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid UPS record id." });
  const record = await PowerUnit.findByIdAndDelete(req.params.id);
  if (!record) return res.status(404).json({ error: "UPS record not found." });
  await AuditLog.create({ action: "UPS_DELETED", entity: "PowerUnit", entityId: record._id, performedBy: req.user.email, details: `UPS asset ${record.assetCode} removed from UPS register` });
  res.json({ message: "UPS register entry deleted." });
});

module.exports = router;
