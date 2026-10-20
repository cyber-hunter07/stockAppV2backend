require("dotenv").config();
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]); // avoids SRV DNS issues on some ISPs/Windows setups

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/authRoutes");
const masterRoutes = require("./routes/masterRoutes");
const equipmentRoutes = require("./routes/equipmentRoutes");
const locationRoutes = require("./routes/locationRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const assetCodeRoutes = require("./routes/assetCodeRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const consumableRoutes = require("./routes/consumableRoutes");
const quotationRoutes = require("./routes/quotationRoutes");
const alertRoutes = require("./routes/alertRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const exportRoutes = require("./routes/exportRoutes");
const nlQueryRoutes = require("./routes/nlQueryRoutes");
const backupRoutes = require("./routes/backupRoutes");
const legacyStockRoutes = require("./routes/legacyStockRoutes");
const powerRoutes = require("./routes/powerRoutes");
const { scheduleBackups } = require("./utils/backupService");
const { scheduleAlertChecks } = require("./utils/alertScheduler");

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.CORS_ORIGIN || (isProduction ? "" : "http://localhost:3000"))
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);
if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be configured before starting the API.");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");
if (isProduction && allowedOrigins.length === 0) throw new Error("Set CORS_ORIGIN to the deployed frontend origin in production.");
if (isProduction && allowedOrigins.some((origin) => !origin.startsWith("https://"))) throw new Error("Production CORS_ORIGIN values must use HTTPS.");
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", trustProxyHops);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction && req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(cors({
  origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); },
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "database_unavailable" });
});

app.use(authRoutes);        // Authentication (JWT)
app.use(masterRoutes);      // Departments, Disciplines, Categories, Vendors, Company Profile, Users
app.use(equipmentRoutes);   // Equipment Master
app.use(locationRoutes);    // Locations
app.use(purchaseRoutes);    // Purchases -> auto-generates Asset Codes
app.use(assetCodeRoutes);   // Asset Codes register, Distribution, Stock Transfers, Scrap
app.use(maintenanceRoutes); // Maintenance
app.use(consumableRoutes);  // Consumables (toner/ink)
app.use(quotationRoutes);   // Quotation Requests
app.use(alertRoutes);       // Alerts & Notifications
app.use(dashboardRoutes);   // Dashboard & Reports + Audit Logs
app.use(exportRoutes);      // Export Data (CSV)
app.use(nlQueryRoutes);     // AI Natural Language Query Bot
app.use(backupRoutes);      // Backup Service + manual alert trigger
app.use(legacyStockRoutes); // Read-only compatibility view for legacy quantity-based stock
app.use(powerRoutes);       // UPS / power equipment register

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.code === 11000 ? 409
    : err.name === "ValidationError" || err.name === "CastError" || err instanceof SyntaxError ? 400
      : err.name === "MongoServerSelectionError" || err.name === "MongooseServerSelectionError" ? 503
        : Number.isInteger(err.status) ? err.status : 500;
  if (status === 500) console.error("API request failed:", err.name || "Error");
  res.status(status).json({ error: status === 500 ? "The request could not be completed. Please try again." : err.message });
});

app.get("/", (req, res) => {
  res.send("MVIT Stock Management System API is running.");
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    scheduleBackups();
    scheduleAlertChecks();
  })
  .catch((err) => console.error("MongoDB connection failed:", err.name || "Error", err.message || "No additional error details."));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
