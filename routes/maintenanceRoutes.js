const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Maintenance = require("../models/Maintenance");
const AssetCode = require("../models/AssetCode");
const AuditLog = require("../models/AuditLog");
const { sendApiError } = require("../utils/apiErrors");
const { withMongoTransaction } = require("../utils/mongoTransaction");
const { authenticate, authorize } = require("../middleware/auth");
const canEdit = authorize("Administrator", "Store Manager");

router.get("/api/maintenance", authenticate, async (req, res) => {
  const list = await Maintenance.find()
    .populate({ path: "assetCode", select: "code equipment location", populate: [{ path: "equipment", select: "name" }, { path: "location", select: "name" }] })
    .sort({ date: -1 });
  res.json(list);
});

router.post("/api/maintenance", authenticate, canEdit, async (req, res) => {
  const { assetCode, date, issue = "", serviceEngineer = "", cost = 0, status = "pending", notes = "" } = req.body;
  const amount = Number(cost);
  if (!mongoose.isValidObjectId(assetCode)) return res.status(400).json({ error: "Choose a valid asset code." });
  if (!date || Number.isNaN(new Date(date).getTime())) return res.status(400).json({ error: "Enter a valid service date." });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Cost must be zero or greater." });
  if (!["pending", "in_progress", "resolved"].includes(status)) return res.status(400).json({ error: "Choose a valid maintenance status." });
  if (String(issue).length > 500 || String(serviceEngineer).length > 120 || String(notes).length > 1000) return res.status(400).json({ error: "Maintenance details are too long." });
  let record;
  try {
    await withMongoTransaction(async (session) => {
      const asset = await AssetCode.findById(assetCode).session(session);
      if (!asset || asset.status === "scrap") { const error = new Error("This asset is not available for maintenance."); error.status = 409; throw error; }
      const previousAssetStatus = asset.status === "maintenance" ? "issued" : asset.status;
      [record] = await Maintenance.create([{
        assetCode: asset._id, previousAssetStatus, date: new Date(date), issue: String(issue).trim(),
        serviceEngineer: String(serviceEngineer).trim(), cost: amount, status, notes: String(notes).trim(),
      }], { session });
      asset.maintenanceCount += 1;
      asset.maintenanceCost += amount;
      asset.status = status === "resolved" ? previousAssetStatus : "maintenance";
      await asset.save({ session });
      await AuditLog.create([{ action: "MAINTENANCE_RECORDED", entity: "Maintenance", entityId: record._id, performedBy: req.user.email, details: `Service ${status} for ${asset.code}` }], { session });
    });
    res.status(201).json(record);
  } catch (err) { sendApiError(res, err, "Could not save maintenance record. Check the asset history before retrying."); }
});

router.put("/api/maintenance/:id", authenticate, canEdit, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid maintenance record id." });
  const status = req.body.status;
  if (status && !["pending", "in_progress", "resolved"].includes(status)) return res.status(400).json({ error: "Choose a valid maintenance status." });
  let record;
  try {
    await withMongoTransaction(async (session) => {
      record = await Maintenance.findById(req.params.id).session(session);
      if (!record) { const error = new Error("Maintenance record not found."); error.status = 404; throw error; }
      const asset = await AssetCode.findById(record.assetCode).session(session);
      if (!asset) { const error = new Error("The asset linked to this record no longer exists."); error.status = 409; throw error; }
      if (status && status !== record.status) {
        record.status = status;
        asset.status = status === "resolved" ? record.previousAssetStatus : "maintenance";
      }
      if (req.body.date !== undefined) {
        if (Number.isNaN(new Date(req.body.date).getTime())) { const error = new Error("Enter a valid service date."); error.status = 400; throw error; }
        record.date = new Date(req.body.date);
      }
      for (const field of ["issue", "serviceEngineer", "notes"]) if (req.body[field] !== undefined) record[field] = String(req.body[field]).trim();
      if (req.body.cost !== undefined) {
        const cost = Number(req.body.cost);
        if (!Number.isFinite(cost) || cost < 0) { const error = new Error("Cost must be zero or greater."); error.status = 400; throw error; }
        asset.maintenanceCost += cost - record.cost;
        record.cost = cost;
      }
      await asset.save({ session });
      await record.save({ session });
      await AuditLog.create([{ action: "MAINTENANCE_UPDATED", entity: "Maintenance", entityId: record._id, performedBy: req.user.email, details: `Maintenance status set to ${record.status}` }], { session });
    });
    res.json(record);
  } catch (err) { sendApiError(res, err, "Could not update maintenance record. Check the asset history before retrying."); }
});

module.exports = router;
