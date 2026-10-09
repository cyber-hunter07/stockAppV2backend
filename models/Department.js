const mongoose = require("mongoose");
const departmentSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. CSE, ECE
  description: { type: String, required: true }, // e.g. "Computer Science and Engineering"
  headOfDept: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("Department", departmentSchema);
