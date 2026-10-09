const nodemailer = require("nodemailer");

// FREE option: use Gmail SMTP with an App Password (no paid service needed)
// Setup: https://myaccount.google.com/apppasswords
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendAlertEmail(to, subject, message) {
  try {
    await transporter.sendMail({
      from: `"Stock Management System" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: message,
    });
    return true;
  } catch (err) {
    console.error("Email send error:", err.message);
    return false;
  }
}

module.exports = { sendAlertEmail };
