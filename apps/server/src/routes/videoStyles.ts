import { Router } from "express";
import { VIDEO_STYLES } from "../videoStyles.js";

/**
 * GET /api/video-styles - danh sách phong cách dựng cho ô chọn trên web.
 *
 * Tĩnh và miễn phí (catalog nằm trong code, không gọi ra ngoài).
 *
 * KHÔNG trả `art` và `avoid`: đó là prompt chỉ đạo mỹ thuật gửi cho Gemini,
 * dài và bằng tiếng Anh - web không dùng tới, mà bày ra thì người dùng lại
 * tưởng có thể sửa. `motion` thì CÓ trả, vì đó là thứ nói cho người dùng biết
 * video sẽ chuyển động ra sao - đúng cái họ cần để chọn.
 */
const router = Router();

router.get("/", (_req, res) => {
  res.json(
    VIDEO_STYLES.map((s) => ({
      id: s.id,
      name: s.name,
      palette: s.palette,
      motion: s.motion,
    })),
  );
});

export default router;
