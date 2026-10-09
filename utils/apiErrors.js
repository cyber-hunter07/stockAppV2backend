function sendApiError(res, error, fallback = "The request could not be completed.") {
  if (error?.code === 11000) return res.status(409).json({ error: "A record with this value already exists." });
  if (error?.name === "ValidationError") {
    const fields = Object.values(error.errors || {}).map((item) => ({ field: item.path, message: item.message }));
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }
  if (error?.name === "CastError") return res.status(400).json({ error: `Invalid value for ${error.path}.` });
  if (error?.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("API request failed:", error?.name || "Error");
  return res.status(500).json({ error: fallback });
}

module.exports = { sendApiError };
