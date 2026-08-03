import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";

/**
 * Thư viện logo brand dùng chung (`assets/brand-logos/`).
 *
 * Có sẵn để lúc dựng video cần nhắc tới Facebook / TikTok / Claude... thì lấy
 * đúng file logo chính thức, thay vì tự vẽ lại hay nhờ Gemini sinh ra - logo
 * sai nhận diện là lỗi người xem nhìn ra ngay.
 *
 * File tải bằng `node scripts/fetch-brand-logos.mjs` từ Simple Icons (CC0-1.0).
 * CC0 áp cho FILE, không phải cho quyền nhãn hiệu - xem `notice` trong
 * library.json.
 */

export interface BrandLogo {
  slug: string;
  title: string;
  /** Mã màu chính thức của brand, vd "#0866FF" - null với file người dùng tự thêm */
  color: string | null;
  /** Tên file trong assets/brand-logos/ */
  file: string;
  source?: string | null;
  addedByUser?: boolean;
}

export interface BrandLogoLibrary {
  generatedAt: string;
  source: string;
  license: string;
  notice: string;
  count: number;
  icons: BrandLogo[];
}

export function brandLogosDir(): string {
  return path.join(paths.assetsDir, "brand-logos");
}

function libraryPath(): string {
  return path.join(brandLogosDir(), "library.json");
}

/** Đọc danh mục; thiếu file hay hỏng JSON thì trả rỗng chứ không ném lỗi - thư
 * viện logo không có thì video vẫn dựng được, chỉ là thiếu logo brand. */
export function readBrandLogos(): BrandLogo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryPath(), "utf8")) as Partial<BrandLogoLibrary>;
    if (!Array.isArray(raw.icons)) return [];
    // Chỉ giữ mục có file thật trên đĩa - danh mục cũ hơn thư mục là chuyện
    // thường (ai đó xóa bớt file), mà bảo agent dùng file không tồn tại thì nó
    // sẽ loay hoay rồi tự chế logo, đúng cái ta muốn tránh.
    return raw.icons.filter(
      (i): i is BrandLogo =>
        Boolean(i && typeof i.file === "string" && i.file) &&
        fs.existsSync(path.join(brandLogosDir(), i.file)),
    );
  } catch {
    return [];
  }
}

export function countBrandLogos(): number {
  return readBrandLogos().length;
}
