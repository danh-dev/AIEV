/**
 * Sinh `captions` (phụ đề karaoke) cho meta.json của mcp-tiktok-2.
 *
 * Vấn đề: transcript.json có timestamp theo VIDEO GỐC (55.17s), còn voice trên
 * timeline là narration.cut.wav (52.40s) đã bị cắt bớt khoảng lặng. Trimmer chỉ
 * RÚT NGẮN khoảng lặng, không đụng vào vùng speech → mỗi vùng speech giữ nguyên
 * độ dài, chỉ dịch sang trái một lượng cố định. Bảng REGIONS dưới đây là kết quả
 * đo bằng `ffmpeg silencedetect=noise=-38dB:d=0.20` trên CẢ HAI file rồi khớp
 * 1:1 các vùng speech theo độ dài (sai lệch độ dài = 0.000s ở 18/19 vùng).
 *
 * Kiểm chứng: from/to của các scene footage trong meta.json (do bước chia scene
 * sinh ra) rơi đúng khớp với bảng này — vd f1b comp frame 96 → cut 3.200 →
 * +0.167 = orig 3.367 = đúng `from: 3.3667`.
 *
 * Chạy: node tools/gen-captions.js         (in ra để soi)
 *       node tools/gen-captions.js --write (ghi vào meta.json)
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT = path.join(__dirname, "..");
const FPS = 30;

/** [orig_start, orig_end, offset] — offset = orig_time - cut_time trong vùng đó */
const REGIONS = [
  [0.0, 3.1, 0.0],
  [3.493, 5.406, 0.167],
  [5.692, 7.407, 0.167],
  [7.801, 8.748, 0.3],
  [9.065, 9.605, 0.3],
  [10.03, 11.088, 0.5],
  [11.62, 13.566, 0.8],
  [14.157, 17.551, 1.167],
  [17.759, 19.607, 1.167],
  [20.09, 20.887, 1.4],
  [21.141, 30.116, 1.4],
  [30.601, 35.514, 1.667],
  [35.878, 36.703, 1.8],
  [36.924, 39.644, 1.8],
  [39.851, 41.844, 1.8],
  [42.311, 48.2, 2.067],
  [48.455, 50.116, 2.108],
  [50.401, 51.882, 2.3],
  [52.454, 55.17, 2.633],
];

/** Giây trên video gốc → frame trên timeline composition. */
function origToFrame(t) {
  let best = REGIONS[0];
  let bestDist = Infinity;
  for (const r of REGIONS) {
    // Trong vùng → dùng luôn; ngoài vùng (rơi vào khoảng lặng) → vùng gần nhất.
    const dist = t < r[0] ? r[0] - t : t > r[1] ? t - r[1] : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
    if (dist === 0) break;
  }
  return Math.round((t - best[2]) * FPS);
}

/**
 * Cửa sổ footage (frame comp) đã THU VÀO 6 frame mỗi đầu — trùng transitionOverlap,
 * để phụ đề không hiện lúc đang crossfade sang scene chữ.
 * Nguồn: cộng dồn durationInFrames - transitionOverlap của scenes[] trong meta.json.
 */
const WINDOWS = [
  [71, 167], // f1a + f1b
  [288, 386], // f2a + f2b
  [563, 620], // f3
  [723, 865], // f4
  [1210, 1272], // f5
];

/** Keyword nhấn — chọn từ chính nội dung: tên sản phẩm/khái niệm cốt lõi. */
const KEYWORDS = new Set([
  "mcp",
  "tiktok",
  "tiktok shop",
  "shop",
  "gmvmax",
  "catalog",
  "pixel",
  "ai",
  "connect",
  "limit",
  "dữ liệu",
  "quảng cáo",
  "đơn hàng",
]);

/**
 * Cụm từ phải đi liền nhau — gộp thành MỘT token trước khi chia cụm, để không
 * bị ngắt "quảng | cáo" sang hai cue và để highlight đọc thành một khối.
 */
const PHRASES = [
  ["quảng", "cáo"],
  ["dữ", "liệu"],
  ["tiktok", "shop"],
  ["đơn", "hàng"],
  // Ba cụm dưới đây nằm vắt qua ranh giới cửa sổ footage. Gộp thành token để
  // cụm không vừa cửa sổ thì bị loại TRỌN — tránh phụ đề mở đầu bằng mảnh cụt
  // ("bộ cho mọi người…", "vọng là mọi người…").
  ["đổ", "bộ"],
  ["hi", "vọng"],
  ["nếu", "mà"],
];

/**
 * Sửa lỗi nhận dạng của ASR trước khi hiện lên màn hình — phụ đề sai chữ nhìn
 * tệ hơn là không có phụ đề. Chỉ sửa chỗ chắc chắn sai theo ngữ cảnh:
 * "đó đổ bộ cho mọi người ___" → người nói dùng "nhé" (cùng văn phong với
 * "cho mọi người nha" ở câu mở đầu), ASR nghe thành "chết".
 */
const ASR_FIX = { chết: "nhé" };

const bare = (w) =>
  w
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .trim();

/** Viết hoa tên riêng cho đúng chính tả thương hiệu (transcript trả về chữ thường). */
const CASE_FIX = {
  mcp: "MCP",
  tiktok: "TikTok",
  "tiktok shop": "TikTok Shop",
  gmvmax: "GMV Max",
  ai: "AI",
  pixel: "Pixel",
  catalog: "Catalog",
  shop: "Shop",
};

function prettify(word) {
  const key = bare(word);
  const fixed = CASE_FIX[key];
  if (!fixed) return word;
  // Giữ lại dấu câu dính cuối từ (vd "này," → "này,")
  const trailing = word.match(/[.,!?;:]+$/);
  return fixed + (trailing ? trailing[0] : "");
}

const transcript = JSON.parse(
  fs.readFileSync(path.join(PROJECT, "assets/audio/transcript.json"), "utf8"),
);

// Tất cả từ, kèm frame comp
let words = [];
for (const seg of transcript.segments) {
  for (const w of seg.words ?? []) {
    const fixed = ASR_FIX[bare(w.word)] ?? w.word;
    words.push({
      raw: fixed,
      start: origToFrame(w.start),
      end: origToFrame(w.end),
      endsClause: /[,.!?]$/.test(w.word),
    });
  }
}

// Gộp cụm từ đi liền (quảng cáo, dữ liệu…) thành một token
for (const phrase of PHRASES) {
  const merged = [];
  for (let i = 0; i < words.length; i++) {
    const slice = words.slice(i, i + phrase.length);
    const hit =
      slice.length === phrase.length &&
      slice.every((w, k) => bare(w.raw) === phrase[k]);
    if (hit) {
      const lastWord = slice[slice.length - 1];
      merged.push({
        raw: slice.map((w) => w.raw).join(" "),
        start: slice[0].start,
        end: lastWord.end,
        endsClause: lastWord.endsClause,
        // Giữ lại từng từ con: token gộp chỉ dùng để CHIA CỤM (không tách cụm
        // qua hai cue, loại trọn cụm không vừa cửa sổ). Khi xuất ra `words` thì
        // tách lại thành từng từ — một <span> chứa khoảng trắng làm mất khoảng
        // cách với từ kế tiếp ("đơn hànghoặc", đã thấy ở draft).
        parts: slice.map((w) => ({ raw: w.raw, start: w.start, end: w.end })),
      });
      i += phrase.length - 1;
    } else {
      merged.push(words[i]);
    }
  }
  words = merged;
}

const cues = [];
for (const [winFrom, winTo] of WINDOWS) {
  // Chỉ nhận từ NẰM TRỌN trong cửa sổ footage: phụ đề không được tràn sang scene
  // chữ HyperFrames (scene đó đã có typography riêng, chồng vào là rối).
  const inWin = words.filter((w) => w.start >= winFrom && w.end <= winTo);
  if (inWin.length === 0) continue;

  // Chia cụm 4–7 từ, ưu tiên ngắt ở dấu câu để cụm đọc tự nhiên.
  const groups = [];
  let cur = [];
  for (const w of inWin) {
    cur.push(w);
    const long = cur.length >= 7;
    const clause = cur.length >= 4 && w.endsClause;
    if (long || clause) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    // Cụm lẻ 1–2 từ thì gộp vào cụm trước cho khỏi nhấp nháy.
    if (cur.length <= 2 && groups.length) groups[groups.length - 1].push(...cur);
    else groups.push(cur);
  }

  groups.forEach((g, i) => {
    const first = g[0].start;
    const lastWordEnd = g[g.length - 1].end;
    // Cue vào sớm 3 frame trước từ đầu, giữ thêm 8 frame sau từ cuối (hoặc tới
    // cụm kế tiếp / hết cửa sổ) để mắt kịp đọc hết cụm.
    const nextStart = groups[i + 1] ? groups[i + 1][0].start - 3 : winTo;
    const from = Math.max(winFrom, first - 3);
    const to = Math.min(winTo, Math.max(lastWordEnd + 8, from + 12), nextStart);
    if (to <= from) return;

    cues.push({
      from,
      durationInFrames: to - from,
      words: g.flatMap((w) => {
        const hi = KEYWORDS.has(bare(w.raw));
        // Token gộp → trả về từng từ con, cùng mang cờ hi (highlight cả cụm,
        // karaoke vẫn chạy từng từ).
        const units = w.parts ?? [w];
        return units.map((u) => ({
          text: prettify(u.raw),
          start: u.start,
          end: u.end,
          ...(hi ? { hi: true } : {}),
        }));
      }),
    });
  });
}

// ---- Báo cáo để soi bằng mắt ----
const secs = (f) => (f / FPS).toFixed(2) + "s";
for (const c of cues) {
  console.log(
    `f${String(c.from).padStart(4)}..${String(c.from + c.durationInFrames).padEnd(4)} (${secs(c.from)})  ` +
      c.words.map((w) => (w.hi ? `[${w.text}]` : w.text)).join(" "),
  );
}
console.log(`\n${cues.length} cue, ${cues.reduce((n, c) => n + c.words.length, 0)} từ`);

// Cảnh báo cue chồng nhau (hai cụm hiện cùng lúc = chữ đè chữ)
for (let i = 1; i < cues.length; i++) {
  const prevEnd = cues[i - 1].from + cues[i - 1].durationInFrames;
  if (cues[i].from < prevEnd) {
    console.log(`⚠ cue ${i} chồng cue ${i - 1}: ${cues[i].from} < ${prevEnd}`);
  }
}

if (process.argv.includes("--write")) {
  const metaPath = path.join(PROJECT, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.captions = cues;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log(`\n✓ Đã ghi ${cues.length} cue vào meta.json`);
}
