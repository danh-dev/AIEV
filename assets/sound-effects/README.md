# Sound Effects — thư viện dùng chung

> **Repo không kèm sẵn file sound effect nào.** Giống nhạc nền: giấy phép audio rắc rối hơn code rất nhiều, nên bạn tự thêm tiếng của mình vào đây. Tính năng sound effect chỉ hoạt động sau khi thư mục này có ít nhất một file.
> *This folder ships empty on purpose: audio licensing is messy, so bring your own sound effects. The feature only works once there is at least one file here.*

## Thêm sound effect

Cách dễ nhất: mở web UI, vào trang **Sound Effects** → **Tải lên**, gắn tag rồi lưu. Server tự chép file vào đây, tự đo thời lượng bằng ffprobe và tự ghi vào `library.json`.

Cách thủ công: chép file audio vào thư mục này rồi thêm một entry vào `library.json` (xem `docs/API.md` mục Sound Effects):

```json
[
  {
    "file": "whoosh-nhanh.mp3",
    "tags": ["whoosh", "transition", "hay-dung"],
    "durationMs": 480,
    "description": "Whoosh ngắn, dùng cho chuyển cảnh nhanh",
    "source": "https://pixabay.com/sound-effects/whoosh-6316/",
    "license": "CC0-1.0"
  }
]
```

- `file` — tên file ASCII kebab-case, nằm ngay trong thư mục này.
- `tags` — AI dựa vào đây để chọn tiếng. Tag `hay-dung` đánh dấu bộ tiếng dùng thường xuyên.
- `durationMs` — để `null` nếu chưa đo, server đo bằng ffprobe khi upload qua UI.
- `description` — mô tả tiếng Việt, viết cho người đọc và cho AI cùng hiểu.
- `source` — **URL nơi bạn lấy file**. Ghi ngay lúc thêm, đừng để sau: sáu tháng nữa không ai nhớ nổi file này lấy ở đâu, và lúc đó nó thành file không dùng được.
- `license` — mã giấy phép (`CC0-1.0`, `CC-BY-4.0`, `Pixabay`, `mua-license`, `tu-thu-am`…).

`source` và `license` là tùy chọn về mặt kỹ thuật — server không bắt buộc — nhưng thiếu chúng thì file coi như không rõ nguồn gốc, và file không rõ nguồn gốc là file bạn không được phép phát tán lại.

Khi dùng cho một video thì copy file vào `video-projects/<ten>/assets/sound-effects/` rồi khai trong `meta.json` — project phải tự chứa đủ asset của nó. Entry trỏ tới file không tồn tại sẽ bị bỏ qua khi đọc thư viện, không làm hỏng gì.

## Bản quyền — đọc trước khi bỏ file vào đây

Chỉ bỏ vào đây tiếng bạn **có quyền dùng cho video sẽ đăng công khai**: CC0 / public domain, tiếng bạn đã mua giấy phép, hoặc tiếng bạn tự thu.

Hai thứ trông có vẻ vô hại nhưng không phải:

- **Trích đoạn từ phim, game, chương trình, video của người khác.** Tiếng xu Mario, jingle Netflix, "a few moments later" của SpongeBob, nhạc chờ Windows — nghe thì ngắn và quen thuộc, nhưng đều thuộc về ai đó. Một số còn là **nhãn hiệu âm thanh đã đăng ký** chứ không chỉ là bản quyền.
- **File tải từ YouTube.** Kể cả khi tiếng đó nghe rất "chung chung", nó vẫn nằm trong một tác phẩm có chủ.

Dùng riêng trong máy là chuyện của bạn. Nhưng đưa vào video đăng công khai thì rủi ro gậy bản quyền, còn commit lên một repo công khai là phát tán lại — rắc rối khi đó là của bạn, không phải của dự án này.

Vài nguồn miễn phí dùng được cho video thương mại (vẫn nên đọc điều khoản từng file):

| Nguồn | Giấy phép | Ghi chú |
|---|---|---|
| [Pixabay Sound Effects](https://pixabay.com/sound-effects/) | Pixabay Content License | Không cần ghi công, dùng thương mại được |
| [Freesound](https://freesound.org) (lọc CC0) | CC0 hoặc CC BY | **Phải lọc** — Freesound có cả file yêu cầu ghi công |
| [Mixkit](https://mixkit.co/free-sound-effects/) | Mixkit Free License | Không cần ghi công |
| [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk) | RemArc, phi thương mại | Chỉ dùng được nếu video của bạn phi thương mại |

## Vì sao thư mục này rỗng

Repo từng kèm sẵn 104 file gom từ nhiều nguồn qua nhiều tháng, không ghi lại nguồn nào. Khi rà lại để mở mã nguồn thì thấy trong đó có trích đoạn nhận ra ngay là của ai (jingle Netflix, nhạc Nintendo, SpongeBob, nhạc phim X-Files), và có file còn giữ nguyên tên do trang tải video YouTube đặt.

Không nhớ nguồn thì không chứng minh được quyền, mà không chứng minh được quyền thì không phát tán lại được — kể cả với những file gần như chắc chắn là vô hại. Nên toàn bộ được gỡ khỏi repo. Đó cũng là lý do `source` và `license` có mặt trong schema ở trên: để chuyện này không lặp lại.

Thư mục này đã được cấu hình để **không commit file audio lẫn `library.json` lên git** — chỉ README này được theo dõi. Thư viện của bạn ở lại máy bạn.
