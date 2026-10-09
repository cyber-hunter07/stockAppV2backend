const mongoose = require("mongoose");
const consumableSchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: "Equipment", required: true }, // the printer
  assetCode: { type: mongoose.Schema.Types.ObjectId, ref: "AssetCode" }, // which printer unit
  modelName: { type: String, required: true }, // e.g. "HP 88A"
  cost: { type: Number, default: 0 },
  installedDate: { type: Date, default: Date.now },
  status: { type: String, enum: ["installed", "needs_toner", "ordered"], default: "installed" },
}, { timestamps: true });
module.exports = mongoose.model("Consumable", consumableSchema);
