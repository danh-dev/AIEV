"use client";

import { X } from "lucide-react";
import { useState } from "react";

/**
 * Chip input dùng chung (modal tạo project, form khác):
 * gõ + Enter để thêm tag, X để xóa, tự chống trùng.
 */
export function TagInput({
  tags,
  onChange,
  id,
  placeholder = "Gõ tag rồi Enter để thêm…",
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function add() {
    const tag = input.trim();
    if (!tag) return;
    setInput("");
    if (tags.includes(tag)) return;
    onChange([...tags, tag]);
  }

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="chip">
              {t}
              <button
                type="button"
                aria-label={`Xóa tag ${t}`}
                className="text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--danger)]"
                onClick={() => onChange(tags.filter((x) => x !== t))}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
