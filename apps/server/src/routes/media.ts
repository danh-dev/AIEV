import express, { Router } from "express";
import { paths } from "../config.js";

/**
 * GET /media/<relPath> — phát file tĩnh (video/audio seek được nhờ Range).
 * Chỉ phục vụ dưới whitelist: video-projects/, image-projects/, assets/, outputs/, imports/.
 * express.static (serve-static) tự chặn `..`/path traversal và hỗ trợ Range.
 */
const router = Router();

const whitelist: Record<string, string> = {
  "video-projects": paths.videoProjectsDir,
  "image-projects": paths.imageProjectsDir,
  assets: paths.assetsDir,
  outputs: paths.outputsDir,
  imports: paths.importsDir,
};

for (const [prefix, dir] of Object.entries(whitelist)) {
  router.use(
    `/${prefix}`,
    express.static(dir, {
      dotfiles: "deny",
      index: false,
      fallthrough: true,
    }),
  );
}

// Ngoài whitelist hoặc file không tồn tại → 404 chuẩn { error }
router.use((_req, res) => {
  res.status(404).json({ error: { code: "MEDIA_NOT_FOUND", message: "Không tìm thấy file" } });
});

export default router;
