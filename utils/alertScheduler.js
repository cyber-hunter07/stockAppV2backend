const cron = require("node-cron");
const Equipment = require("../models/Equipment");
const AssetCode = require("../models/AssetCode");
const User = require("../models/User");
const { sendAlertEmail } = require("./emailService");
const SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE || "Asia/Kolkata";

async function checkAndSendAlerts() {
  try {
    const equipmentList = await Equipment.find();
    const lowStock = [];
    for (const e of equipmentList) {
      const qty = await AssetCode.countDocuments({ equipment: e._id, status: { $ne: "scrap" } });
      if (qty <= (e.lowStockThreshold || 2)) lowStock.push({ name: e.name, qty, threshold: e.lowStockThreshold });
    }

    if (lowStock.length === 0) {
      console.log("Alert check: nothing to report today.");
      return { emailsSent: 0, alertsFound: 0 };
    }

    const recipients = await User.find({ active: { $ne: false }, role: { $in: ["Administrator", "Store Manager"] } });
    if (recipients.length === 0) return { emailsSent: 0, alertsFound: lowStock.length };
    let message = "Daily Stock Alert Summary\n\nLOW STOCK:\n";
    lowStock.forEach((i) => {
      message += `- ${i.name}: ${i.qty} left (threshold ${i.threshold})\n`;
    });

    let emailsSent = 0;
    for (const user of recipients) {
      if (await sendAlertEmail(user.email, "Daily Stock Alert - Action Needed", message)) emailsSent += 1;
    }
    if (emailsSent !== recipients.length) throw new Error(`Alert delivery failed for ${recipients.length - emailsSent} recipient(s).`);
    console.log(`Alert emails sent to ${emailsSent} active recipient(s).`);
    return { emailsSent, alertsFound: lowStock.length };
  } catch (err) {
    console.error("Alert check failed:", err.message);
    throw err;
  }
}

function scheduleAlertChecks() {
  cron.schedule("0 8 * * *", () => {
    console.log("Running scheduled alert check...");
    checkAndSendAlerts().catch(() => {});
  }, { timezone: SCHEDULE_TIMEZONE });
  console.log(`Automated daily alert email scheduled (8:00 AM ${SCHEDULE_TIMEZONE})`);
}

module.exports = { checkAndSendAlerts, scheduleAlertChecks };
