"use client";

import { ArrowLeft, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteSkill, getSkill, updateSkill } from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PageHeader } from "@/components/PageHeader";

export default function SkillDetailPage() {
  const params = useParams<{ name: string }>();
  const name = params.name;
  const router = useRouter();

  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    getSkill(name)
      .then((s) => {
        if (stale) return;
        setContent(s.content);
        setDirty(false);
        setError(null);
      })
      .catch((e) => {
        if (stale) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [name]);

  async function onSave() {
    if (content == null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateSkill(name, content);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Xóa skill "${name}"? Hành động này không hoàn tác được.`))
      return;
    try {
      await deleteSkill(name);
      router.push("/skills");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    // Full-width + editor cao hết viewport — tối đa diện tích soạn thảo
    <div className="flex h-[calc(100vh-56px-40px)] w-full flex-col gap-4">
      <PageHeader
        title={name}
        subtitle=".claude/skills — Skill mới/sửa sẽ được Claude nhận ở phiên làm việc kế tiếp."
        actions={
          <>
            <Link href="/skills">
              <Button variant="secondary">
                <ArrowLeft size={15} strokeWidth={2} />
                Danh sách
              </Button>
            </Link>
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 size={15} strokeWidth={2} />
              Xóa
            </Button>
            <Button onClick={onSave} disabled={!dirty || saving}>
              <Save size={15} strokeWidth={2} />
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message="Thao tác với skill thất bại." detail={error} />}
      {savedAt && !dirty && !error && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--success-bg)] px-4 py-2 text-sm text-[var(--success)]">
          Đã lưu.
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col">
        {content != null ? (
          <textarea
            className="input h-full min-h-0 w-full flex-1 resize-none font-mono text-[13px] leading-relaxed"
            value={content}
            spellCheck={false}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
          />
        ) : !error ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Đang tải…
          </p>
        ) : null}
      </Card>
    </div>
  );
}
