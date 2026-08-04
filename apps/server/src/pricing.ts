/**
 * Đơn giá token theo model - USD trên MỘT TRIỆU token.
 *
 * DÙNG ĐỂ LÀM GÌ: bảng "Chi phí AI theo model" trên Dashboard cần tách riêng
 * tiền của token VÀO và token RA. Bảng `token_usage` chỉ lưu MỘT con số
 * `costUsd` gộp cả hai (Agent SDK trả về `total_cost_usd`), nên không tách
 * ngược ra được - phải nhân lại từ đơn giá.
 *
 * QUAN HỆ VỚI `costUsd` ĐÃ LƯU - đọc kỹ chỗ này:
 *   - `costUsd` là số tiền THẬT đã tiêu, do nhà cung cấp trả về.
 *   - $vào / $ra tính từ bảng này là số tiền THEO GIÁ NIÊM YẾT.
 *   Hai con số KHÔNG bằng nhau, và đó là bình thường: prompt cache đọc lại chỉ
 *   tính ~10% giá vào, nên tiền thật thường THẤP HƠN giá niêm yết. Vì vậy UI
 *   hiện $vào/$ra như ước tính theo đơn giá, còn cột tổng lấy đúng `costUsd`
 *   đã lưu. Đừng "sửa" cho hai bên khớp nhau - lệch chính là thông tin.
 *
 * Giá Claude lấy từ bảng model chính thức (skill `claude-api`, bản 2026-06-24),
 * KHÔNG phải nhớ ra. Có model mới thì cập nhật ở đây, đừng đoán.
 */

/** USD/1 triệu token. */
export interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

/**
 * Khóa là id model đúng như lúc ghi vào `chat_sessions.model`.
 * Model không có trong bảng này thì API trả `price: null` và UI để trống ô $,
 * chứ KHÔNG bịa một con số gần đúng.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ----- Anthropic -----
  "claude-fable-5": { inPerM: 10, outPerM: 50 },
  "claude-mythos-5": { inPerM: 10, outPerM: 50 },
  "claude-opus-5": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-7": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-6": { inPerM: 5, outPerM: 25 },
  // Sonnet 5 đang có giá giới thiệu 2/10 tới hết 31/08/2026; để giá NIÊM YẾT
  // ở đây vì đây là bảng giá chuẩn, còn số tiền thật vẫn lấy từ costUsd.
  "claude-sonnet-5": { inPerM: 3, outPerM: 15 },
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },

  // ----- Google Gemini -----
  // Trùng với hằng số đã dùng để TÍNH costUsd trong stt.ts và translate.ts
  // (GEMINI_PRICE_IN_PER_M / _OUT_PER_M) - hai nơi phải bằng nhau, lệch là
  // cột tổng và cột $vào/$ra đá nhau vì lý do sai chứ không phải vì cache.
  "gemini-3.1-flash-image": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-3.1-flash-lite-image": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-3-pro-image": { inPerM: 0.3, outPerM: 2.5 },
};

/**
 * Đơn giá mặc định theo NHÀ CUNG CẤP - dùng khi dòng token_usage không gắn với
 * phiên chat nào nên không biết model (bóc lời, dịch, tạo ảnh… chạy ngoài phiên).
 * Riêng Claude cố ý KHÔNG có mặc định: khoảng giá của nó quá rộng (1 → 50
 * USD/1M) nên đoán bừa là sai hẳn một bậc, thà để trống.
 */
export const PROVIDER_FALLBACK_PRICES: Record<string, ModelPrice> = {
  gemini: { inPerM: 0.3, outPerM: 2.5 },
};

/** Đơn giá của một dòng usage; null = không biết, UI phải để trống ô $. */
export function priceFor(
  model: string | null,
  provider: string | null,
): ModelPrice | null {
  if (model && MODEL_PRICES[model]) return MODEL_PRICES[model];
  if (provider && PROVIDER_FALLBACK_PRICES[provider]) {
    return PROVIDER_FALLBACK_PRICES[provider];
  }
  return null;
}
