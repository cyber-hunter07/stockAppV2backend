const mongoose = require("mongoose");
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  discipline: { type: mongoose.Schema.Types.ObjectId, ref: "Discipline" },
  description: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("Category", categorySchema);
