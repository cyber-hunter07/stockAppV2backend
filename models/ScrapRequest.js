const mongoose = require("mongoose");

const scrapRequestSchema = new mongoose.Schema({
  assetCodes: [{ type: mongoose.Schema.Types.ObjectId, ref: "AssetCode", required: true }],
  reason: { type: String, trim: true, required: true, maxlength: 500 },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
  requestedBy: { type: String, required: true },
  reviewedBy: { type: String, default: "" },
  reviewedAt: { type: Date },
  reviewNotes: { type: String, trim: true, default: "", maxlength: 500 },
}, { timestamps: true });

module.exports = mongoose.model("ScrapRequest", scrapRequestSchema);
