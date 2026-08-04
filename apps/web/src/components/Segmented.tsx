"use client";

/**
 * Chọn MỘT trong vài lựa chọn ngắn (2-4 mục, nhãn một hai chữ): vi/en,
 * sáng/tối, 16:9 / 9:16, tự động / thủ công.
 *
 * Thay cho 6 biến thể tự chế trước đây - 3 bán kính khác nhau, 3 kiểu padding,
 * 2 màu chữ lúc không được chọn, và một bản còn quên cả role.
 *
 * Lựa chọn "to" cần tiêu đề + mô tả thì dùng <OptionCard> chứ không phải cái
 * này: nhãn dài nhét vào segmented là vỡ hàng ngay trên màn hẹp.
 *
 * ```tsx
 * <Segmented
 *   label={t("brief.aspect")}
 *   value={aspect}
 *   onChange={setAspect}
 *   options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }]}
 * />
 * ```
 */

import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Tooltip - dùng khi nhãn phải ngắn nhưng ý nghĩa cần một câu */
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  size = "sm",
  className = "",
}: {
  /** Nhãn nhóm cho trình đọc màn hình - nhóm radio không có nhãn thì chỉ đọc
      được từng mục rời rạc, không biết đang chọn cái gì */
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  disabled?: boolean;
  /**
   * sm (32px, mặc định) đứng một mình; md (36px) khi nằm cùng HÀNG NGANG với
   * ô nhập hoặc nút - lệch 4px giữa các control cạnh nhau nhìn ra ngay.
   */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={`seg ${size === "md" ? "seg-md" : ""} ${className}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.title}
          disabled={disabled || opt.disabled}
          onClick={() => onChange(opt.value)}
          className="seg-item"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
