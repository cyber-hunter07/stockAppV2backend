const express = require("express");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Equipment = require("../models/Equipment");
const AssetCode = require("../models/AssetCode");
const { authenticate } = require("../middleware/auth");
const { sendAlertEmail } = require("../utils/emailService");

// GET /api/alerts/low-stock - equipment types where in-store qty <= threshold
router.get("/api/alerts/low-stock", authenticate, async (req, res) => {
  const equipmentList = await Equipment.find().populate("category", "name");
  const low = [];
  for (const e of equipmentList) {
    const qty = await AssetCode.countDocuments({ equipment: e._id, status: { $ne: "scrap" } });
    if (qty <= (e.lowStockThreshold || 2)) {
      low.push({ _id: e._id, itemName: e.name, category: e.category, quantity: qty, lowStockThreshold: e.lowStockThreshold });
    }
  }
  res.json(low);
});

router.post("/api/alerts/notify", authenticate, async (req, res) => {
  const { to, subject, message } = req.body;
  const sent = await sendAlertEmail(to, subject, message);
  if (!sent) return res.status(500).json({ error: "Failed to send email" });
  res.json({ message: "Notification sent" });
});

module.exports = router;
