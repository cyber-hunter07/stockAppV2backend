const mongoose = require("mongoose");

const movementItemSchema = new mongoose.Schema({
  assetCode: { type: mongoose.Schema.Types.ObjectId, ref: "AssetCode", required: true },
  fromLocation: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
  toLocation: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
  fromDepartment: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  toDepartment: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
}, { _id: false });

const stockMovementSchema = new mongoose.Schema({
  type: { type: String, enum: ["distribution", "transfer", "stock_move", "scrap"], required: true, index: true },
  items: { type: [movementItemSchema], validate: { validator: (items) => items.length > 0, message: "At least one asset is required." } },
  reason: { type: String, trim: true, required: true, maxlength: 500 },
  remarks: { type: String, trim: true, default: "", maxlength: 1000 },
  performedBy: { type: String, required: true },
}, { timestamps: true });

stockMovementSchema.index({ "items.assetCode": 1, createdAt: -1 });
module.exports = mongoose.model("StockMovement", stockMovementSchema);
