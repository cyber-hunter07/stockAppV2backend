const mongoose = require("mongoose");
const vendorSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  gstNumber: { type: String, default: "" },
  contactPerson: { type: String, default: "" },
  address: { type: String, default: "" },
  city: { type: String, default: "" },
  state: { type: String, default: "" },
  pincode: { type: String, default: "" },
  phone: { type: String, default: "" },
  mobile: { type: String, default: "" },
  email: { type: String, default: "" },
  website: { type: String, default: "" },
  remarks: { type: String, default: "" },
  active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model("Vendor", vendorSchema);
