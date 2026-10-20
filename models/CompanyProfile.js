const mongoose = require("mongoose");
const companyProfileSchema = new mongoose.Schema({
  name: { type: String, default: "Manakula Vinayagar Institute of Technology" },
  subtitle: { type: String, default: "An Autonomous Institution | Puducherry" },
  orgCode: { type: String, default: "SIT" }, // used as asset-code prefix e.g. SIT-DESK-062024-001
  address: { type: String, default: "" },
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  principalSignature: { type: String, default: "" },
  hodSignature: { type: String, default: "" },
}, { timestamps: true });
module.exports = mongoose.model("CompanyProfile", companyProfileSchema);
