const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Verifies the JWT token from the Authorization header.
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;

  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("name username email role department active");
    if (!user || user.active === false) return res.status(401).json({ error: "Account is unavailable. Sign in again or contact an administrator." });
    req.user = { id: user._id, name: user.name, username: user.username, email: user.email, role: user.role, department: user.department };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    return res.status(503).json({ error: "Authentication is temporarily unavailable. Please try again." });
  }
}

// Restricts a route to specific roles, e.g. authorize("Administrator", "Store Manager")
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
