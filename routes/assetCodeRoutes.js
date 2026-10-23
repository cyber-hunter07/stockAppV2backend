const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const AssetCode = require("../models/AssetCode");
const AuditLog = require("../models/AuditLog");
const Location = require("../models/Location");
const StockMovement = require("../models/StockMovement");
const ScrapRequest = require("../models/ScrapRequest");
const Department = require("../models/Department");
const Maintenance = require("../models/Maintenance");
const Purchase = require("../models/Purchase");
const { sendApiError } = require("../utils/apiErrors");
const { withMongoTransaction } = require("../utils/mongoTransaction");
const { authenticate, authorize } = require("../middleware/auth");
const canEdit = authorize("Administrator", "Store Manager");
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
function cleanCertificateAttachment(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const name = String(value.name || "").trim().slice(0, 180);
  const mimeType = String(value.mimeType || "").trim().toLowerCase();
  const dataUrl = String(value.dataUrl || "");
  if (!name || !ATTACHMENT_TYPES.has(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
    const error = new Error("Certificate must be a PDF, JPG, PNG, or WebP file."); error.status = 400; throw error;
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64 || Buffer.byteLength(base64, "base64") > MAX_ATTACHMENT_BYTES) {
    const error = new Error("Certificate must be 2 MB or smaller."); error.status = 400; throw error;
  }
  return { name, mimeType, dataUrl };
}


// GET /api/asset-codes - full register, with filters
router.get("/api/asset-codes", authenticate, async (req, res) => {
  const { equipment, location, department, status, search } = req.query;
  const filter = {};
  if (equipment && mongoose.isValidObjectId(equipment)) filter.equipment = equipment;
  else if (equipment) return res.status(400).json({ error: "Invalid equipment filter." });
  if (location && mongoose.isValidObjectId(location)) filter.location = location;
  else if (location) return res.status(400).json({ error: "Invalid location filter." });
  if (department && mongoose.isValidObjectId(department)) filter.department = department;
  else if (department) return res.status(400).json({ error: "Invalid department filter." });
  if (status && !["in_store", "issued", "transferred", "maintenance", "scrap"].includes(status)) return res.status(400).json({ error: "Invalid status filter." });
  if (status) filter.status = status;
  if (search) {
    const escaped = String(search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.code = new RegExp(escaped, "i");
  }

  const codes = await AssetCode.find(filter)
    .populate({ path: "equipment", select: "name specification category", populate: { path: "category", select: "name" } })
    .populate("location", "name")
    .populate("department", "code")
    .sort({ createdAt: -1 });
  res.json(codes);
});

router.get("/api/asset-codes/stats", authenticate, async (req, res) => {
  const total = await AssetCode.countDocuments({ status: { $ne: "scrap" } });
  const inStore = await AssetCode.countDocuments({ status: "in_store" });
  const issued = await AssetCode.countDocuments({ status: { $in: ["issued", "transferred"] } });
  res.json({ total, inStore, issued });
});

router.get("/api/stock-movements", authenticate, async (req, res) => {
  const filter = {};
  if (req.query.type && ["distribution", "transfer", "stock_move", "scrap"].includes(req.query.type)) filter.type = req.query.type;
  const rows = await StockMovement.find(filter)
    .populate({ path: "items.assetCode", select: "code equipment", populate: { path: "equipment", select: "name" } })
    .populate("items.fromLocation", "name").populate("items.toLocation", "name")
    .populate("items.fromDepartment", "code").populate("items.toDepartment", "code")
    .sort({ createdAt: -1 }).limit(500);
  res.json(rows);
});

router.put("/api/asset-codes/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid asset id." });
    const changes = {};
    for (const key of ["code", "serialNo", "unitCost", "remarks"]) if (req.body[key] !== undefined) changes[key] = req.body[key];
    if (changes.code !== undefined) changes.code = String(changes.code).trim().toUpperCase();
    if (changes.serialNo !== undefined) changes.serialNo = String(changes.serialNo).trim();
    if (changes.remarks !== undefined) changes.remarks = String(changes.remarks).trim();
    if (changes.unitCost !== undefined) changes.unitCost = Number(changes.unitCost);
    if (changes.code && !/^[A-Z0-9-]{3,40}$/.test(changes.code)) return res.status(400).json({ error: "Asset code must contain only letters, numbers, or hyphens." });
    if (changes.unitCost !== undefined && (!Number.isFinite(changes.unitCost) || changes.unitCost < 0)) return res.status(400).json({ error: "Unit cost must be zero or greater." });
    const asset = await AssetCode.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
    if (!asset) return res.status(404).json({ error: "Asset not found." });
    res.json(asset);
  } catch (err) { sendApiError(res, err, "Could not update asset."); }
});

router.delete("/api/asset-codes/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid asset id." });
  const asset = await AssetCode.findById(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found." });
  const [maintenance, purchase] = await Promise.all([Maintenance.exists({ assetCode: req.params.id }), asset.purchase ? Purchase.exists({ _id: asset.purchase }) : false]);
  if (maintenance || purchase) return res.status(409).json({ error: "This asset is linked to purchase or maintenance history and cannot be deleted." });
  await AssetCode.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

function parseAssetIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  if (new Set(value.map(String)).size !== value.length || value.some((id) => !mongoose.isValidObjectId(id))) return null;
  return value;
}

async function completeMovement(req, res, { type, allowedStatuses, nextStatus, requireReason = false }) {
  const { assetCodeIds, toLocation, toDepartment, remarks = "", reason = remarks } = req.body;
  const ids = parseAssetIds(assetCodeIds);
  if (!ids) return res.status(400).json({ error: "Select between 1 and 200 different valid asset codes." });
  if (requireReason && !String(reason || "").trim()) return res.status(400).json({ error: "A reason is required." });
  if (String(reason || "").length > 500 || String(remarks || "").length > 1000) return res.status(400).json({ error: "Reason or remarks are too long." });
  if (!["stock_move", "scrap"].includes(type) && !mongoose.isValidObjectId(toLocation)) return res.status(400).json({ error: "Choose a valid destination location." });
  if (type === "stock_move" && toDepartment && !mongoose.isValidObjectId(toDepartment)) return res.status(400).json({ error: "Choose a valid department." });
  if (type === "stock_move" && !toDepartment) return res.status(400).json({ error: "Choose the department receiving these assets." });

  let result;
  try {
    await withMongoTransaction(async (session) => {
      const [assets, selectedDestination, department] = await Promise.all([
        AssetCode.find({ _id: { $in: ids } }).session(session),
        type === "scrap" ? Location.findOne({ isScrapStore: true }).session(session) : toLocation ? Location.findById(toLocation).session(session) : null,
        toDepartment ? Department.findById(toDepartment).session(session) : null,
      ]);
      let destination = selectedDestination;
      if (type === "scrap" && !destination) [destination] = await Location.create([{ name: "Scrap Store", type: "Store", isScrapStore: true }], { session });
      if (assets.length !== ids.length) { const error = new Error("One or more asset codes no longer exist."); error.status = 409; throw error; }
      if (type !== "stock_move" && !destination) { const error = new Error("Destination location not found."); error.status = 404; throw error; }
      if (type === "stock_move" && toDepartment && !department) { const error = new Error("Department not found."); error.status = 404; throw error; }
      if (type !== "scrap" && (destination?.isCentralStore || destination?.isScrapStore)) { const error = new Error("Choose a normal destination location."); error.status = 400; throw error; }
      if (assets.some((asset) => !allowedStatuses.includes(asset.status))) { const error = new Error("Some selected assets are no longer eligible for this movement. Refresh and try again."); error.status = 409; throw error; }
      if (type === "distribution" && assets.some((asset) => asset.location?.toString() === destination._id.toString())) { const error = new Error("Selected assets are already at that location."); error.status = 409; throw error; }
      if (type === "transfer" && assets.some((asset) => asset.location?.toString() === destination._id.toString())) { const error = new Error("Choose a destination different from the current location."); error.status = 409; throw error; }

      const items = assets.map((asset) => ({
        assetCode: asset._id,
        fromLocation: asset.location,
        toLocation: destination?._id || asset.location,
        fromDepartment: asset.department,
        toDepartment: type === "stock_move" ? department?._id || asset.department : destination?.department || asset.department,
      }));
      const operations = assets.map((asset) => {
        const update = { status: nextStatus, remarks: String(remarks || "").trim() };
        if (destination) update.location = destination._id;
        if (type === "stock_move") update.department = department?._id || asset.department;
        else if (destination?.department) update.department = destination.department;
        return { updateOne: { filter: { _id: asset._id, status: asset.status, location: asset.location }, update: { $set: update } } };
      });
      const changed = await AssetCode.bulkWrite(operations, { session, ordered: true });
      if (changed.modifiedCount !== ids.length) { const error = new Error("The stock changed during this movement. Nothing was saved; refresh and try again."); error.status = 409; throw error; }
      await StockMovement.create([{ type, items, reason: String(reason || "").trim() || type, remarks: String(remarks || "").trim(), performedBy: req.user.email }], { session });
      await AuditLog.create([{ action: type.toUpperCase(), entity: "StockMovement", performedBy: req.user.email, details: `${ids.length} asset(s) ${type.replace("_", " ")} ${destination ? `to ${destination.name}` : department ? `to ${department.code}` : ""}` }], { session });
      result = { message: `Movement saved.`, count: ids.length };
    });
    res.json(result);
  } catch (err) { sendApiError(res, err, "Could not save stock movement. Review asset statuses before retrying."); }
}

// ---- Distribution: move asset codes from Store Room to a department location ----
router.post("/api/distribution", authenticate, canEdit, async (req, res) => {
  return completeMovement(req, res, { type: "distribution", allowedStatuses: ["in_store"], nextStatus: "issued", requireReason: false });
});

// ---- Stock Transfer: move asset codes between two non-store locations ----
router.post("/api/stock-transfers", authenticate, canEdit, async (req, res) => {
  return completeMovement(req, res, { type: "transfer", allowedStatuses: ["issued", "transferred"], nextStatus: "transferred", requireReason: true });
});

router.post("/api/stock-move", authenticate, canEdit, async (req, res) => {
  return completeMovement(req, res, { type: "stock_move", allowedStatuses: ["in_store", "issued", "transferred"], nextStatus: "issued", requireReason: true });
});

router.get("/api/scrap/requests/:id/certificate", authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid scrap request id." });
  const request = await ScrapRequest.findById(req.params.id).select("certificateAttachment");
  if (!request) return res.status(404).json({ error: "Scrap request not found." });
  const attachment = request.certificateAttachment;
  if (!attachment?.dataUrl || !attachment.mimeType) return res.status(404).json({ error: "No certificate is attached to this request." });
  const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
  res.set({ "Content-Type": attachment.mimeType, "Content-Disposition": `inline; filename="${String(attachment.name || "certificate").replace(/[\\"]/g, "_")}"`, "Cache-Control": "private, max-age=300" });
  return res.send(Buffer.from(base64, "base64"));
});

router.get("/api/scrap/requests", authenticate, async (req, res) => {
  const filter = {};
  if (req.query.status && ["pending", "approved", "rejected"].includes(req.query.status)) filter.status = req.query.status;
  const requests = await ScrapRequest.find(filter).populate({ path: "assetCodes", select: "code equipment location status", populate: [{ path: "equipment", select: "name" }, { path: "location", select: "name" }] }).sort({ createdAt: -1 }).limit(500);
  res.json(requests);
});

async function createScrapRequest(req, res) {
  const ids = parseAssetIds(req.body.assetCodeIds);
  const reason = String(req.body.reason || req.body.remarks || "").trim();
  if (!ids) return res.status(400).json({ error: "Select between 1 and 200 different valid asset codes." });
  if (!reason) return res.status(400).json({ error: "A reason is required for the scrap request." });
  if (reason.length > 500) return res.status(400).json({ error: "Reason must be 500 characters or fewer." });
  const assets = await AssetCode.find({ _id: { $in: ids } }).select("_id status");
  if (assets.length !== ids.length || assets.some((asset) => asset.status === "scrap")) return res.status(409).json({ error: "Some selected assets are unavailable. Refresh and select them again." });
  const pending = await ScrapRequest.exists({ status: "pending", assetCodes: { $in: ids } });
  if (pending) return res.status(409).json({ error: "At least one selected asset already has a pending scrap request." });
  try {
    const certificateAttachment = cleanCertificateAttachment(req.body.certificateAttachment);
    const request = await ScrapRequest.create({ assetCodes: ids, reason, certificateAttachment, requestedBy: req.user.email });
    await AuditLog.create({ action: "SCRAP_REQUESTED", entity: "ScrapRequest", entityId: request._id, performedBy: req.user.email, details: `${ids.length} asset(s) submitted for scrap approval` });
    res.status(201).json(request);
  } catch (err) { sendApiError(res, err, "Could not submit the scrap request."); }
}

router.post("/api/scrap/requests", authenticate, canEdit, createScrapRequest);
// Keep the previous client path working, but route it through approval instead of scrapping immediately.
router.post("/api/scrap", authenticate, canEdit, createScrapRequest);

router.patch("/api/scrap/requests/:id", authenticate, authorize("Administrator"), async (req, res) => {
  const { status, reviewNotes = "" } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid scrap request id." });
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Choose approve or reject." });
  if (String(reviewNotes).length > 500) return res.status(400).json({ error: "Review notes must be 500 characters or fewer." });
  let updatedRequest;
  try {
    await withMongoTransaction(async (session) => {
      const request = await ScrapRequest.findById(req.params.id).session(session);
      if (!request) { const error = new Error("Scrap request not found."); error.status = 404; throw error; }
      if (request.status !== "pending") { const error = new Error("This scrap request has already been reviewed."); error.status = 409; throw error; }
      if (status === "approved") {
        const assets = await AssetCode.find({ _id: { $in: request.assetCodes }, status: { $ne: "scrap" } }).session(session);
        if (assets.length !== request.assetCodes.length) { const error = new Error("Some requested assets are no longer available. The request was not approved."); error.status = 409; throw error; }
        let scrapStore = await Location.findOne({ isScrapStore: true }).session(session);
        if (!scrapStore) [scrapStore] = await Location.create([{ name: "Scrap Store", type: "Store", isScrapStore: true }], { session });
        const items = assets.map((asset) => ({ assetCode: asset._id, fromLocation: asset.location, toLocation: scrapStore._id, fromDepartment: asset.department, toDepartment: asset.department }));
        const operations = assets.map((asset) => ({ updateOne: { filter: { _id: asset._id, status: asset.status }, update: { $set: { status: "scrap", location: scrapStore._id, remarks: request.reason } } } }));
        const result = await AssetCode.bulkWrite(operations, { session, ordered: true });
        if (result.modifiedCount !== assets.length) { const error = new Error("Asset stock changed during review. Refresh and try again."); error.status = 409; throw error; }
        await StockMovement.create([{ type: "scrap", items, reason: request.reason, performedBy: req.user.email }], { session });
      }
      request.status = status;
      request.reviewedBy = req.user.email;
      request.reviewedAt = new Date();
      request.reviewNotes = String(reviewNotes).trim();
      updatedRequest = await request.save({ session });
      await AuditLog.create([{ action: status === "approved" ? "SCRAP_APPROVED" : "SCRAP_REJECTED", entity: "ScrapRequest", entityId: request._id, performedBy: req.user.email, details: `${request.assetCodes.length} asset(s) ${status}` }], { session });
    });
    res.json(updatedRequest);
  } catch (err) { sendApiError(res, err, "Could not review the scrap request. Review asset statuses before retrying."); }
});

router.get("/api/scrap", authenticate, async (req, res) => {
  const scrapStore = await Location.findOne({ isScrapStore: true });
  if (!scrapStore) return res.json([]);
  const items = await AssetCode.find({ location: scrapStore._id })
    .populate("equipment", "name").sort({ updatedAt: -1 });
  res.json(items);
});

module.exports = router;
