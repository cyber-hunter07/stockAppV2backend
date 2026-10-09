const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const User = require("../models/User");
const Department = require("../models/Department");
const Discipline = require("../models/Discipline");
const Category = require("../models/Category");
const Vendor = require("../models/Vendor");
const Equipment = require("../models/Equipment");
const Location = require("../models/Location");
const AssetCode = require("../models/AssetCode");
const Purchase = require("../models/Purchase");
const Maintenance = require("../models/Maintenance");
const Consumable = require("../models/Consumable");
const QuotationRequest = require("../models/QuotationRequest");
const AuditLog = require("../models/AuditLog");
const ScrapRequest = require("../models/ScrapRequest");
const StockMovement = require("../models/StockMovement");
const PowerUnit = require("../models/PowerUnit");
const CompanyProfile = require("../models/CompanyProfile");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || "Asia/Kolkata";
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

async function runBackup() {
  try {
    const data = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      users: await User.find().select("-password"),
      departments: await Department.find(),
      disciplines: await Discipline.find(),
      categories: await Category.find(),
      vendors: await Vendor.find(),
      equipment: await Equipment.find(),
      locations: await Location.find(),
      assetCodes: await AssetCode.find(),
      purchases: await Purchase.find(),
      maintenance: await Maintenance.find(),
      consumables: await Consumable.find(),
      quotations: await QuotationRequest.find(),
      scrapRequests: await ScrapRequest.find(),
      stockMovements: await StockMovement.find(),
      powerUnits: await PowerUnit.find(),
      companyProfile: await CompanyProfile.findOne(),
      auditLogs: await AuditLog.find(),
      legacyItems: await require("mongoose").connection.db.collection("items").find({}).toArray(),
      legacyStockTransactions: await require("mongoose").connection.db.collection("stocktransactions").find({}).toArray(),
    };

    const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
    const filename = `backup-${stamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

    console.log(`Backup completed: ${filename}`);
    cleanOldBackups();
    return filename;
  } catch (err) {
    console.error("Backup failed:", err.message);
    throw err;
  }
}

function cleanOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("backup-")).sort();
  while (files.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
}

function scheduleBackups() {
  cron.schedule("0 2 * * *", () => {
    console.log("Running scheduled backup...");
    runBackup().catch(() => {});
  }, { timezone: SCHEDULE_TIMEZONE });
  console.log(`Automated daily backup scheduled (2:00 AM ${SCHEDULE_TIMEZONE})`);
}

module.exports = { runBackup, scheduleBackups, BACKUP_DIR };
