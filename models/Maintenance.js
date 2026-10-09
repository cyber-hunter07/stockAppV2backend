const mongoose = require("mongoose");
const maintenanceSchema = new mongoose.Schema({
  assetCode: { type: mongoose.Schema.Types.ObjectId, ref: "AssetCode", required: true },
  previousAssetStatus: { type: String, enum: ["in_store", "issued", "transferred"], default: "issued" },
  date: { type: Date, required: true, default: Date.now },
  issue: { type: String, default: "" },
  serviceEngineer: { type: String, default: "" },
  cost: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "in_progress", "resolved"], default: "pending" },
  notes: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("Maintenance", maintenanceSchema);
