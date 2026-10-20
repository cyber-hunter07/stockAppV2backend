const mongoose = require("mongoose");
const quotationItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true },
  specifications: { type: String, default: "" },
  qty: { type: Number, default: 1 },
  remarks: { type: String, default: "" },
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  name: { type: String, default: "" },
  mimeType: { type: String, default: "" },
  dataUrl: { type: String, default: "" },
}, { _id: false });

const quotationSchema = new mongoose.Schema({
  reference: { type: String, unique: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
  requestDate: { type: Date, required: true, default: Date.now },
  replyRequiredBy: { type: Date },
  items: [quotationItemSchema],
  paymentTerms: { type: String, default: "" },
  deliveryTerms: { type: String, default: "" },
  warrantyExpected: { type: String, default: "" },
  additionalNotes: { type: String, default: "" },
  billAttachment: { type: attachmentSchema, default: undefined },
  status: { type: String, enum: ["pending", "received", "closed"], default: "pending" },
}, { timestamps: true });
module.exports = mongoose.model("QuotationRequest", quotationSchema);
