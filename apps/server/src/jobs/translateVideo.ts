import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { updateJob } from "../db.js";
import type { JobCtx } from "../queue.js";
import { remotionSpeedArgs } from "../renderSettings.js";
import { segmentsToCues } from "../subtitles.js";
import { transcribeVideo } from "../transcribe.js";
import { parseTranscriptJson } from "../transcript.js";
import {
  outputPathOf,
  patchTranslateVideo,
  readTranslateVideo,
  sourceAbsOf,
  transcriptPathOf,
  translateVideoDirOf,
  type SubtitleStyle,
  type TranslateVideoMeta,
  type TranslatedCue,
} from "../translateVideoMeta.js";
import { ensureDir, remotionCli, toRepoRel } from "../util.js";
import { parseProgressLine, shortenStep } from "./progress.js";

/**
 * Job "translate-video" - hai bước NẶNG của phiên Dịch video.
 * `job.projectId` là id phiên (translate-video/<id>), `job.sceneId` là step:
 *  - "transcribe": whisper bóc lời video nguồn -> transcript.json -> cues gốc
 *  - "render"    : stage nguồn + sinh props Remotion + render ra output.mp4
 *
 * Bước DỊCH không nằm ở đây: nó chạy đồng bộ trong route (POST /:id/translate),
 * giống /script của Text to video - vài chục giây, và người dùng phải đọc lại
 * bản dịch trước khi tốn thời gian render.
 *
 * KHÁC text-to-video: ở đây KHÔNG có promise chạy nền sau khi job kết thúc. Mọi
 * việc đều tất định và kết thúc TRONG job, nên không cần reconcile() - job xong
 * là trạng thái trên đĩa đã đúng, kể cả khi server restart ngay sau đó.
 */
export async function runTranslateVideo(ctx: JobCtx): Promise<void> {
  // Queue nhét id phiên vào projectId (giống auto-cut) - xem busyKeyOf ở queue.ts
  const id = ctx.job.projectId;
  const step = ctx.job.sceneId === "render" ? "render" : "transcribe";

  try {
    if (step === "render") await stepRender(ctx, id);
    else await stepTranscribe(ctx, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      if (ctx.isCanceled()) {
        // Người dùng tự bấm hủy KHÔNG phải lỗi: đưa phiên về trạng thái CHẠY LẠI
        // ĐƯỢC thay vì "failed" (không banner đỏ, không phải làm lại từ đầu).
        const cur = readTranslateVideo(id);
        patchTranslateVideo(id, { status: recoverableStatus(cur, step), error: null });
      } else {
        patchTranslateVideo(id, { status: "failed", error: message });
      }
    } catch {
      /* phiên có thể đã bị xóa giữa chừng - vẫn phải ném lỗi gốc ra queue */
    }
    throw err;
  }
}

/** Trạng thái quay về sau khi hủy - bám theo dữ liệu ĐANG CÓ trên đĩa */
function recoverableStatus(
  meta: TranslateVideoMeta,
  step: "transcribe" | "render",
): TranslateVideoMeta["status"] {
  if (step === "render") return meta.cues.length > 0 ? "translated" : "transcribed";
  return meta.transcriptFile ? "transcribed" : "draft";
}

// ================================================================== Step "transcribe"

async function stepTranscribe(ctx: JobCtx, id: string): Promise<void> {
  const meta = patchTranslateVideo(id, { status: "transcribing", error: null });
  const videoAbs = sourceAbsOf(meta);
  const outJsonAbs = transcriptPathOf(id);
  ensureDir(translateVideoDirOf(id));

  /**
   * "auto" đi thẳng xuống whisper: transcribe.ts truyền `language=None` cho
   * faster-whisper để nó tự dò. Đây là mặc định đúng của tính năng này -
   * người dùng đưa video tiếng nước ngoài thường KHÔNG biết đó là tiếng gì,
   * ép sẵn tiếng Việt là bóc sai toàn bộ mà không có lỗi nào báo ra.
   * Ngôn ngữ whisper nhận ra được ghi lại vào meta ở dưới.
   */
  const language = meta.sourceLang === "auto" ? "auto" : meta.sourceLang;
  if (language === "auto") {
    ctx.log("[translate] sourceLang = auto - để whisper tự dò ngôn ngữ của video");
  }

  ctx.progress(2, "Bóc lời video nguồn");
  const res = await transcribeVideo({
    videoAbs,
    outJsonAbs,
    language,
    onLog: (line) => ctx.log(line),
    // BẮT BUỘC: không truyền thì hủy job xong whisper vẫn chạy tiếp và ăn GPU
    isCanceled: () => ctx.isCanceled(),
  });
  if (ctx.isCanceled()) throw new Error("Job đã bị hủy");
  ctx.log(
    `[translate] transcript: ${res.segments} đoạn, ${res.durationSec.toFixed(1)}s, ngôn ngữ ${res.language}`,
  );

  // Vá ngay sau mỗi bước con: transcribe là phần đắt nhất, hỏng ở bước sau thì
  // vẫn còn nguyên file này để chạy lại từ giữa.
  patchTranslateVideo(id, {
    transcriptFile: toRepoRel(outJsonAbs),
    // Phiên để "auto" thì ghi lại ngôn ngữ ĐÃ DÙNG - lần dịch sau khỏi đoán
    ...(meta.sourceLang === "auto" ? { sourceLang: res.language } : {}),
  });

  ctx.progress(88, "Chia câu phụ đề");
  const cues = cuesFromTranscript(outJsonAbs);
  if (cues.length === 0) {
    throw new Error(
      "Transcript không chia được câu phụ đề nào - kiểm tra lại video có tiếng nói không.",
    );
  }
  ctx.log(`[translate] ${cues.length} câu phụ đề gốc, sẵn sàng để dịch`);

  patchTranslateVideo(id, { cues, status: "transcribed", error: null });
  ctx.progress(100, `Đã bóc ${cues.length} câu`);
}

/**
 * transcript.json -> danh sách cue GỐC (chưa dịch).
 *
 * Dùng `segmentsToCues` của hệ thống chứ KHÔNG viết bộ chia câu thứ hai: nó đã
 * cắt đúng ranh giới TỪ (không bao giờ cụt dấu tiếng Việt) và cân hai dòng.
 * `text` = `original` ở bước này, để UI có cái hiện ngay và để bước dịch luôn
 * biết câu gốc là gì kể cả sau khi dịch đè lên `text`.
 */
export function cuesFromTranscript(transcriptAbs: string): TranslatedCue[] {
  if (!fs.existsSync(transcriptAbs)) return [];
  let segments;
  try {
    segments = parseTranscriptJson(JSON.parse(fs.readFileSync(transcriptAbs, "utf8")));
  } catch {
    return [];
  }
  if (!segments || segments.length === 0) return [];
  return segmentsToCues(segments).map((c) => ({
    start: Math.round(c.start * 1000) / 1000,
    end: Math.round(c.end * 1000) / 1000,
    text: c.text,
    original: c.text,
  }));
}

// ================================================================== Step "render"

/** Khung dùng khi ffprobe không đọc được kích thước nguồn (hiếm - nhưng phải có số) */
const FALLBACK_WIDTH = 1080;
const FALLBACK_HEIGHT = 1920;

async function stepRender(ctx: JobCtx, id: string): Promise<void> {
  const meta = patchTranslateVideo(id, { status: "rendering", error: null });
  if (meta.mode !== "subtitle") {
    throw new Error(
      `Chế độ "${meta.mode}" chưa render được - giai đoạn này mới làm đường phụ đề.`,
    );
  }
  if (meta.cues.length === 0) {
    throw new Error("Chưa có câu phụ đề nào để ghép - chạy bước bóc lời và dịch trước.");
  }
  const videoAbs = sourceAbsOf(meta);
  const dir = translateVideoDirOf(id);
  ensureDir(dir);

  // ---- 1. Stage video nguồn --------------------------------------------
  // Remotion chỉ đọc file qua staticFile() trong public/ - đường dẫn tuyệt đối
  // trên đĩa sẽ 404 giữa chừng render. Namespace "tvd-" tách khỏi staging của
  // video project (vid-) và image project (img-) trùng id.
  ctx.progress(0, "Stage video nguồn vào Remotion staging");
  const stagingId = `tvd-${id}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  const ext = path.extname(videoAbs).toLowerCase() || ".mp4";
  const stagedName = `source${ext}`;
  const stagedAbs = path.join(stagingAbs, stagedName);
  try {
    fs.linkSync(videoAbs, stagedAbs); // hardlink - không tốn dung lượng
  } catch {
    fs.copyFileSync(videoAbs, stagedAbs); // khác ổ đĩa / FS không hỗ trợ hardlink
  }
  const stagedRel = `staging/${stagingId}/${stagedName}`;
  ctx.log(`[stage] ${meta.source.relPath} -> ${stagedRel}`);

  // ---- 2. props cho Remotion -------------------------------------------
  const props = buildProps(meta, stagedRel);
  const propsAbs = path.join(dir, "props.resolved.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(
    `[props] ${props.width}x${props.height} @${props.fps}fps, ${props.subtitles.length} câu -> ${propsAbs}`,
  );

  // ---- 3. Remotion render ----------------------------------------------
  const outAbs = outputPathOf(id);
  ctx.progress(0, "Remotion ghép phụ đề");
  const args = [
    remotionCli(),
    "render",
    "Assemble",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionSpeedArgs(),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(pct, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error("Remotion render xong nhưng không thấy file output.mp4");
  }

  const outputRel = toRepoRel(outAbs);
  updateJob(ctx.job.id, { outputPath: outputRel });
  patchTranslateVideo(id, { outputFile: outputRel, status: "done", error: null });
  ctx.progress(100, "Đã ghép phụ đề");
}

/** Một câu phụ đề trong props Remotion - mốc là FRAME TUYỆT ĐỐI trên timeline */
interface SubtitleProp {
  from: number;
  durationInFrames: number;
  text: string;
}

interface TranslateProps {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  status: string;
  scenes: Array<Record<string, unknown>>;
  audio: { voice: null; sfx: never[]; music: null };
  captions: never[];
  overlays: never[];
  watermark: null;
  output: null;
  subtitles: SubtitleProp[];
  subtitleStyle: SubtitleStyle;
}

/**
 * props.resolved.json cho composition "Assemble": đúng một scene là video nguồn
 * (KHÔNG mute - tiếng gốc chính là thứ người xem cần nghe), không voice, không
 * sfx, không logo. Phần mới là `subtitles` + `subtitleStyle`.
 *
 * manifestSchema bên Remotion là looseObject nên field lạ đi qua được: nếu bản
 * Remotion trên máy chưa có SubtitleTrack thì video vẫn render ra, chỉ là không
 * có chữ - không bao giờ chết giữa chừng vì props.
 */
function buildProps(meta: TranslateVideoMeta, stagedRel: string): TranslateProps {
  const fps = pickFps(meta.source.fps);
  const { width, height } = pickSize(meta.source);
  const durationSec = meta.source.durationSec ?? lastCueEnd(meta.cues);
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));

  return {
    id: meta.id,
    name: meta.name,
    width,
    height,
    fps,
    status: "rendering",
    scenes: [
      {
        id: "source",
        srcVideo: stagedRel,
        from: 0,
        durationInFrames,
        // Tiếng gốc PHẢI giữ: ghép phụ đề mà tắt tiếng là ra video câm
        muted: false,
        srcImage: null,
      },
    ],
    audio: { voice: null, sfx: [], music: null },
    captions: [],
    overlays: [],
    watermark: null,
    output: null,
    subtitles: toSubtitleProps(meta.cues, fps, durationInFrames),
    // Gửi nguyên bộ: SubtitleTrack tự nhân theo đơn vị tỉ lệ `u` của nó (dọc
    // chuẩn hóa theo cao 1920, ngang theo cao 1080)
    subtitleStyle: meta.subtitleStyle,
  };
}

/**
 * Giây -> FRAME TUYỆT ĐỐI, đúng cách sfx `atFrame` làm: round(sec * fps). Một
 * hệ quy chiếu duy nhất cho cả timeline thì soi bằng mắt mới ra được lỗi lệch.
 * Cue vượt quá cuối video bị kẹp lại - Remotion không vẽ ngoài composition.
 */
function toSubtitleProps(
  cues: TranslatedCue[],
  fps: number,
  totalFrames: number,
): SubtitleProp[] {
  const out: SubtitleProp[] = [];
  for (const cue of cues) {
    const from = Math.max(0, Math.round(cue.start * fps));
    if (from >= totalFrames) continue;
    const end = Math.min(totalFrames, Math.round(cue.end * fps));
    const durationInFrames = Math.max(1, end - from);
    out.push({ from, durationInFrames, text: cue.text });
  }
  return out;
}

/**
 * fps làm tròn về số nguyên: nguồn 29,97 giữ nguyên sẽ làm mọi phép đổi
 * giây -> frame ra số lẻ và lệch dần về cuối video. Thời lượng KHÔNG đổi vì
 * Remotion cắt footage theo GIÂY (from/to), fps chỉ là nhịp lấy mẫu.
 */
function pickFps(raw: number | null): number {
  const fps = raw && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 30;
  return Math.min(120, Math.max(1, fps));
}

/** Kích thước đầu ra = kích thước nguồn, ép về số chẵn (H.264 yêu cầu) */
function pickSize(source: { width: number | null; height: number | null }): {
  width: number;
  height: number;
} {
  const even = (v: number | null, fallback: number): number => {
    const n = v && Number.isFinite(v) && v > 0 ? v : fallback;
    return Math.max(2, Math.round(n / 2) * 2);
  };
  return {
    width: even(source.width, FALLBACK_WIDTH),
    height: even(source.height, FALLBACK_HEIGHT),
  };
}

/** Video chưa đo được thời lượng - lấy mốc cue cuối làm giới hạn dưới */
function lastCueEnd(cues: TranslatedCue[]): number {
  let max = 0;
  for (const c of cues) max = Math.max(max, c.end);
  return max;
}
