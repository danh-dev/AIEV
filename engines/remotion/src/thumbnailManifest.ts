import { z } from "zod";

/**
 * Schema props của composition still `Thumbnail` — ảnh thumbnail cho một video
 * đã render: nền do Gemini vẽ + chân dung người nói cắt từ chính footage +
 * title đặt CHÍNH GIỮA khung.
 *
 * Khác `Poster` (posterManifest.ts): Poster đặt khối chữ ở mép dưới và không
 * có lớp chân dung. Thumbnail luôn canh giữa và luôn có vòng chân dung, nên
 * tách composition riêng thay vì nhồi thêm nhánh vào Poster.
 *
 * Nguyên tắc giống manifest.ts / posterManifest.ts:
 * - `z.looseObject` (passthrough) — backend ghi thêm field lạ vẫn parse qua.
 * - `background` / `portrait` là đường dẫn TƯƠNG ĐỐI trong public/staging
 *   (stage bằng hardlink) — chỉ load qua `staticFile()`.
 */

export const thumbnailAspectSchema = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export type ThumbnailAspect = z.infer<typeof thumbnailAspectSchema>;

export const THUMBNAIL_DIMENSIONS: Record<
  ThumbnailAspect,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export const thumbnailColorsSchema = z.looseObject({
  primary: z.string().default("#ed3c47"),
  secondary: z.string().default("#ff7849"),
  background: z.string().default("#101113"),
  text: z.string().default("#ffffff"),
  accent: z.string().default("#37bdf8"),
});

export const thumbnailSchema = z.looseObject({
  aspect: thumbnailAspectSchema.default("9:16"),
  /** Ảnh nền (Gemini). null = nền phẳng theo colors.background. */
  background: z.string().nullable().default(null),
  /** Chân dung cắt từ footage. null = không vẽ lớp chân dung. */
  portrait: z.string().nullable().default(null),
  /**
   * Bề RỘNG của ảnh chân dung theo tỉ lệ bề rộng khung (0–1). Ảnh giữ nguyên
   * tỉ lệ gốc (height auto) và neo ở ĐÁY khung.
   *
   * ⚠️ Không dùng `object-fit: cover` full-bề-ngang: nguồn là frame 9:16 nên
   * cover ép ảnh về scale 1:1, đầu người cao ~810px và luôn đè lên khối title
   * canh giữa. Khống chế bề rộng mới hạ được người xuống dưới title.
   */
  portraitScale: z.number().min(0.1).max(1).default(0.58),
  /**
   * Mốc mask DỌC, tính theo % chiều cao ảnh: trong suốt ở 0% → đặc từ
   * `fadeTop`% → đặc tới `fadeBottom`% → tan hết ở đáy. Mép trên mờ để ảnh
   * hòa vào nền Gemini; mép dưới tan dần đúng yêu cầu "mờ dần về phía dưới".
   */
  portraitFadeTop: z.number().min(0).max(100).default(14),
  portraitFadeBottom: z.number().min(0).max(100).default(62),
  /**
   * Mốc mask NGANG (% bề rộng ảnh) — làm mềm hai mép trái/phải để ảnh không
   * đọc ra thành hình chữ nhật dán lên nền. 0 = tắt, giữ mép thẳng.
   */
  portraitFadeSide: z.number().min(0).max(40).default(10),
  /** Phần chữ thường của title. */
  title: z.string().default(""),
  /** Phần đuôi title tô màu primary. Rỗng = cả title màu trắng. */
  highlight: z.string().default(""),
  brandName: z.string().default(""),
  /** Độ tối của ảnh nền (0 = giữ nguyên, 1 = đen). Chữ phải luôn đọc được. */
  backgroundDim: z.number().min(0).max(1).default(0.52),
  colors: thumbnailColorsSchema.prefault({}),
});

export type ThumbnailColors = z.infer<typeof thumbnailColorsSchema>;
export type ThumbnailProps = z.infer<typeof thumbnailSchema>;
