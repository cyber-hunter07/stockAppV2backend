const mongoose = require("mongoose");
const assetCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // e.g. SIT-DESK-062024-001
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: "Equipment", required: true },
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: "Purchase" },
  serialNo: { type: String, default: "" },
  location: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  status: {
    type: String,
    enum: ["in_store", "issued", "transferred", "maintenance", "scrap"],
    default: "in_store",
  },
  purchaseDate: { type: Date },
  unitCost: { type: Number, default: 0 },
  remarks: { type: String, default: "" },
  maintenanceCount: { type: Number, default: 0 },
  maintenanceCost: { type: Number, default: 0 },
}, { timestamps: true });
assetCodeSchema.index({ location: 1 });
assetCodeSchema.index({ equipment: 1 });
module.exports = mongoose.model("AssetCode", assetCodeSchema);
