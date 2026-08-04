import { Router } from "express";
import * as db from "../db.js";
import { priceFor } from "../pricing.js";

/** Thống kê token AI đã dùng - cột token trong danh sách project + biểu đồ Dashboard. */
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

// GET /api/usage/by-model?days=30
// → [{ provider, model, tokensIn, tokensOut, costUsd, price, costInUsd, costOutUsd }]
//
// costUsd = tiền THẬT đã lưu. costInUsd/costOutUsd = quy đổi theo ĐƠN GIÁ NIÊM
// YẾT trong pricing.ts, nên hai bên lệch nhau là bình thường (prompt cache đọc
// lại chỉ tính ~10% giá vào). Model không có trong bảng giá thì price = null và
// hai ô $ cũng null - KHÔNG đoán giá.
router.get("/by-model", (req, res) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.max(1, raw)) : undefined;
  const rows = db.usageByModel(days).map((r) => {
    const price = priceFor(r.model, r.provider);
    return {
      ...r,
      price,
      costInUsd: price ? (r.tokensIn / 1e6) * price.inPerM : null,
      costOutUsd: price ? (r.tokensOut / 1e6) * price.outPerM : null,
    };
  });
  res.json(rows);
});

export default router;
