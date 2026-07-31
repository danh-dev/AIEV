import os from "node:os";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { SERVER_PORT, ensureBaseDirs, isAllowedWebOrigin, repoRoot } from "./config.js";
import { autoResumeStartup } from "./agent.js";
import { failStaleRunningJobs } from "./db.js";
import { addSseClient } from "./events.js";
import { HttpError } from "./util.js";

import healthRouter from "./routes/health.js";
import overviewRouter from "./routes/overview.js";
import projectsRouter from "./routes/projects.js";
import jobsRouter from "./routes/jobs.js";
import skillsRouter from "./routes/skills.js";
import sfxRouter from "./routes/sfx.js";
import musicRouter from "./routes/music.js";
import assetsRouter from "./routes/assets.js";
import chatRouter from "./routes/chat.js";
import promptsRouter from "./routes/prompts.js";
import usageRouter from "./routes/usage.js";
import providersRouter from "./routes/providers.js";
import stylesRouter from "./routes/stylesRoute.js";
import imagesRouter from "./routes/images.js";
import connectionsRouter from "./routes/connections.js";
import renderSettingsRouter from "./routes/renderSettingsRoute.js";
import illustrationsRouter from "./routes/illustrations.js";
import thumbnailsRouter from "./routes/thumbnails.js";
import updateRouter from "./routes/update.js";
import revealRouter from "./routes/reveal.js";
import { GRADE_PRESETS } from "./color.js";
import mediaRouter from "./routes/media.js";

ensureBaseDirs();
// Job còn treo "running" từ lần chạy trước (server bị tắt giữa chừng) → failed
failStaleRunningJobs();

const app = express();
app.disable("x-powered-by");

// CORS cho web UI :6868 — localhost (dev/debug) + IP LAN private (trang /m
// trên điện thoại upload file lớn gọi thẳng backend, không qua proxy Next)
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && isAllowedWebOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: "20mb" }));

// SSE — một stream chung cho job/joblog/agent
app.get("/api/events", addSseClient);

app.use("/api/health", healthRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/projects", projectsRouter);
// POST /api/projects/:id/thumbnail — projectsRouter không match nên rơi xuống đây
app.use("/api/projects", thumbnailsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/sfx", sfxRouter);
app.use("/api/music", musicRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/usage", usageRouter);
app.use("/api/providers", providersRouter);
app.use("/api/styles", stylesRouter);
app.use("/api/images", imagesRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/render-settings", renderSettingsRouter);
app.use("/api/illustrations", illustrationsRouter);
app.use("/api/update", updateRouter);
app.use("/api/reveal", revealRouter);

// Danh sách preset màu — UI dùng làm nguồn nhãn duy nhất (đồng bộ với color.ts)
app.get("/api/grade-presets", (_req: Request, res: Response) => {
  res.json(GRADE_PRESETS.map((p) => ({ id: p.id, label: p.label })));
});

// Thông tin LAN cho tính năng "Kết nối điện thoại" — QR trỏ http://<ip>:6868/m/<id>.
// IPv4 non-internal, ưu tiên dải LAN quen thuộc (192.168 → 10. → 172.) lên đầu.
app.get("/api/lan-info", (_req: Request, res: Response) => {
  const ips: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
    }
  }
  const rank = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3;
  ips.sort((a, b) => rank(a) - rank(b));
  res.json({ ips, webPort: Number(process.env.WEB_PORT || 6868) });
});
app.use("/media", mediaRouter);

// 404 cho các route /api không khớp
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy endpoint" } });
});

// Error handler chuẩn { error: { code, message } } — Express 5 tự forward lỗi async
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Lỗi parse JSON body của express.json
  if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Body JSON không hợp lệ" } });
    return;
  }
  // Lỗi upload của multer (file quá lớn, sai field...)
  if (err instanceof Error && err.name === "MulterError") {
    res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL", message } });
});

const server = app.listen(SERVER_PORT, () => {
  console.log(`[server] AI Edit Video backend chạy tại http://localhost:${SERVER_PORT}`);
  console.log(`[server] Repo root: ${repoRoot}`);
  // Phiên bị 'interrupted' do restart (autoResume bật) → tự chạy tiếp sau khi server ổn định
  setTimeout(() => {
    void autoResumeStartup();
  }, 15_000);
});

// Upload video lớn qua WiFi có thể kéo dài hơn requestTimeout mặc định ~300s
// của Node → request bị cắt giữa chừng. Bỏ giới hạn cho toàn server; stall
// thật sự đã có middleware uploadProgress (45s không nhận byte nào) xử lý.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;
