const express = require("express");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const Equipment = require("../models/Equipment");
const Location = require("../models/Location");
const AssetCode = require("../models/AssetCode");
const Purchase = require("../models/Purchase");
const Department = require("../models/Department");
const Maintenance = require("../models/Maintenance");
const Consumable = require("../models/Consumable");
const AuditLog = require("../models/AuditLog");
const { authenticate } = require("../middleware/auth");

router.get("/api/dashboard/overview", authenticate, async (req, res) => {
  try {
    const equipmentTypes = await Equipment.countDocuments();
    const locations = await Location.countDocuments();
    const totalStockItems = await AssetCode.countDocuments({ status: { $ne: "scrap" } });
    const maintenanceOpen = await Maintenance.countDocuments({ status: { $ne: "resolved" } });
    const systemsNotWorking = await AssetCode.countDocuments({ status: "maintenance" });

    const allCodes = await AssetCode.find({ status: { $ne: "scrap" } });
    const totalInvestment = allCodes.reduce((s, c) => s + (c.unitCost || 0), 0);

    const scrapLoc = await Location.findOne({ isScrapStore: true });
    const scrapCount = scrapLoc ? await AssetCode.countDocuments({ location: scrapLoc._id }) : 0;

    // Department-wise equipment summary (category totals per department)
    const departments = await Department.find();
    const deptSummary = await Promise.all(
      departments.map(async (d) => {
        const codes = await AssetCode.find({ department: d._id, status: { $ne: "scrap" } }).populate({
          path: "equipment", populate: { path: "category", select: "name" },
        });
        const byCategory = {};
        let value = 0;
        codes.forEach((c) => {
          const cat = c.equipment?.category?.name || "Other";
          byCategory[cat] = (byCategory[cat] || 0) + 1;
          value += c.unitCost || 0;
        });
        return { department: d.code, description: d.description, byCategory, qty: codes.length, value };
      })
    );

    // Stock distribution by location
    const locs = await Location.find();
    const stockByLocation = await Promise.all(
      locs.map(async (l) => {
        const currentStock = await AssetCode.countDocuments({ location: l._id, status: { $ne: "scrap" } });
        const totalReceived = l.isCentralStore
          ? await AssetCode.countDocuments({ location: l._id })
          : 0;
        return { _id: l._id, location: l.name, currentStock, totalReceived };
      })
    );

    // Equipment mix (top categories by total qty)
    const equipmentList = await Equipment.find().populate("category", "name");
    const mix = await Promise.all(
      equipmentList.map(async (e) => {
        const qty = await AssetCode.countDocuments({ equipment: e._id, status: { $ne: "scrap" } });
        return { name: e.name, qty };
      })
    );
    const totalMixQty = mix.reduce((s, m) => s + m.qty, 0);

    // Recent purchases
    const recentPurchases = await Purchase.find().sort({ purchaseDate: -1 }).limit(5).populate("items.equipment", "name");

    // Scrap value (sum of unit cost of items currently in scrap)
    const scrapItems = scrapLoc ? await AssetCode.find({ location: scrapLoc._id }) : [];
    const scrapValue = scrapItems.reduce((s, c) => s + (c.unitCost || 0), 0);

    // Toner/consumables summary
    const allConsumables = await Consumable.find().populate("equipment", "name").populate("assetCode", "code location");
    const needToner = allConsumables.filter((c) => c.status === "needs_toner").length;
    const installed = allConsumables.filter((c) => c.status === "installed").length;
    const thisMonth = allConsumables.filter((c) => {
      const d = new Date(c.installedDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const spentThisYear = allConsumables
      .filter((c) => new Date(c.installedDate).getFullYear() === new Date().getFullYear())
      .reduce((s, c) => s + (c.cost || 0), 0);

    const modelMap = {};
    allConsumables.forEach((c) => {
      if (!modelMap[c.modelName]) modelMap[c.modelName] = { model: c.modelName, printers: 0, used: 0, totalCost: 0, lastFitted: null };
      modelMap[c.modelName].used += 1;
      modelMap[c.modelName].totalCost += c.cost || 0;
      if (!modelMap[c.modelName].lastFitted || new Date(c.installedDate) > new Date(modelMap[c.modelName].lastFitted)) {
        modelMap[c.modelName].lastFitted = c.installedDate;
      }
    });
    const tonerModels = Object.values(modelMap).map((m) => ({ ...m, avgCost: m.used ? Math.round(m.totalCost / m.used) : 0 }));

    const awaitingToner = allConsumables
      .filter((c) => c.status === "needs_toner")
      .map((c) => ({
        printer: c.assetCode?.code || "-", modelNeeded: c.modelName,
        installedDate: c.installedDate,
      }));

    res.json({
      equipmentTypes, locations, totalStockItems, maintenanceOpen, systemsNotWorking,
      totalInvestment, scrapCount, scrapValue,
      deptSummary, stockByLocation,
      equipmentMix: mix.filter((m) => m.qty > 0).sort((a, b) => b.qty - a.qty),
      totalMixQty,
      recentPurchases,
      toner: { needToner, installed, thisMonth, spentThisYear, models: tonerModels, awaitingToner },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/audit-logs", authenticate, async (req, res) => {
  res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(200));
});

module.exports = router;
