"use client";

// TẠM - route nháp để kiểm chứng primitives, XÓA trước khi kết thúc.

import { useState } from "react";
import { ShellRightPanel } from "@/components/Shell";
import {
  OutputBlock,
  Workspace,
  WorkspaceBlock,
  WorkspaceColumn,
  type WorkspaceStatus,
} from "@/components/Workspace";
import { useCollapseGroup } from "@/lib/useCollapsible";
import { useT } from "@/lib/i18n";

const KEYS = ["source", "voice", "config", "output", "qc"] as const;

export default function ScratchPage() {
  const { t } = useT();
  const [status, setStatus] = useState<WorkspaceStatus>("idle");
  const group = useCollapseGroup({
    keys: KEYS,
    finished: status === "done",
    keepExpanded: ["output"],
  });

  return (
    <>
      <ShellRightPanel title="Nhật ký AI">
        <div className="card">panel content</div>
      </ShellRightPanel>

      <div className="mb-4 flex gap-2">
        {(["idle", "running", "done", "failed"] as const).map((s) => (
          <button key={s} className="btn btn-secondary btn-sm" onClick={() => setStatus(s)}>
            {s}
          </button>
        ))}
        <span className="chip">{group.anyCollapsed ? t("workspace.done-collapsed") : "-"}</span>
      </div>

      <Workspace>
        <WorkspaceColumn role="source" title={t("workspace.col.source")}>
          <WorkspaceBlock
            id="s-source"
            title="Nguồn"
            summary="một dòng tóm tắt"
            collapsed={group.isCollapsed("source")}
            onToggle={() => group.toggle("source")}
          >
            <textarea className="input" rows={6} defaultValue="nội dung nguồn" />
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="setup" title={t("workspace.col.setup")}>
          <WorkspaceBlock
            id="s-voice"
            title="Giọng đọc"
            summary="chưa chọn"
            collapsed={group.isCollapsed("voice")}
            onToggle={() => group.toggle("voice")}
          >
            <p>voice picker</p>
          </WorkspaceBlock>
          <WorkspaceBlock id="s-config" title="Cấu hình" summary="1080x1920" defaultCollapsed>
            <p>config</p>
          </WorkspaceBlock>
        </WorkspaceColumn>

        <WorkspaceColumn role="output" title={t("workspace.col.output")}>
          <OutputBlock
            status={status}
            aspect="9 / 16"
            videoUrl={status === "done" ? "/media/x.mp4" : null}
            progress={status === "running" ? 42 : null}
            step="render scene 3"
            error="ffmpeg exit 1"
            collapsed={group.isCollapsed("output")}
            onToggle={() => group.toggle("output")}
          >
            <span className="chip">00:42</span>
          </OutputBlock>
          <WorkspaceBlock
            id="s-qc"
            title="QC"
            summary="chưa chạy"
            collapsed={group.isCollapsed("qc")}
            onToggle={() => group.toggle("qc")}
          >
            <p>qc</p>
          </WorkspaceBlock>
        </WorkspaceColumn>
      </Workspace>
    </>
  );
}
