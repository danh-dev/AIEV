import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { updateJob } from "../db.js";
import type { JobCtx } from "../queue.js";
import { projectDirOf, readMeta, writeMeta, type ProjectMeta } from "../meta.js";
import { ensureDir, remotionCli } from "../util.js";
import { remotionSpeedArgs } from "../renderSettings.js";
import { parseProgressLine, shortenStep } from "./progress.js";

/**
 * Job assemble-draft | assemble-final - Remotion lắp timeline từ meta.json.
 * 1. Stage asset bằng hardlink (fallback copy) vào engines/remotion/public/staging/<projectId>/
 * 2. Sinh props.resolved.json - mọi đường dẫn asset đổi thành "staging/<projectId>/<file>"
 * 3. npx remotion render Assemble --props=<abs> --output=<abs> (cwd engines/remotion)
 *    Draft thêm --crf 28. Final ghi outputs/<projectId>-v<N>.mp4 (N tự tăng) + cập nhật meta.json.
 * (Điều kiện "final phải có assemble-draft done" đã được check 409 ở route POST /api/jobs.)
 */
export async function runAssemble(ctx: JobCtx): Promise<void> {
  const { projectId, type } = ctx.job;
  const draft = type === "assemble-draft";
  const projectDir = projectDirOf(projectId);
  const meta = readMeta(projectId);

  // ---- 1. Stage asset --------------------------------------------------
  ctx.progress(0, "Stage asset vào Remotion staging");
  // Namespace "vid-" để không đụng staging của image project trùng id (img-<id>)
  const stagingId = `vid-${projectId}`;
  const stagingAbs = path.join(paths.stagingDir, stagingId);
  fs.rmSync(stagingAbs, { recursive: true, force: true });
  ensureDir(stagingAbs);

  const staged = new Map<string, string>();
  const stage = (relFromProject: string): string => {
    const cached = staged.get(relFromProject);
    if (cached) return cached;
    const srcAbs = path.join(projectDir, relFromProject);
    // meta.json do agent ghi - chặn traversal kiểu "../../.env" thoát khỏi project
    const resolved = path.resolve(srcAbs);
    if (!resolved.startsWith(path.resolve(projectDir) + path.sep)) {
      throw new Error(
        `Đường dẫn asset "${relFromProject}" nằm ngoài project ${projectId} - từ chối stage`,
      );
    }
    if (!fs.existsSync(srcAbs)) {
      throw new Error(`Thiếu asset "${relFromProject}" trong project ${projectId}`);
    }
    // Flatten đường dẫn để mọi file nằm phẳng trong staging/vid-<projectId>/
    const flat = relFromProject.split(/[\\/]+/).join("__");
    const dstAbs = path.join(stagingAbs, flat);
    try {
      fs.linkSync(srcAbs, dstAbs); // hardlink - không tốn dung lượng
    } catch {
      fs.copyFileSync(srcAbs, dstAbs); // fallback (khác ổ đĩa / FS không hỗ trợ)
    }
    const publicRel = `staging/${stagingId}/${flat}`;
    staged.set(relFromProject, publicRel);
    ctx.log(`[stage] ${relFromProject} -> ${publicRel}`);
    return publicRel;
  };

  // props = bản sao meta với đường dẫn asset đã resolve sang staging/
  const props = JSON.parse(JSON.stringify(meta)) as ProjectMeta;

  for (const scene of props.scenes ?? []) {
    if (typeof scene.src === "string" && scene.src) {
      // Scene HyperFrames: dùng file render trung gian
      const finalRel =
        typeof scene.render === "string" && scene.render
          ? scene.render
          : `renders/${scene.id}.mp4`;
      const draftRel = finalRel.replace(/\.mp4$/i, ".draft.mp4");
      let renderRel = draft ? draftRel : finalRel;
      if (!fs.existsSync(path.join(projectDir, renderRel))) {
        const alt = draft ? finalRel : draftRel;
        if (fs.existsSync(path.join(projectDir, alt))) {
          ctx.log(`[warn] Không thấy ${renderRel}, dùng tạm ${alt}`);
          renderRel = alt;
        } else {
          throw new Error(
            `Scene "${scene.id}" chưa được render (${renderRel}). Chạy job scene-${draft ? "draft" : "final"} trước.`,
          );
        }
      }
      scene.render = stage(renderRel);
    }
    if (typeof scene.srcVideo === "string" && scene.srcVideo) {
      scene.srcVideo = stage(scene.srcVideo);
    }
    // Scene ảnh tĩnh (ảnh minh họa AI) - cũng phải stage, nếu không Remotion
    // load `assets/...` từ public/ và chết 404 giữa chừng.
    if (typeof scene.srcImage === "string" && scene.srcImage) {
      scene.srcImage = stage(scene.srcImage);
    }
  }
  if (props.audio) {
    if (typeof props.audio.voice === "string" && props.audio.voice) {
      props.audio.voice = stage(props.audio.voice);
    }
    for (const sfx of props.audio.sfx ?? []) {
      if (typeof sfx.file === "string" && sfx.file) sfx.file = stage(sfx.file);
    }
    // Nhạc nền (file đã copy vào assets/ của project - xem skill background-music)
    const music = props.audio.music;
    if (music && typeof music.file === "string" && music.file) {
      music.file = stage(music.file);
    }
  }

  // ---- 2. props.resolved.json -----------------------------------------
  const propsAbs = path.join(projectDir, "props.resolved.json");
  fs.writeFileSync(propsAbs, JSON.stringify(props, null, 2) + "\n", "utf8");
  ctx.log(`[props] Đã ghi ${propsAbs}`);

  // ---- 3. Remotion render ----------------------------------------------
  ensureDir(paths.outputsDir);
  const outName = draft ? `${projectId}-draft.mp4` : `${projectId}-v${nextVersion(projectId)}.mp4`;
  const outAbs = path.join(paths.outputsDir, outName);

  ctx.progress(0, "Remotion render Assemble");
  // Concurrency + --gl angle (GPU) lấy từ tab Cấu hình - Remotion mặc định render bằng CPU thuần
  // Draft: CRF cao + x264 veryfast - encode CPU nhẹ đi nhiều, chất lượng draft không quan trọng
  const args = [
    remotionCli(),
    "render",
    "Assemble",
    `--props=${propsAbs}`,
    `--output=${outAbs}`,
    ...remotionSpeedArgs(),
    ...(draft ? ["--crf", "28", "--x264-preset", "veryfast"] : []),
  ];
  await ctx.exec(process.execPath, args, paths.remotionDir, (line) => {
    const pct = parseProgressLine(line);
    if (pct !== null) ctx.progress(pct, shortenStep(line));
  });

  if (!fs.existsSync(outAbs)) {
    throw new Error(`Remotion render xong nhưng không thấy file ${outName}`);
  }

  const outputRel = `outputs/${outName}`;
  updateJob(ctx.job.id, { outputPath: outputRel });

  // Final xong → meta.json là nguồn sự thật cho web UI
  if (!draft) {
    const freshMeta = readMeta(projectId);
    freshMeta.status = "done";
    freshMeta.output = outputRel;
    writeMeta(projectId, freshMeta);
    ctx.log(`[meta] Cập nhật status=done, output=${outputRel}`);
  }
}

/** Quét outputs/ tìm <projectId>-v<N>.mp4 lớn nhất → N+1 (bắt đầu từ 1) */
function nextVersion(projectId: string): number {
  let max = 0;
  if (fs.existsSync(paths.outputsDir)) {
    const re = new RegExp(`^${escapeRegExp(projectId)}-v(\\d+)\\.mp4$`, "i");
    for (const name of fs.readdirSync(paths.outputsDir)) {
      const m = re.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
