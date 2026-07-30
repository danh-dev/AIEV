# Sound Effects — thư viện dùng chung

Mỗi file audio trong thư mục này có một entry trong `library.json` dạng `{ "file": "ten-file.mp3", "tags": ["whoosh", "transition"], "durationMs": 480, "description": "mô tả tiếng Việt" }` (xem `docs/API.md` mục Sound Effects — `durationMs` do server đo bằng ffprobe khi upload, để `null` nếu chưa đo).
Tên file bắt buộc ASCII kebab-case; khi dùng cho một video thì copy file vào `video-projects/<ten>/assets/sound-effects/` rồi khai trong `meta.json` — project phải tự chứa đủ asset của nó.
