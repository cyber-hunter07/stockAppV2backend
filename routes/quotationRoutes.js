const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const QuotationRequest = require("../models/QuotationRequest");
const Vendor = require("../models/Vendor");
const AuditLog = require("../models/AuditLog");
const { authenticate, authorize } = require("../middleware/auth");
const { sendApiError } = require("../utils/apiErrors");
const canEdit = authorize("Administrator", "Store Manager");
const dateIsValid = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
function cleanAttachment(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const name = String(value.name || "").trim().slice(0, 180);
  const mimeType = String(value.mimeType || "").trim().toLowerCase();
  const dataUrl = String(value.dataUrl || "");
  if (!name || !ATTACHMENT_TYPES.has(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
    const error = new Error(`${label} must be a PDF, JPG, PNG, or WebP file.`); error.status = 400; throw error;
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64 || Buffer.byteLength(base64, "base64") > MAX_ATTACHMENT_BYTES) {
    const error = new Error(`${label} must be 2 MB or smaller.`); error.status = 400; throw error;
  }
  return { name, mimeType, dataUrl };
}

router.get("/api/quotations", authenticate, async (req, res) => {
  res.json(await QuotationRequest.find().populate("vendor", "companyName").sort({ createdAt: -1 }));
});

function cleanItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return null;
  const normalized = [];
  for (const item of items) {
    const itemName = String(item.itemName || "").trim();
    const qty = Number(item.qty ?? 1);
    if (!itemName || itemName.length > 160 || !Number.isInteger(qty) || qty < 1 || qty > 100000) return null;
    normalized.push({ itemName, qty, specifications: String(item.specifications || "").trim().slice(0, 500), remarks: String(item.remarks || "").trim().slice(0, 500) });
  }
  return normalized;
}

router.post("/api/quotations", authenticate, canEdit, async (req, res) => {
  try {
    const vendorId = req.body.vendor;
    const requestDate = req.body.requestDate;
    const items = cleanItems(req.body.items);
    if (!mongoose.isValidObjectId(vendorId)) return res.status(400).json({ error: "Choose a valid vendor." });
    if (!dateIsValid(requestDate)) return res.status(400).json({ error: "Enter a valid request date." });
    if (!items) return res.status(400).json({ error: "Add 1–50 items with a name and a valid positive quantity." });
    if (req.body.replyRequiredBy && !dateIsValid(req.body.replyRequiredBy)) return res.status(400).json({ error: "Enter a valid reply-by date." });
    if (req.body.replyRequiredBy && req.body.replyRequiredBy < requestDate) return res.status(400).json({ error: "Reply-by date cannot be before the request date." });
    if (String(req.body.additionalNotes || "").length > 2000) return res.status(400).json({ error: "Additional notes must be 2,000 characters or fewer." });
    if (!await Vendor.exists({ _id: vendorId })) return res.status(404).json({ error: "Vendor not found." });
    const year = new Date(`${requestDate}T00:00:00`).getFullYear();
    const count = await QuotationRequest.countDocuments({ requestDate: { $gte: new Date(`${year}-01-01T00:00:00`), $lt: new Date(`${year + 1}-01-01T00:00:00`) } });
    const billAttachment = cleanAttachment(req.body.billAttachment, "Bill attachment");
    const request = await QuotationRequest.create({
      reference: `QR-${year}-${String(count + 1).padStart(4, "0")}`, vendor: vendorId,
      requestDate: new Date(`${requestDate}T00:00:00`), replyRequiredBy: req.body.replyRequiredBy ? new Date(`${req.body.replyRequiredBy}T00:00:00`) : undefined,
      items, paymentTerms: String(req.body.paymentTerms || "").trim().slice(0, 500), deliveryTerms: String(req.body.deliveryTerms || "").trim().slice(0, 500),
      warrantyExpected: String(req.body.warrantyExpected || "").trim().slice(0, 500), additionalNotes: String(req.body.additionalNotes || "").trim(), billAttachment,
    });
    await AuditLog.create({ action: "QUOTATION_CREATED", entity: "QuotationRequest", entityId: request._id, performedBy: req.user.email, details: `Created ${request.reference}` });
    res.status(201).json(request);
  } catch (error) { sendApiError(res, error, "Could not create quotation request."); }
});

router.put("/api/quotations/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid quotation request id." });
    const changes = {};
    if (req.body.status !== undefined) {
      if (!["pending", "received", "closed"].includes(req.body.status)) return res.status(400).json({ error: "Choose a valid quotation status." });
      changes.status = req.body.status;
    }
    if (req.body.replyRequiredBy !== undefined) {
      if (req.body.replyRequiredBy && !dateIsValid(req.body.replyRequiredBy)) return res.status(400).json({ error: "Enter a valid reply-by date." });
      changes.replyRequiredBy = req.body.replyRequiredBy ? new Date(`${req.body.replyRequiredBy}T00:00:00`) : null;
    }
    if (req.body.items !== undefined) {
      const items = cleanItems(req.body.items);
      if (!items) return res.status(400).json({ error: "Add 1–50 items with a name and a valid positive quantity." });
      changes.items = items;
    }
    if (req.body.additionalNotes !== undefined) changes.additionalNotes = String(req.body.additionalNotes).trim().slice(0, 2000);
    if (req.body.billAttachment !== undefined) changes.billAttachment = cleanAttachment(req.body.billAttachment, "Bill attachment");
    const request = await QuotationRequest.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true }).populate("vendor", "companyName");
    if (!request) return res.status(404).json({ error: "Quotation request not found." });
    await AuditLog.create({ action: "QUOTATION_UPDATED", entity: "QuotationRequest", entityId: request._id, performedBy: req.user.email, details: `${request.reference}: ${request.status}` });
    res.json(request);
  } catch (error) { sendApiError(res, error, "Could not update quotation request."); }
});

router.delete("/api/quotations/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid quotation request id." });
  const request = await QuotationRequest.findByIdAndDelete(req.params.id);
  if (!request) return res.status(404).json({ error: "Quotation request not found." });
  await AuditLog.create({ action: "QUOTATION_DELETED", entity: "QuotationRequest", entityId: request._id, performedBy: req.user.email, details: `Deleted ${request.reference}` });
  res.json({ message: "Deleted" });
});

module.exports = router;
