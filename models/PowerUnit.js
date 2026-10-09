const mongoose = require("mongoose");
const powerUnitSchema = new mongoose.Schema({
  assetCode: { type: mongoose.Schema.Types.ObjectId, ref: "AssetCode", required: true, unique: true },
  makeModel: { type: String, trim: true, default: "" },
  kvaRating: { type: Number, min: 0, default: 0 },
  batteryCount: { type: Number, min: 0, default: 0 },
  backupMinutes: { type: Number, min: 0, default: 0 },
  loadWatts: { type: Number, min: 0, default: 0 },
  location: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
  installedDate: { type: Date },
  lastServiceDate: { type: Date },
  status: { type: String, enum: ["working", "needs_service", "not_working"], default: "working" },
  remarks: { type: String, default: "" },
  updatedBy: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("PowerUnit", powerUnitSchema);
