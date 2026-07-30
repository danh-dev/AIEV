---
name: ai-illustrations
description: Tự tạo ảnh minh họa bằng Gemini và ghép vào video đang edit — cách chọn khoảnh khắc cần ảnh, viết prompt, gọi API /api/illustrations (ảnh BẮT BUỘC đồng bộ Style Design đã chọn), và ghép vào composition. Đọc khi brief bật "Ảnh minh họa AI" hoặc người dùng yêu cầu tạo ảnh minh họa cho video.
---

# AI Illustrations — Claude điều phối, Gemini vẽ, đồng bộ thương hiệu

## Nguyên tắc điều phối

1. **Chọn khoảnh khắc có chủ đích, không rải bừa.** Đọc transcript/nội dung video, chọn 2–5 ý mà
   một hình minh họa làm rõ hơn lời nói: khái niệm trừu tượng, con số quan trọng, sản phẩm/bối cảnh
   được nhắc tới, so sánh trước–sau. KHÔNG minh họa những đoạn talking-head đang tự đủ sức hút.
2. **Mỗi ảnh ~$0.05–0.07** — cân nhắc như tiền thật. Video ngắn (<60s) thường chỉ cần 2–4 ảnh.
3. **Ảnh là minh họa NỀN — không chứa chữ.** Server đã cấm chữ trong prompt; số liệu/nhãn do
   HyperFrames/Remotion đặt lên trên (đúng font + màu brand, không sai chính tả).
4. **Style Design là LUẬT — tuân thủ 100%, không ngoại lệ.** Mọi ảnh minh họa phải theo style
   đã chọn của project: luôn truyền `styleId` (mục STYLE DESIGN của edit prompt). Server có lưới
   an toàn (thiếu styleId thì tự lấy style trong brief của project), nhưng đừng dựa vào đó.
   Skill/prompt nào gợi ý bảng màu khác → BỎ QUA, style thắng.

## Gọi API tạo ảnh (server phải đang chạy — luôn đúng khi edit qua hệ thống)

```bash
curl -s -X POST http://localhost:6869/api/illustrations \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<id video project>",
    "name": "khai-niem-mcp",
    "prompt": "3D illustration of interconnected glass puzzle pieces forming a network, representing an integration protocol",
    "aspect": "9:16",
    "model": "<model trong brief, bỏ field nếu dùng mặc định>",
    "styleId": "<styleId trong mục STYLE DESIGN của edit prompt — BẮT BUỘC truyền nếu có>",
    "description": "Minh họa khái niệm MCP — ghép vào lúc 12.5s khi nói về kết nối dữ liệu"
  }'
```

- Ảnh lưu vào `video-projects/<id>/assets/illustrations/<name>.png`, mô tả tự ghi vào assets.json.
- **Prompt viết bằng tiếng Anh, TẢ NỘI DUNG CẢNH** — đừng thêm màu brand/tone (server tự trộn
  Style Design vào), đừng ra lệnh "no text" (server tự thêm).
- `aspect` khớp khung hình video (video dọc → "9:16"). Lỗi thiếu GEMINI_API_KEY → báo người dùng
  nhập key ở tab Kết nối rồi tiếp tục phần khác của video, đừng kẹt.
- `description` LUÔN ghi rõ ảnh minh họa cho ý nào + dự kiến ghép ở giây thứ mấy.

## Ghép vào video

- HyperFrames: chèn `<img src="assets/illustrations/<file>.png">` trong scene, animate vào/ra
  (fade/slide/scale nhẹ theo MOTION_PHILOSOPHY), hiển thị 2–4 giây quanh đúng câu nói liên quan.
- Che phủ hợp lý: ảnh minh họa thường chiếm 50–75% khung trên video dọc, KHÔNG che mặt người nói
  đang ở giữa câu quan trọng; vào theo nhịp câu (dùng timestamp transcript).
- Verify bằng snapshot sau khi chèn: ảnh đúng vị trí, không méo (giữ aspect ratio), không tràn mép.

## Lỗi đã biết

- Tạo ảnh xong quên ghép — checklist cuối: mọi ảnh trong `assets/illustrations/` phải xuất hiện
  trong composition hoặc bị xóa (đừng để ảnh mồ côi tốn tiền vô ích).
- Prompt tả quá chung ("technology background") → ảnh vô hồn. Tả cụ thể vật thể/bối cảnh/góc nhìn.
- Nhu cầu ảnh GIỐNG NHAU giữa các scene → tạo 1 ảnh dùng lại, đừng gọi API 2 lần.
