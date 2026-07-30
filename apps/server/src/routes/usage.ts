import { Router } from "express";
import * as db from "../db.js";

/** Thống kê token AI đã dùng — cột token trong danh sách project + biểu đồ Dashboard. */
const router = Router();

// GET /api/usage/summary → { byProject: { <id>: { tokens, costUsd } }, total: { tokens, costUsd, tokensIn, tokensOut } }
router.get("/summary", (_req, res) => {
  res.json({ byProject: db.tokensByProject(), total: db.usageTotals() });
});

// GET /api/usage/timeline?days=30&scope=all|video|image
// → [{ date, tokens, tokensIn, tokensOut, costUsd, byProvider }]
router.get("/timeline", (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const scope: db.UsageScope =
    req.query.scope === "video" || req.query.scope === "image" ? req.query.scope : "all";
  res.json(db.usageTimeline(days, scope));
});

export default router;
