const mongoose = require("mongoose");
const purchaseItemSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: "Equipment", required: true },
  specification: { type: String, default: "" },
  qty: { type: Number, required: true, min: 1 },
  unitCost: { type: Number, required: true, min: 0 },
  gstPercent: { type: Number, default: 18 },
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  name: { type: String, default: "" },
  mimeType: { type: String, default: "" },
  dataUrl: { type: String, default: "" },
}, { _id: false });

const purchaseSchema = new mongoose.Schema({
  purchaseDate: { type: Date, required: true },
  invoiceNumber: { type: String, default: "" },
  invoicePdfUrl: { type: String, default: "" },
  billAttachment: { type: attachmentSchema, default: undefined },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
  items: [purchaseItemSchema],
  taxableTotal: { type: Number, default: 0 },
  gstTotal: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  notes: { type: String, default: "" },
  createdBy: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("Purchase", purchaseSchema);
