// Departments, Disciplines, Categories, Vendors, Company Profile, Users — simple master-data CRUD
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Department = require("../models/Department");
const Discipline = require("../models/Discipline");
const Category = require("../models/Category");
const Vendor = require("../models/Vendor");
const CompanyProfile = require("../models/CompanyProfile");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Location = require("../models/Location");
const AssetCode = require("../models/AssetCode");
const Equipment = require("../models/Equipment");
const Purchase = require("../models/Purchase");
const QuotationRequest = require("../models/QuotationRequest");
const { sendApiError } = require("../utils/apiErrors");
const { authenticate, authorize } = require("../middleware/auth");

const canEdit = authorize("Administrator", "Store Manager");

// ---- Departments ----
router.get("/api/departments", authenticate, async (req, res) => {
  const depts = await Department.find().sort({ code: 1 });
  // attach location count + items held count for dashboard-style table
  const out = await Promise.all(
    depts.map(async (d) => {
      const locations = await Location.countDocuments({ department: d._id });
      const items = await AssetCode.countDocuments({ department: d._id, status: { $ne: "scrap" } });
      return { ...d.toObject(), locationCount: locations, itemCount: items };
    })
  );
  res.json(out);
});
router.post("/api/departments", authenticate, canEdit, async (req, res) => {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    const description = String(req.body.description || "").trim();
    if (!/^[A-Z0-9-]{2,12}$/.test(code) || !description) return res.status(400).json({ error: "Enter a 2–12 character department code and description." });
    res.status(201).json(await Department.create({ code, description, headOfDept: String(req.body.headOfDept || "").trim() }));
  } catch (err) { sendApiError(res, err, "Could not create department."); }
});
router.put("/api/departments/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid department id." });
    const changes = {};
    if (req.body.code !== undefined) changes.code = String(req.body.code).trim().toUpperCase();
    if (req.body.description !== undefined) changes.description = String(req.body.description).trim();
    if (req.body.headOfDept !== undefined) changes.headOfDept = String(req.body.headOfDept).trim();
    const department = await Department.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
    if (!department) return res.status(404).json({ error: "Department not found." });
    res.json(department);
  } catch (err) { sendApiError(res, err, "Could not update department."); }
});
router.delete("/api/departments/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid department id." });
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: "Department not found." });
  const [locations, users, assets] = await Promise.all([
    Location.exists({ department: department._id }), User.exists({ department: department._id }), AssetCode.exists({ department: department._id }),
  ]);
  if (locations || users || assets) return res.status(409).json({ error: "This department is linked to locations, users, or asset records and cannot be deleted." });
  await Department.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

// ---- Disciplines ----
router.get("/api/disciplines", authenticate, async (req, res) => {
  res.json(await Discipline.find().sort({ name: 1 }));
});
router.post("/api/disciplines", authenticate, canEdit, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "").trim().toLowerCase();
    if (!name || !/^[a-z0-9-]{2,32}$/.test(code)) return res.status(400).json({ error: "Enter a discipline name and a 2–32 character code." });
    res.status(201).json(await Discipline.create({ name, code }));
  } catch (err) { sendApiError(res, err, "Could not create discipline."); }
});
router.delete("/api/disciplines/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid discipline id." });
  if (await Category.exists({ discipline: req.params.id })) return res.status(409).json({ error: "This discipline is used by categories and cannot be deleted." });
  await Discipline.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

// ---- Categories ----
router.get("/api/categories", authenticate, async (req, res) => {
  const Equipment = require("../models/Equipment");
  const AssetCode = require("../models/AssetCode");
  const cats = await Category.find().populate("discipline", "name").sort({ name: 1 });
  const out = await Promise.all(
    cats.map(async (c) => {
      const equipmentIds = await Equipment.find({ category: c._id }).distinct("_id");
      const equipmentTypes = equipmentIds.length;
      const codes = await AssetCode.find({ equipment: { $in: equipmentIds }, status: { $ne: "scrap" } });
      const totalItems = codes.length;
      const totalValue = codes.reduce((s, x) => s + (x.unitCost || 0), 0);
      return { ...c.toObject(), equipmentTypes, totalItems, totalValue };
    })
  );
  res.json(out);
});
router.post("/api/categories", authenticate, canEdit, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Category name is required." });
    if (req.body.discipline && !mongoose.isValidObjectId(req.body.discipline)) return res.status(400).json({ error: "Choose a valid discipline." });
    if (req.body.discipline && !await Discipline.exists({ _id: req.body.discipline })) return res.status(400).json({ error: "The selected discipline does not exist." });
    res.status(201).json(await Category.create({ name, discipline: req.body.discipline || undefined, description: String(req.body.description || "").trim() }));
  } catch (err) { sendApiError(res, err, "Could not create category."); }
});
router.put("/api/categories/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid category id." });
    const changes = {};
    if (req.body.name !== undefined) changes.name = String(req.body.name).trim();
    if (req.body.description !== undefined) changes.description = String(req.body.description).trim();
    if (req.body.discipline !== undefined) changes.discipline = req.body.discipline || undefined;
    if (changes.discipline && !mongoose.isValidObjectId(changes.discipline)) return res.status(400).json({ error: "Choose a valid discipline." });
    if (changes.discipline && !await Discipline.exists({ _id: changes.discipline })) return res.status(400).json({ error: "The selected discipline does not exist." });
    const category = await Category.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true }).populate("discipline", "name");
    if (!category) return res.status(404).json({ error: "Category not found." });
    res.json(category);
  } catch (err) { sendApiError(res, err, "Could not update category."); }
});
router.delete("/api/categories/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid category id." });
  if (await Equipment.exists({ category: req.params.id })) return res.status(409).json({ error: "This category is used by equipment types and cannot be deleted." });
  await Category.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

// ---- Vendors ----
router.get("/api/vendors", authenticate, async (req, res) => {
  res.json(await Vendor.find().sort({ companyName: 1 }));
});
router.post("/api/vendors", authenticate, canEdit, async (req, res) => {
  try {
    const companyName = String(req.body.companyName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!companyName) return res.status(400).json({ error: "Vendor company name is required." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid vendor email address." });
    if (req.body.pincode && !/^\d{6}$/.test(String(req.body.pincode).trim())) return res.status(400).json({ error: "Pincode must contain 6 digits." });
    const fields = ["gstNumber", "contactPerson", "address", "city", "state", "pincode", "phone", "mobile", "website", "remarks"];
    const vendor = { companyName, email };
    for (const field of fields) vendor[field] = String(req.body[field] || "").trim();
    res.status(201).json(await Vendor.create(vendor));
  } catch (err) { sendApiError(res, err, "Could not create vendor."); }
});
router.put("/api/vendors/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid vendor id." });
    const changes = {};
    for (const field of ["companyName", "gstNumber", "contactPerson", "address", "city", "state", "pincode", "phone", "mobile", "email", "website", "remarks", "active"]) {
      if (req.body[field] !== undefined) changes[field] = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
    }
    if (changes.companyName !== undefined && !changes.companyName) return res.status(400).json({ error: "Vendor company name is required." });
    if (changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) return res.status(400).json({ error: "Enter a valid vendor email address." });
    if (changes.pincode && !/^\d{6}$/.test(changes.pincode)) return res.status(400).json({ error: "Pincode must contain 6 digits." });
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
    if (!vendor) return res.status(404).json({ error: "Vendor not found." });
    res.json(vendor);
  } catch (err) { sendApiError(res, err, "Could not update vendor."); }
});
router.delete("/api/vendors/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid vendor id." });
  const [purchase, quotation] = await Promise.all([Purchase.exists({ vendor: req.params.id }), QuotationRequest.exists({ vendor: req.params.id })]);
  if (purchase || quotation) return res.status(409).json({ error: "This vendor is referenced by a purchase or quotation. Mark it inactive instead." });
  await Vendor.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

// ---- Company Profile (singleton) ----
router.get("/api/company-profile", authenticate, async (req, res) => {
  let profile = await CompanyProfile.findOne();
  if (!profile) profile = await CompanyProfile.create({});
  res.json(profile);
});
router.put("/api/company-profile", authenticate, authorize("Administrator"), async (req, res) => {
  try {
    const changes = {};
    for (const field of ["name", "subtitle", "orgCode", "address", "phone", "email"]) if (req.body[field] !== undefined) changes[field] = String(req.body[field]).trim();
    if (changes.name !== undefined && !changes.name) return res.status(400).json({ error: "Institute name is required." });
    if (changes.orgCode !== undefined && !/^[A-Z0-9-]{2,8}$/.test(changes.orgCode.toUpperCase())) return res.status(400).json({ error: "Asset prefix must contain 2–8 letters, numbers, or hyphens." });
    if (changes.orgCode) changes.orgCode = changes.orgCode.toUpperCase();
    if (changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) return res.status(400).json({ error: "Enter a valid institute email address." });
    const profile = await CompanyProfile.findOneAndUpdate({}, { $set: changes }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
    res.json(profile);
  } catch (err) { sendApiError(res, err, "Could not save company profile."); }
});

// ---- Users (Administrator management) ----
router.get("/api/users", authenticate, authorize("Administrator"), async (req, res) => {
  res.json(await User.find().select("-password").populate("department", "code description"));
});
router.post("/api/users", authenticate, authorize("Administrator"), async (req, res) => {
  try {
    const { name, username, email, password, role, department } = req.body;
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanUsername = String(username || "").trim().toLowerCase();
    if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a name and a valid email address." });
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: "Username must be 3–30 letters, numbers, dots, underscores, or hyphens." });
    }
    if (String(password || "").length < 8) return res.status(400).json({ error: "Password must contain at least 8 characters." });
    if (!["Administrator", "Store Manager", "Department User"].includes(role)) return res.status(400).json({ error: "Choose a valid role." });
    if (department && !mongoose.isValidObjectId(department)) return res.status(400).json({ error: "Choose a valid department." });
    if (department && !await Department.exists({ _id: department })) return res.status(400).json({ error: "The selected department does not exist." });
    const conflict = await User.findOne({ $or: [{ email: cleanEmail }, { username: cleanUsername }] }).select("_id");
    if (conflict) return res.status(409).json({ error: "Email or username is already in use." });
    const user = await User.create({ name: cleanName, username: cleanUsername, email: cleanEmail, password, role, department: department || undefined });
    await AuditLog.create({ action: "USER_CREATED", entity: "User", entityId: user._id, performedBy: req.user.email, details: `Created account ${cleanUsername} (${role})` });
    res.status(201).json({ _id: user._id, name: user.name, username: user.username, email: user.email, role: user.role, department: user.department, active: user.active });
  } catch (err) {
    const status = err.code === 11000 ? 409 : err.name === "ValidationError" || err.name === "CastError" ? 400 : 500;
    res.status(status).json({ error: status === 500 ? "Could not create user." : err.message });
  }
});
router.put("/api/users/:id", authenticate, authorize("Administrator"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid user id." });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    const role = req.body.role ?? user.role;
    const active = req.body.active ?? user.active;
    const department = req.body.department === undefined ? user.department : req.body.department;
    if (!["Administrator", "Store Manager", "Department User"].includes(role)) return res.status(400).json({ error: "Choose a valid role." });
    if (department && !mongoose.isValidObjectId(department)) return res.status(400).json({ error: "Choose a valid department." });
    if (department && !await Department.exists({ _id: department })) return res.status(400).json({ error: "The selected department does not exist." });
    const removesAdmin = user.role === "Administrator" && (role !== "Administrator" || active === false);
    if (removesAdmin && await User.countDocuments({ role: "Administrator", active: true }) <= 1) {
      return res.status(409).json({ error: "At least one active Administrator must remain." });
    }
    user.role = role;
    user.active = active;
    user.department = department || undefined;
    await user.save();
    await AuditLog.create({ action: "USER_UPDATED", entity: "User", entityId: user._id, performedBy: req.user.email, details: `Updated account ${user.username || user.email}` });
    res.json({ _id: user._id, name: user.name, username: user.username, email: user.email, role: user.role, department: user.department, active: user.active });
  } catch (err) {
    const status = err.code === 11000 ? 409 : err.name === "ValidationError" || err.name === "CastError" ? 400 : 500;
    res.status(status).json({ error: status === 500 ? "Could not update user." : err.message });
  }
});
router.delete("/api/users/:id", authenticate, authorize("Administrator"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid user id." });
    if (String(req.user.id) === String(req.params.id)) return res.status(409).json({ error: "You cannot delete your own account." });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "Administrator" && user.active && await User.countDocuments({ role: "Administrator", active: true }) <= 1) {
      return res.status(409).json({ error: "At least one active Administrator must remain." });
    }
    await User.findByIdAndDelete(req.params.id);
    await AuditLog.create({ action: "USER_DELETED", entity: "User", entityId: user._id, performedBy: req.user.email, details: `Deleted account ${user.username || user.email}` });
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ error: "Could not delete user." }); }
});

module.exports = router;
