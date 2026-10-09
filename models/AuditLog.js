const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // e.g. "ITEM_CREATED", "STOCK_OUT", "LOGIN"
    entity: { type: String, default: "" }, // e.g. "Item", "StockTransaction"
    entityId: { type: mongoose.Schema.Types.ObjectId },
    performedBy: { type: String, default: "system" },
    details: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
