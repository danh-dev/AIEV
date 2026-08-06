# Style Design — bộ nhận diện dùng cho video và ảnh

`styles.json` chứa các Style Design (màu, font, hiệu ứng, logo, tone). Quản lý ở trang **Style Design** trên web UI; hợp đồng API ở [`docs/API.md`](../../docs/API.md).

## Font — repo không kèm sẵn font nào

Thư mục `files/` là nơi file font và logo của bạn nằm. **Không có file font nào được commit lên git** vì font có giấy phép riêng: phần lớn Google Fonts dùng [SIL Open Font License](https://openfontlicense.org), cho dùng thương mại thoải mái nhưng **bắt buộc kèm bản giấy phép khi phát tán lại file font** — mà kèm đúng cho từng font trong một repo code thì rườm rà hơn là để mỗi người tự tải.

Nên cách dùng là: **gõ tên font, hệ thống tự tải về máy bạn.**

1. Mở trang **Style Design** → chọn style → tab **Chữ & Logo**.
2. Gõ tên font vào ô Heading hoặc Body (vd `Be Vietnam Pro`, `Montserrat`, `Roboto`), bấm **Tải font này**.
3. Server gọi Google Fonts, tải file TTF **trọn bộ glyph** về `files/` rồi trỏ style vào đó.

Muốn xem hết kho thì duyệt tại [fonts.google.com](https://fonts.google.com). Có font riêng đã mua hoặc tự làm thì dùng khối **File font trên máy** ngay dưới để upload thẳng file `.ttf`/`.otf`/`.woff2`.

> **Chọn font có đủ dấu tiếng Việt.** Rất nhiều font đẹp không có bộ dấu, và triệu chứng thì khó đoán: chữ ra ô vuông, hoặc mất dấu, hoặc dấu bị đặt lệch. Google Fonts lọc được theo bảng chữ cái Vietnamese.

Chưa tải font thì render vẫn chạy, chỉ là rơi về font hệ thống — server ghi một dòng cảnh báo trong log job chứ không làm hỏng gì.

## Logo

Logo của Style Design là file bạn upload, nằm cùng thư mục `files/`. Có logo thì khâu lắp ráp Remotion tự đóng nó lên góc trên trái toàn video (xem `jobs/assemble.ts` → `manifest.watermark`). Không muốn đóng logo thì dùng một style không có logo.

Logo thương hiệu **khác** (Meta, TikTok, OpenAI…) không thuộc đây — chúng nằm ở [`assets/brand-logos/`](../brand-logos/README.md) và có ràng buộc nhãn hiệu riêng.

## Giấy phép

| Thứ | Giấy phép |
|---|---|
| Code đọc/ghi những file này | MIT, như cả repo |
| File font bạn tải hoặc upload | Giấy phép riêng của font đó (Google Fonts phần lớn là SIL OFL) |
| Logo bạn upload | Của bạn |
| Logo và tên **noti.vn** | Nhãn hiệu của noti.vn, **không** nằm trong giấy phép MIT |

Thư mục `files/` đã được cấu hình để không commit file font lên git. File font, logo và các style của bạn ở lại máy bạn.
