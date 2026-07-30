---
name: skill-authoring
description: Chuẩn viết skill mới cho hệ thống AI Edit Video — cấu trúc file, frontmatter, giọng văn, cách tích lũy bài học sản xuất vào skill. Đọc khi người dùng yêu cầu tạo skill mới (qua chat hoặc từ trang Skills trên web UI) hoặc khi cập nhật skill sau một video.
---

# Skill Authoring — viết skill đúng chuẩn

Skill là nơi tích lũy know-how sản xuất. Một skill tốt giúp video sau tự động tốt hơn video trước mà không cần nhắc lại trong chat.

## Cấu trúc bắt buộc

```
.claude/skills/<ten-kebab-case>/
└── SKILL.md
```

```markdown
---
name: <trùng tên folder, kebab-case>
description: <1–2 câu: skill làm gì + KHI NÀO dùng. Claude quyết định nạp skill dựa vào dòng này — viết cụ thể, có từ khóa>
---

# Tiêu đề

<thân skill>
```

## Quy tắc viết

1. **Description quyết định tất cả.** Claude chỉ thấy description khi chọn skill — phải nêu rõ tình huống kích hoạt: "Đọc khi...", "Dùng khi user đưa...". Description mơ hồ = skill không bao giờ được dùng.
2. **Viết cho lần dùng sau, không viết để lưu niệm.** Mỗi mục phải trả lời "lần tới làm gì khác đi". Không chép lại lịch sử debug — chỉ giữ kết luận + cách áp dụng.
3. **Fix phải kèm điều kiện nhận biết.** Mẫu chuẩn cho một bài học:
   - **Triệu chứng:** chữ gradient tiếng Việt mất dấu ở frame reveal
   - **Nguyên nhân:** `background-clip: text` cắt phần dấu nằm ngoài line-box
   - **Fix:** thêm `padding-top` + `line-height` đủ chứa dấu, kiểm frame đầu/cuối reveal
4. **Cụ thể hơn là đầy đủ.** Lệnh chạy được > mô tả chung. Số liệu cụ thể (CRF 28, volume 0.3, stroke 1.5px) > tính từ ("phù hợp", "vừa phải").
5. **Tiếng Việt cho nội dung, tiếng Anh cho code/lệnh/tên kỹ thuật.** Không dịch thuật ngữ (frame, render, timeline...).
6. **Một skill một chủ đề.** Skill phình quá ~200 dòng thì tách. Tham chiếu skill khác bằng tên (`xem skill remotion-assemble`), không copy nội dung chéo.

## Khi nào TẠO skill mới vs CẬP NHẬT skill cũ

| Tình huống | Làm gì |
|---|---|
| Format video mới lặp lại được (vd: video so sánh sản phẩm) | Tạo skill mới, nhân bản từ skill gần nhất |
| Fix một lỗi trong quy trình đã có skill | Cập nhật skill đó, mục "Lỗi đã biết" |
| Quy tắc thẩm mỹ/brand mới | Cập nhật `webui-design` (UI) hoặc skill format video (video) |
| Kinh nghiệm chỉ đúng cho một video cụ thể | KHÔNG đưa vào skill — ghi vào NOTES.md của project đó |

## Luồng tạo skill từ web UI

Khi user tạo skill qua trang Skills (mô tả bằng tiếng Việt tự nhiên):
1. Đọc skill này + skill gần nhất cùng loại làm mẫu.
2. Soạn `SKILL.md` đầy đủ frontmatter, đúng các quy tắc trên.
3. Nếu skill liên quan video tiếng Việt: kế thừa các fix đã kiểm chứng (dấu tiếng Việt, PATH ffmpeg) bằng tham chiếu, không copy.
4. Trả về cho UI dạng draft để user duyệt trước khi ghi file.

## Sau mỗi video hoàn thành

Tự hỏi: có triệu chứng→nguyên nhân→fix nào mới không? Có bước nào làm thủ công quá 2 lần rồi không (dấu hiệu cần thành skill)? Nếu có — cập nhật skill ngay trong phiên đó, đừng để sang phiên sau.
