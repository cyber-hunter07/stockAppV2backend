const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const { authenticate, authorize } = require("../middleware/auth");
const { runBackup, BACKUP_DIR } = require("../utils/backupService");
const { checkAndSendAlerts } = require("../utils/alertScheduler");
const mongoose = require("mongoose");
const { sendApiError } = require("../utils/apiErrors");
const restoreModels = {
  departments: require("../models/Department"), disciplines: require("../models/Discipline"), categories: require("../models/Category"),
  vendors: require("../models/Vendor"), equipment: require("../models/Equipment"), locations: require("../models/Location"),
  assetCodes: require("../models/AssetCode"), purchases: require("../models/Purchase"), maintenance: require("../models/Maintenance"),
  consumables: require("../models/Consumable"), quotations: require("../models/QuotationRequest"), scrapRequests: require("../models/ScrapRequest"),
  stockMovements: require("../models/StockMovement"), powerUnits: require("../models/PowerUnit"), auditLogs: require("../models/AuditLog"),
};
const CompanyProfile = require("../models/CompanyProfile");

async function replaceBackupData(backup, session, actorEmail = "system", restoreAudit = true) {
  const options = session ? { session } : {};
  const restoredCounts = {};
  for (const [key, Model] of Object.entries(restoreModels)) {
    await Model.deleteMany({}, options);
    if (backup[key].length) await Model.insertMany(backup[key], { ...options, ordered: true });
    restoredCounts[key] = backup[key].length;
  }
  await CompanyProfile.deleteMany({}, options);
  if (backup.companyProfile) await CompanyProfile.create([{ ...backup.companyProfile }], options);

  // Version 2 backups created before the legacy ledger was included keep live legacy data.
  if (Array.isArray(backup.legacyItems) && Array.isArray(backup.legacyStockTransactions)) {
    const legacyItems = backup.legacyItems.map((item) => ({
      ...item,
      _id: mongoose.isValidObjectId(item._id) ? new mongoose.Types.ObjectId(item._id) : item._id,
      category: mongoose.isValidObjectId(item.category) ? new mongoose.Types.ObjectId(item.category) : item.category,
      createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
    }));
    const legacyTransactions = backup.legacyStockTransactions.map((transaction) => ({
      ...transaction,
      _id: mongoose.isValidObjectId(transaction._id) ? new mongoose.Types.ObjectId(transaction._id) : transaction._id,
      item: mongoose.isValidObjectId(transaction.item) ? new mongoose.Types.ObjectId(transaction.item) : transaction.item,
      createdAt: transaction.createdAt ? new Date(transaction.createdAt) : transaction.createdAt,
      updatedAt: transaction.updatedAt ? new Date(transaction.updatedAt) : transaction.updatedAt,
    }));
    const itemsCollection = mongoose.connection.db.collection("items");
    const transactionsCollection = mongoose.connection.db.collection("stocktransactions");
    await itemsCollection.deleteMany({}, options);
    await transactionsCollection.deleteMany({}, options);
    if (legacyItems.length) await itemsCollection.insertMany(legacyItems, options);
    if (legacyTransactions.length) await transactionsCollection.insertMany(legacyTransactions, options);
    restoredCounts.legacyItems = legacyItems.length;
    restoredCounts.legacyStockTransactions = legacyTransactions.length;
  }
  if (restoreAudit) {
    await restoreModels.auditLogs.create([{
      action: "BACKUP_RESTORED", entity: "Database", performedBy: actorEmail,
      details: "Restored business data from a validated JSON backup; user accounts were retained.",
    }], options);
  }
  return restoredCounts;
}

// POST /api/backup/run - trigger a backup right now (Administrator only)
router.post("/api/backup/run", authenticate, authorize("Administrator"), async (req, res) => {
  try {
    const filename = await runBackup();
    res.json({ message: "Backup completed", filename });
  } catch (err) {
    res.status(500).json({ error: "Backup failed: " + err.message });
  }
});

router.post("/api/backup/restore", authenticate, authorize("Administrator"), async (req, res) => {
  const backup = req.body?.backup;
  const required = Object.keys(restoreModels);
  if (req.body?.confirmRestore !== true) return res.status(400).json({ error: "Confirm the restore in the review step before submitting." });
  if (!backup || backup.schemaVersion !== 2 || required.some((key) => !Array.isArray(backup[key]))) {
    return res.status(400).json({ error: "This backup is incomplete or uses an unsupported format. Restore a JSON backup created by this version of the application." });
  }
  if (JSON.stringify(backup).length > 25 * 1024 * 1024) return res.status(413).json({ error: "Backup file is larger than the 25 MB restore limit." });
  let recoveryFilename = "";
  let session;
  let rollbackFailed = false;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    let restoredCounts;
    if (hello.setName) {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        restoredCounts = await replaceBackupData(backup, session, req.user.email);
      });
    } else {
      // Standalone MongoDB does not support transactions. Keep an automatic recovery file
      // and in-memory snapshot, then roll back all collections if any replacement fails.
      recoveryFilename = await runBackup();
      const currentSnapshot = {};
      for (const [key, Model] of Object.entries(restoreModels)) currentSnapshot[key] = await Model.find().lean();
      currentSnapshot.companyProfile = await CompanyProfile.findOne().lean();
      currentSnapshot.legacyItems = await mongoose.connection.db.collection("items").find({}).toArray();
      currentSnapshot.legacyStockTransactions = await mongoose.connection.db.collection("stocktransactions").find({}).toArray();
      try {
        restoredCounts = await replaceBackupData(backup, null, req.user.email);
      } catch (error) {
        try { await replaceBackupData(currentSnapshot, null, req.user.email, false); }
        catch (rollbackError) { rollbackFailed = true; }
        throw error;
      }
    }
    res.json({ message: "Backup restored. Existing user accounts and passwords were retained.", restoredCounts, recoveryBackup: recoveryFilename || undefined });
  } catch (error) {
    if (rollbackFailed) {
      return res.status(500).json({ error: `Restore failed. Recovery backup saved as ${recoveryFilename}; automatic rollback also failed.` });
    }
    sendApiError(res, error, recoveryFilename ? `Restore failed; the recovery backup ${recoveryFilename} was retained and the current data was rolled back.` : "Restore failed. The current data was not changed.");
  } finally { if (session) await session.endSession(); }
});

// GET /api/backup/list - list available backup files (Administrator only)
router.get("/api/backup/list", authenticate, authorize("Administrator"), (req, res) => {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("backup-"))
    .sort()
    .reverse();
  res.json(files);
});

// GET /api/backup/download/:filename - download a specific backup file
router.get("/api/backup/download/:filename", authenticate, authorize("Administrator"), (req, res) => {
  if (!/^backup-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.json$/.test(req.params.filename)) return res.status(400).json({ error: "Invalid backup filename." });
  const filepath = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Backup not found" });
  res.download(filepath);
});

// POST /api/alerts/run-check - manually trigger the alert email check
router.post("/api/alerts/run-check", authenticate, authorize("Administrator", "Store Manager"), async (req, res) => {
  try {
    const result = await checkAndSendAlerts();
    res.json({ message: result.alertsFound ? `Alert check completed; sent ${result.emailsSent} email(s).` : "Alert check completed; no low-stock alerts were found.", ...result });
  } catch (err) {
    res.status(502).json({ error: "The alert check could not deliver all emails. Check the mail service configuration and logs." });
  }
});

module.exports = router;
