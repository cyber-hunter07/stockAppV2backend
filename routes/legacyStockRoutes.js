const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
require("../utils/routeAsync").bindAsyncRoutes(router);
const { authenticate } = require("../middleware/auth");

router.get("/api/legacy-stock", authenticate, async (req, res) => {
  const db = mongoose.connection.db;
  const [items, transactions, ledgerTotals] = await Promise.all([
    db.collection("items").find({}, { projection: { itemName: 1, category: 1, location: 1, quantity: 1, unit: 1, lowStockThreshold: 1, createdAt: 1 } }).sort({ itemName: 1 }).toArray(),
    db.collection("stocktransactions").find({}, { projection: { item: 1, type: 1, quantity: 1, purchaseRef: 1, issuedTo: 1, fromLocation: 1, toLocation: 1, reason: 1, condition: 1, performedBy: 1, notes: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(1000).toArray(),
    db.collection("stocktransactions").aggregate([{ $group: {
      _id: "$item",
      stockIn: { $sum: { $cond: [{ $eq: ["$type", "stock_in"] }, { $ifNull: ["$quantity", 0] }, 0] } },
      stockOut: { $sum: { $cond: [{ $eq: ["$type", "stock_out"] }, { $ifNull: ["$quantity", 0] }, 0] } },
      transactionCount: { $sum: 1 },
    } }]).toArray(),
  ]);
  const categoryIds = [...new Set(items.map((item) => item.category).filter((id) => id && mongoose.isValidObjectId(id.toString())).map((id) => id.toString()))].map((id) => new mongoose.Types.ObjectId(id));
  const categories = categoryIds.length ? await db.collection("categories").find({ _id: { $in: categoryIds } }, { projection: { name: 1 } }).toArray() : [];
  const categoryNames = new Map(categories.map((category) => [category._id.toString(), category.name]));
  const ledgerByItem = new Map(ledgerTotals.filter((row) => row._id).map((row) => [row._id.toString(), { stockIn: row.stockIn || 0, stockOut: row.stockOut || 0, transactionCount: row.transactionCount || 0 }]));
  const itemNames = new Map(items.map((item) => [item._id.toString(), item.itemName]));
  res.json({
    items: items.map((item) => {
      const ledger = ledgerByItem.get(item._id.toString()) || { stockIn: 0, stockOut: 0, transactionCount: 0 };
      // The legacy transaction collection may start after the item was created.
      // Without an explicit openingQuantity, its net is a change, not the current balance.
      const ledgerNet = ledger.stockIn - ledger.stockOut;
      const quantity = Number(item.quantity) || 0;
      const hasOpeningQuantity = item.openingQuantity !== undefined && item.openingQuantity !== null && Number.isFinite(Number(item.openingQuantity));
      const openingQuantity = hasOpeningQuantity ? Number(item.openingQuantity) : null;
      const reconciles = hasOpeningQuantity ? openingQuantity + ledgerNet === quantity : null;
      return { _id: item._id, itemName: item.itemName, categoryName: categoryNames.get(item.category?.toString()) || "—", location: item.location || "—", quantity, unit: item.unit || "units", lowStockThreshold: Number(item.lowStockThreshold) || 0, ...ledger, ledgerNet, openingQuantity, reconciles };
    }),
    transactions: transactions.map((transaction) => ({
      _id: transaction._id, itemName: itemNames.get(transaction.item?.toString()) || "Unknown legacy item",
      type: transaction.type, quantity: Number(transaction.quantity) || 0, purchaseRef: transaction.purchaseRef || "",
      issuedTo: transaction.issuedTo || "", fromLocation: transaction.fromLocation || "", toLocation: transaction.toLocation || "",
      reason: transaction.reason || "", condition: transaction.condition || "", performedBy: transaction.performedBy || "",
      notes: transaction.notes || "", createdAt: transaction.createdAt,
    })),
  });
});

module.exports = router;
