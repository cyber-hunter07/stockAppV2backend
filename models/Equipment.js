const mongoose = require("mongoose");
const equipmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // model name e.g. "Desktop Computer i5"
  specification: { type: String, default: "" }, // e.g. "Intel Core i5 / 8GB RAM / 512GB SSD"
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  isConsumable: { type: Boolean, default: false }, // true for printers that use toner/ink
  consumableModels: [{ type: String }], // e.g. ["HP 88A", "Canon 303"]
  codePrefix: { type: String, default: "" }, // 3-4 letter code for asset-code generation e.g. "DESK"
  lowStockThreshold: { type: Number, default: 2 },
}, { timestamps: true });
module.exports = mongoose.model("Equipment", equipmentSchema);
