const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { authenticate } = require("../middleware/auth");
const failedLoginWindows = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;

function limitLoginAttempts(req, res, next) {
  const identifier = String(req.body.identifier || req.body.email || "").trim().toLowerCase();
  const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${identifier}`;
  const now = Date.now();
  const current = failedLoginWindows.get(key);
  if (current && current.expiresAt <= now) failedLoginWindows.delete(key);
  const active = failedLoginWindows.get(key);
  if (active && active.count >= LOGIN_ATTEMPT_LIMIT) {
    res.set("Retry-After", String(Math.ceil((active.expiresAt - now) / 1000)));
    return res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  }
  req.loginAttemptKey = key;
  next();
}

function recordFailedLogin(req) {
  const now = Date.now();
  const current = failedLoginWindows.get(req.loginAttemptKey);
  if (!current || current.expiresAt <= now) {
    failedLoginWindows.set(req.loginAttemptKey, { count: 1, expiresAt: now + LOGIN_WINDOW_MS });
  } else current.count += 1;
  if (failedLoginWindows.size > 10000) {
    for (const [key, entry] of failedLoginWindows) if (entry.expiresAt <= now) failedLoginWindows.delete(key);
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// POST /api/auth/register  (Administrator creates users; for first setup, allow open register)
router.get("/api/auth/setup-status", async (req, res) => {
  res.json({ needsSetup: (await User.estimatedDocumentCount()) === 0 });
});

router.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, email, password, role, department } = req.body;
    const existingUsers = await User.estimatedDocumentCount();
    if (existingUsers > 0) {
      return res.status(403).json({ error: "Public registration is closed. Ask an administrator to create your account." });
    }
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!String(name || "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || String(password || "").length < 8) {
      return res.status(400).json({ error: "Enter a name, valid email, and password with at least 8 characters." });
    }
    if (username && !/^[a-z0-9._-]{3,30}$/i.test(String(username).trim())) {
      return res.status(400).json({ error: "Username must be 3–30 letters, numbers, dots, underscores, or hyphens." });
    }
    if (role && role !== "Administrator") {
      return res.status(400).json({ error: "The first account must be an Administrator." });
    }
    const existing = await User.findOne({ $or: [{ email: cleanEmail }, ...(username ? [{ username: String(username).trim().toLowerCase() }] : [])] });
    if (existing) return res.status(409).json({ error: "Email or username is already registered." });

    const user = await User.create({ name: String(name).trim(), username, email, password, role: "Administrator", department });
    await AuditLog.create({
      action: "USER_REGISTERED",
      entity: "User",
      entityId: user._id,
      performedBy: cleanEmail,
    });

    res.status(201).json({ token: generateToken(user), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    const status = err.code === 11000 ? 409 : err.name === "ValidationError" || err.name === "CastError" ? 400 : 500;
    res.status(status).json({ error: status === 500 ? "Could not create account." : err.message });
  }
});

// POST /api/auth/login
router.post("/api/auth/login", limitLoginAttempts, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || req.body.email || "").trim();
    const password = req.body.password;
    if (!identifier || !password) return res.status(400).json({ error: "Enter your username or email and password." });
    const normalized = identifier.toLowerCase();
    let user = await User.findOne({ $or: [{ email: normalized }, { username: normalized }] });
    if (!user && !normalized.includes("@")) {
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      user = await User.findOne({ email: new RegExp(`^${escaped}@`, "i") });
    }
    if (!user || user.active === false || !(await user.comparePassword(password))) {
      recordFailedLogin(req);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    failedLoginWindows.delete(req.loginAttemptKey);
    await AuditLog.create({ action: "LOGIN", performedBy: user.email });

    res.json({
      token: generateToken(user),
      user: { name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

// GET /api/auth/me - verify token & get current user
router.get("/api/auth/me", authenticate, (req, res) => {
  res.json(req.user);
});

module.exports = router;
