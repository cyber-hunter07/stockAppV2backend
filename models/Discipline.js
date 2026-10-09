const mongoose = require("mongoose");
const disciplineSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true }, // e.g. "Computer & IT"
  code: { type: String, required: true, unique: true, lowercase: true, trim: true }, // e.g. "computer"
}, { timestamps: true });
module.exports = mongoose.model("Discipline", disciplineSchema);
