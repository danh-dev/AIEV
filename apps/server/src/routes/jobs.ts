import { Router } from "express";
import { nanoid } from "nanoid";
import * as db from "../db.js";
import { broadcast } from "../events.js";
import { IMAGE_GEN_STEPS, imageProjectExists, type ImageGenStep } from "../imageMeta.js";
import { projectExists } from "../meta.js";
import { queue } from "../queue.js";
import { HttpError } from "../util.js";

const router = Router();

// GET /api/jobs?limit=50 — mới nhất trước
router.get("/", (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json(db.listJobs(limit).map(db.jobToApi));
});

// GET /api/jobs/:id — Job + log đầy đủ
router.get("/:id", (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) throw new HttpError(404, "JOB_NOT_FOUND", `Không tìm thấy job "${req.params.id}"`);
  res.json({ ...db.jobToApi(job), log: job.log });
});

// POST /api/jobs — { projectId, type, sceneId? } → 201 Job
router.post("/", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const type = typeof body.type === "string" ? body.type : "";
  const sceneId =
    typeof body.sceneId === "string" && body.sceneId.trim() ? body.sceneId.trim() : null;

  if (!projectId) throw new HttpError(400, "INVALID_PROJECT_ID", "Thiếu projectId");
  if (!db.JOB_TYPES.includes(type as db.JobType)) {
    throw new HttpError(
      400,
      "INVALID_TYPE",
      `type phải là một trong: ${db.JOB_TYPES.join(", ")}`,
    );
  }
  if (type === "image-gen") {
    // Job tạo ảnh: projectId là image project (image-projects/<id>/meta.json),
    // sceneId mang step cần chạy (all | background | compose)
    if (!imageProjectExists(projectId)) {
      throw new HttpError(
        404,
        "IMAGE_NOT_FOUND",
        `Không tìm thấy image project "${projectId}"`,
      );
    }
    if (sceneId && !IMAGE_GEN_STEPS.includes(sceneId as ImageGenStep)) {
      throw new HttpError(
        400,
        "INVALID_STEP",
        `sceneId (step) của job image-gen phải là một trong: ${IMAGE_GEN_STEPS.join(", ")}`,
      );
    }
  } else {
    if (!projectExists(projectId)) {
      throw new HttpError(404, "PROJECT_NOT_FOUND", `Không tìm thấy project "${projectId}"`);
    }

    // Quy tắc queue: từ chối job *-final nếu chưa có assemble-draft thành công cho project
    if (type.endsWith("-final") && !db.hasDoneAssembleDraft(projectId)) {
      throw new HttpError(
        409,
        "DRAFT_REQUIRED",
        `Project "${projectId}" chưa có assemble-draft thành công — draft luôn trước final.`,
      );
    }
  }

  const job = db.createJob({
    id: `job_${nanoid()}`,
    projectId,
    type: type as db.JobType,
    sceneId,
  });
  broadcast("job", db.jobToApi(job));
  queue.enqueue(job.id);
  res.status(201).json(db.jobToApi(job));
});

// POST /api/jobs/:id/cancel — kill process nếu đang chạy
router.post("/:id/cancel", (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) throw new HttpError(404, "JOB_NOT_FOUND", `Không tìm thấy job "${req.params.id}"`);
  if (job.status === "queued" || job.status === "running") {
    queue.cancel(job.id);
  }
  res.json(db.jobToApi(db.getJob(job.id)!));
});

export default router;
