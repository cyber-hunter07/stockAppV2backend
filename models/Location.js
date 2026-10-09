const mongoose = require("mongoose");
const locationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, default: "" }, // e.g. "Lab", "Store", "Office"
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  areaFloor: { type: String, default: "" },
  description: { type: String, default: "" },
  isCentralStore: { type: Boolean, default: false }, // true for "Store Room"
  isScrapStore: { type: Boolean, default: false },
}, { timestamps: true });
module.exports = mongoose.model("Location", locationSchema);
