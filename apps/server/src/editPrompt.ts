import { buildFilterChain, normAdjust } from "./color.js";
import type { Brief, FileInfoWithDescription, ProjectMeta } from "./meta.js";
import type { SfxEntry } from "./routes/sfx.js";
import type { StyleDesign } from "./styles.js";

/**
 * Soạn prompt tiếng Việt cho POST /api/projects/:id/edit — server tự tổng hợp
 * meta.json (brief), assets.json (mô tả asset), sound effects theo sfxMode và skill
 * thành một nhiệm vụ đầy đủ cho agent (chạy cùng pipeline với /api/chat).
 */
export function buildEditPrompt(input: {
  id: string;
  meta: ProjectMeta;
  brief: Brief;
  assets: FileInfoWithDescription[];
  /** Danh sách sfx đề xuất (tag hay-dung) — chỉ dùng khi sfxMode = "recommended" */
  recommendedSfx: SfxEntry[];
  /** Style Design đã resolve từ brief.styleId (hoặc default) — null = không cưỡng chế style */
  style: StyleDesign | null;
  extraNotes: string;
}): string {
  const { id, meta, brief, assets, recommendedSfx, style, extraNotes } = input;
  const lines: string[] = [];

  // --- Tiêu đề nhiệm vụ
  lines.push(`# Nhiệm vụ: Edit video cho project "${meta.name}" (id: ${id})`);
  lines.push("");
  lines.push(
    `Project nằm tại \`video-projects/${id}/\` — \`meta.json\` trong đó là nguồn sự thật ` +
      `(${meta.width}x${meta.height}, ${meta.fps}fps). Hãy edit video theo đúng brief dưới đây.`,
  );
  lines.push("");

  // --- Brief
  lines.push("## Brief");
  lines.push(
    `- Video source: ${brief.sourceDescription.trim() || "(chưa có mô tả — tự xem asset/scenes để hiểu source)"}`,
  );
  lines.push(
    `- Tự động cắt: ${
      brief.autoCut
        ? "Có — tự động cắt bỏ đoạn thừa, khoảng lặng"
        : "Không — giữ nguyên nhịp video, không tự ý cắt bỏ đoạn nào"
    }`,
  );
  lines.push(
    `- Phụ đề: ${
      brief.subtitles
        ? "Có — tạo phụ đề karaoke khớp lời"
        : "Không — không tạo phụ đề"
    }`,
  );
  if (brief.highlightEnabled) {
    lines.push(
      "- Làm nổi bật key chính: Có — TỰ phân tích nội dung/transcript của video, chọn ra các keyword " +
        "quan trọng nhất và highlight chúng trong phụ đề/typography để dễ nhìn.",
    );
    if (brief.highlightKeywords.length > 0) {
      lines.push(
        `  Ngoài các keyword tự chọn, BẮT BUỘC highlight thêm: ${brief.highlightKeywords
          .map((k) => `"${k}"`)
          .join(", ")}.`,
      );
    }
  } else {
    lines.push("- Làm nổi bật key chính: Không — không highlight keyword.");
  }
  if (brief.keyLayoutEnabled) {
    lines.push(
      "- Bố cục Key: BẬT — video PHẢI có KEY CHÍNH hiển thị ở VÙNG TRÊN video và các KEY LIÊN QUAN " +
        "hiển thị ở VÙNG DƯỚI (phía trên vùng caption). Đọc skill `key-layout` và làm ĐÚNG spec trong đó " +
        "(vị trí band, typography, timing, verify bằng snapshot).",
    );
    lines.push(
      brief.mainKey.trim()
        ? `  KEY CHÍNH (user chỉ định — dùng NGUYÊN VĂN): "${brief.mainKey.trim()}"`
        : "  KEY CHÍNH: tự phân tích transcript/nội dung, chọn MỘT cụm 2–6 từ đại diện chủ đề/hook của cả video.",
    );
    lines.push(
      brief.relatedKeys.length > 0
        ? `  KEY LIÊN QUAN (user chỉ định — BẮT BUỘC dùng đủ, đúng thứ tự nội dung nhắc tới): ${brief.relatedKeys
            .map((k) => `"${k}"`)
            .join(", ")}.`
        : "  KEY LIÊN QUAN: tự chọn 3–6 key theo key chính (mỗi key gắn với một ý được nói trong video, hiện đúng lúc ý đó được nhắc).",
    );
  } else {
    lines.push("- Bố cục Key: TẮT — không thêm band key chính/key liên quan.");
  }
  if (brief.autoIllustrations) {
    lines.push(
      "- Ảnh minh họa AI: BẬT — tự tạo ảnh minh họa bằng Gemini cho các ý chính của video và ghép vào " +
        "đúng thời điểm. Đọc skill `ai-illustrations` để biết cách chọn khoảnh khắc, viết prompt và gọi API " +
        `(POST http://localhost:6869/api/illustrations). Model: ${brief.illustrationModel ?? "mặc định (Nano Banana 2)"}. ` +
        "Ảnh minh họa BẮT BUỘC theo Style Design của project (tuân thủ 100%, không ngoại lệ): luôn truyền " +
        "styleId của style đã chọn; server trộn màu + tone + hiệu ứng của style vào prompt — KHÔNG tự thêm màu brand, " +
        "KHÔNG dùng bảng màu khác dù skill/prompt gợi ý.",
    );
  }
  if (brief.notes.trim()) lines.push(`- Ghi chú: ${brief.notes.trim()}`);
  if (extraNotes) lines.push(`- Ghi chú thêm cho lần edit này: ${extraNotes}`);
  lines.push("");

  // --- Style Design (cưỡng chế 100% — thắng prompt mẫu lẫn skill)
  if (style) {
    const c = style.colors;
    const fontFileNote = (slot: "heading" | "body"): string =>
      style.fontFiles[slot] ? ` (file font: \`${style.fontFiles[slot]}\`)` : "";
    lines.push("## STYLE DESIGN (BẮT BUỘC TUÂN THỦ 100%)");
    lines.push(
      `Style: "${style.name}" — mọi sản phẩm hình ảnh/chữ trong video PHẢI theo đúng:`,
    );
    lines.push(
      `- Màu: primary ${c.primary}, secondary ${c.secondary}, background ${c.background}, ` +
        `text ${c.text}, accent ${c.accent}`,
    );
    lines.push(
      `- Font: heading "${style.fonts.heading}"${fontFileNote("heading")}, ` +
        `body "${style.fonts.body}"${fontFileNote("body")}`,
    );
    lines.push(
      `- Tone: ${style.tone.trim() || "(không quy định)"} / Guidelines: ${
        style.guidelines.trim() || "(không quy định)"
      }`,
    );
    lines.push(
      "LUẬT ƯU TIÊN: Style Design này THẮNG mọi quy định màu/font/tone trong prompt mẫu hoặc skill.",
    );
    lines.push(
      "Skill quy định bảng màu riêng (vd dark fintech xanh) → BỎ QUA bảng màu đó, dùng style này;",
    );
    lines.push("kỹ thuật animation/layout/nhịp của skill vẫn áp dụng bình thường.");
    lines.push(`Ảnh minh họa (POST /api/illustrations) truyền styleId="${style.id}".`);
    lines.push("");
  }

  // --- Assets + mô tả từng file
  lines.push(`## Asset của project (\`video-projects/${id}/assets/\`)`);
  if (assets.length === 0) {
    lines.push("(chưa có asset nào)");
  } else {
    for (const f of assets) {
      const desc = f.description?.trim() || "(chưa có mô tả)";
      lines.push(`- \`${f.relPath}\` [${f.kind}] — ${desc}`);
    }
    lines.push("");
    lines.push(
      "Dùng mô tả từng ảnh/video ở trên để quyết định ghép asset nào vào thời điểm nào trong video.",
    );

    // --- Chỉnh màu đã được người dùng DUYỆT trước trên UI — áp đúng, không tự sáng tạo
    const graded = assets.filter((f) => f.colorGrade);
    if (graded.length > 0) {
      lines.push("");
      lines.push("### Chỉnh màu (người dùng đã duyệt preview — áp CHÍNH XÁC như sau)");
      for (const f of graded) {
        const chain = buildFilterChain(f.colorGrade ?? null, false, normAdjust(f.colorAdjust));
        lines.push(
          `- \`${f.relPath}\`: preset "${f.colorGrade}" — áp bằng ffmpeg với \`-vf "${chain}"\` ` +
            "(nếu footage là HDR/HLG thì chèn tonemap TRƯỚC chuỗi này — xem skill color-grading). " +
            "Tạo bản đã chỉnh màu rồi dùng bản đó trong toàn bộ pipeline thay bản gốc.",
        );
      }
      lines.push(
        "Đọc skill `color-grading` để biết chuỗi tonemap và quy trình verify màu bằng mắt. " +
          "KHÔNG đổi preset hay tự chế filter khác — người dùng đã chọn dựa trên preview đúng các chuỗi này.",
      );
    }
  }
  lines.push("");

  // --- Sound effects theo sfxMode
  lines.push("## Sound effects");
  if (brief.sfxMode === "recommended") {
    if (recommendedSfx.length === 0) {
      lines.push(
        "Brief đặt chế độ dùng bộ sound effect đề xuất nhưng thư viện chưa có sound nào " +
          "được đề xuất (tag `hay-dung`) — KHÔNG dùng sound effect trong video này.",
      );
    } else {
      lines.push(
        "Chỉ được chọn sound effect trong danh sách đề xuất dưới đây " +
          "(file nằm trong `assets/sound-effects/`), KHÔNG tự tìm sound khác:",
      );
      for (const e of recommendedSfx) {
        const dur = e.durationMs !== null ? `${e.durationMs}ms` : "chưa đo thời lượng";
        lines.push(`- \`${e.file}\` (${dur}) — ${e.description.trim() || "(không có mô tả)"}`);
      }
    }
  } else if (brief.sfxMode === "library") {
    lines.push(
      "Đọc `assets/sound-effects/library.json` để tự tìm sound effect phù hợp theo tags/description " +
        "của từng entry (file nằm trong `assets/sound-effects/`).",
    );
  } else {
    lines.push("KHÔNG dùng sound effect trong video này.");
  }
  lines.push("");

  // --- Skill
  lines.push("## Skill");
  if (brief.skill) {
    lines.push(
      `Dùng skill \`${brief.skill}\` làm quy trình chính — đọc \`.claude/skills/${brief.skill}/SKILL.md\` và làm theo.`,
    );
  } else {
    lines.push(
      "Tự chọn skill phù hợp nhất trong `.claude/skills/` (đọc mô tả các skill rồi quyết định) làm quy trình chính.",
    );
  }
  lines.push("");

  // --- Quy trình bắt buộc
  lines.push("## Quy trình bắt buộc");
  lines.push(
    "- Luôn tuân theo skill `video-pipeline`: render bản draft trước rồi mới final, " +
      "verify frame sau mỗi lần render, cập nhật `meta.json` của project.",
  );
  lines.push(
    "- Mọi render — tạo job qua API nội bộ hay chạy CLI trực tiếp — đều được, " +
      `nhưng phải ghi kết quả vào \`video-projects/${id}/renders/\` và cập nhật \`meta.json\`.`,
  );

  return lines.join("\n") + "\n";
}
