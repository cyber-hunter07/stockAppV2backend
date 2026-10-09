const express = require("express");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Location = require("../models/Location");
const Department = require("../models/Department");
const AssetCode = require("../models/AssetCode");
const { authenticate, authorize } = require("../middleware/auth");
const { sendApiError } = require("../utils/apiErrors");
const mongoose = require("mongoose");
const canEdit = authorize("Administrator", "Store Manager");

router.get("/api/locations", authenticate, async (req, res) => {
  const list = await Location.find().populate("department", "code").sort({ name: 1 });
  const out = await Promise.all(
    list.map(async (l) => {
      const currentStock = await AssetCode.countDocuments({ location: l._id, status: { $ne: "scrap" } });
      return { ...l.toObject(), currentStock };
    })
  );
  res.json(out);
});

router.post("/api/locations", authenticate, canEdit, async (req, res) => {
  try {
    const { name, type, department, areaFloor, description } = req.body;
    if (!String(name || "").trim() || !String(type || "").trim()) return res.status(400).json({ error: "Location name and type are required." });
    if (department && !mongoose.isValidObjectId(department)) return res.status(400).json({ error: "Choose a valid department." });
    if (department && !await Department.exists({ _id: department })) return res.status(400).json({ error: "The selected department does not exist." });
    const location = await Location.create({ name: String(name).trim(), type: String(type).trim(), department: department || undefined, areaFloor: String(areaFloor || "").trim(), description: String(description || "").trim() });
    res.status(201).json(location);
  } catch (err) { sendApiError(res, err, "Could not create location."); }
});
router.put("/api/locations/:id", authenticate, canEdit, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid location id." });
    const changes = {};
    for (const key of ["name", "type", "department", "areaFloor", "description"]) if (req.body[key] !== undefined) changes[key] = req.body[key];
    for (const key of ["name", "type", "areaFloor", "description"]) if (changes[key] !== undefined) changes[key] = String(changes[key]).trim();
    if (changes.department && !mongoose.isValidObjectId(changes.department)) return res.status(400).json({ error: "Choose a valid department." });
    if (changes.department && !await Department.exists({ _id: changes.department })) return res.status(400).json({ error: "The selected department does not exist." });
    const location = await Location.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true }).populate("department", "code");
    if (!location) return res.status(404).json({ error: "Location not found." });
    res.json(location);
  } catch (err) { sendApiError(res, err, "Could not update location."); }
});
router.delete("/api/locations/:id", authenticate, authorize("Administrator"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid location id." });
  const location = await Location.findById(req.params.id);
  if (!location) return res.status(404).json({ error: "Location not found." });
  if (location.isCentralStore || location.isScrapStore) return res.status(409).json({ error: "System stock locations cannot be deleted." });
  if (await AssetCode.exists({ location: location._id })) return res.status(409).json({ error: "This location contains asset records and cannot be deleted." });
  await Location.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

module.exports = router;
