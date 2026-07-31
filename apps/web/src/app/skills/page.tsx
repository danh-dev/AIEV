"use client";

import { BookOpen, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createSkill, getSkills, type SkillMeta } from "@/lib/api";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { SkillGenerateModal } from "@/components/SkillGenerateModal";
import { formatBytes, formatRelative, KEBAB_RE } from "@/lib/format";
import { useT } from "@/lib/i18n";

const skillTemplate = (name: string) => `---
name: ${name}
description: Mô tả ngắn gọn skill này làm gì và khi nào Claude nên dùng.
---

# ${name}

## Khi nào dùng

- ...

## Hướng dẫn

1. ...
`;

export default function SkillsPage() {
  const { t } = useT();
  const router = useRouter();
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Modal "Tạo skill bằng AI" — remount mỗi lần mở (key) để form sạch
  const [aiOpen, setAiOpen] = useState(false);
  const [aiKey, setAiKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setSkills(await getSkills());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameValid = KEBAB_RE.test(name);

  async function onCreate() {
    if (!nameValid || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createSkill({ name, content: skillTemplate(name) });
      setOpen(false);
      setName("");
      router.push(`/skills/${name}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav.skills")}
        subtitle={t("skills.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setOpen(true)}>
              <Plus size={16} strokeWidth={2} />
              {t("skills.create")}
            </Button>
            <Button
              onClick={() => {
                setAiKey((k) => k + 1);
                setAiOpen(true);
              }}
            >
              <Sparkles size={16} strokeWidth={2} />
              {t("skills.create-ai")}
            </Button>
          </div>
        }
      />

      <p className="text-xs text-[var(--text-muted)]">
        {t("skills.next-session-note")}
      </p>

      {error && (
        <ErrorBanner message={t("skills.load-error")} detail={error} />
      )}

      {skills && skills.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {skills.map((s) => (
            <Link key={s.name} href={`/skills/${s.name}`}>
              <Card className="h-full transition-colors duration-150 hover:border-[var(--primary)]">
                <div className="flex items-start gap-3">
                  <BookOpen
                    size={18}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-[var(--primary)]"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{s.name}</h2>
                    <p className="mt-1 line-clamp-3 text-sm text-[var(--text-muted)]">
                      {s.description}
                    </p>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {formatRelative(s.updatedAt)} · {formatBytes(s.sizeBytes)}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : skills ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            description={t("skills.empty")}
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus size={16} strokeWidth={2} />
                {t("skills.create")}
              </Button>
            }
          />
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          {t("common.loading")}
        </p>
      )}

      <Modal
        title={t("skills.create")}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onCreate} disabled={!nameValid || creating}>
              {creating ? t("common.creating") : t("skills.create-short")}
            </Button>
          </>
        }
      >
        {createError && <ErrorBanner message={createError} />}
        <div>
          <label className="label" htmlFor="skill-name">
            {t("skills.name-label")}
          </label>
          <input
            id="skill-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: tiktok-hook-mo-dau"
          />
          {name && !nameValid && (
            <p className="mt-1 text-xs text-[var(--danger)]">
              {t("skills.kebab-error")}
            </p>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {t("skills.template-note")}
        </p>
      </Modal>

      <SkillGenerateModal
        key={aiKey}
        open={aiOpen}
        skills={skills ?? []}
        onClose={() => setAiOpen(false)}
        onSaved={(skillName) => {
          setAiOpen(false);
          load();
          router.push(`/skills/${skillName}`);
        }}
      />
    </div>
  );
}
