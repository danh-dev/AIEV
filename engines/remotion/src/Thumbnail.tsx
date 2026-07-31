import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import {
  useVietnameseFont,
  VIETNAMESE_FONT_FAMILY,
  vietnameseFontFaceCss,
} from "./components/vietnameseFont";
import type { ThumbnailProps } from "./thumbnailManifest";

/**
 * Still `Thumbnail` — ảnh bìa cho video đã render.
 *
 * Xếp lớp (dưới → trên):
 *  1) ảnh nền Gemini full-bleed, làm tối theo `backgroundDim`
 *  2) scrim dọc — tối ở giữa/dưới để chữ và chân dung nổi khỏi nền
 *  3) dải chân dung FULL KHỔ neo đáy, mask mờ dần cả hai mép (mép trên hòa vào
 *     nền Gemini, mép dưới tan hẳn) — KHÔNG cắt tròn, không viền
 *  4) khối title CANH CHÍNH GIỮA khung, vẽ trên cùng nên không bao giờ bị che
 *  5) badge brand ở mép trên — chỉ vẽ khi `brandName` khác rỗng
 *
 * ⚠️ Chữ ĐẶC (color), không `background-clip: text` — bài học chung của repo:
 * gradient text làm cụt dấu tiếng Việt (ằ, ộ). Nhấn bằng màu + glow thay vì
 * gradient. Padding trên/dưới của span bù cho dấu chồng hai tầng.
 */

const rgba = (hex: string, alpha: number): string => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export const Thumbnail: React.FC<ThumbnailProps> = ({
  background,
  portrait,
  portraitScale,
  portraitFadeTop,
  portraitFadeBottom,
  portraitFadeSide,
  title,
  highlight,
  brandName,
  backgroundDim,
  colors,
}) => {
  useVietnameseFont();
  const { width, height } = useVideoConfig();

  // Đơn vị tỉ lệ theo canvas dọc chuẩn 1080×1920 — cùng quy ước HighlightTrack.
  const vertical = height >= width;
  const u = vertical ? height / 1920 : height / 1080;

  const titleSize = Math.round((vertical ? 118 : 92) * u);
  const portraitWidth = Math.round(width * portraitScale);
  // Mask dọc: mép trên hòa vào nền, mép dưới tan hẳn ("mờ dần về phía dưới").
  const maskY = `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) ${portraitFadeTop}%, rgba(0,0,0,1) ${portraitFadeBottom}%, rgba(0,0,0,0) 100%)`;
  // Mask ngang: làm mềm hai mép để ảnh không thành hình chữ nhật dán lên nền.
  // Đặt trên phần tử LỒNG NHAU thay vì `mask-composite` — hai mask một tầng
  // giao nhau tự nhiên, không phụ thuộc hỗ trợ mask-composite của Chromium.
  const maskX = `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) ${portraitFadeSide}%, rgba(0,0,0,1) ${100 - portraitFadeSide}%, rgba(0,0,0,0) 100%)`;
  // Bù dấu chồng hai tầng (Ằ) phía trên, dấu nặng (ậ) phía dưới.
  const padTop = Math.round(titleSize * 0.16);
  const padBottom = Math.round(titleSize * 0.1);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.background,
        fontFamily: `'${VIETNAMESE_FONT_FAMILY}', 'Segoe UI', sans-serif`,
      }}
    >
      <style>{vietnameseFontFaceCss}</style>

      {/* 1) Nền Gemini */}
      {background ? (
        <AbsoluteFill>
          <Img
            src={staticFile(background)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: `brightness(${1 - backgroundDim}) saturate(0.92)`,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* 2) Scrim dọc — giữ sáng phần đỉnh (chủ thể Gemini), tối dần xuống chữ */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${rgba(colors.background, 0.1)} 0%, ${rgba(
            colors.background,
            0.28,
          )} 34%, ${rgba(colors.background, 0.82)} 56%, ${rgba(colors.background, 0.94)} 100%)`,
        }}
      />
      {/* Glow brand sau khối chữ — nối chữ với nền, không để chữ "dán" lên ảnh */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(${Math.round(760 * u)}px ${Math.round(
            420 * u,
          )}px at 50% 50%, ${rgba(colors.primary, 0.2)} 0%, ${rgba(
            colors.primary,
            0.07,
          )} 52%, transparent 100%)`,
        }}
      />

      {/* 5) Badge brand */}
      {brandName ? (
        <div
          style={{
            position: "absolute",
            top: Math.round(96 * u),
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(12 * u),
              padding: `${Math.round(12 * u)}px ${Math.round(26 * u)}px`,
              borderRadius: 50,
              background: rgba(colors.primary, 0.16),
              boxShadow: `inset 0 0 0 1px ${rgba(colors.primary, 0.5)}`,
              fontSize: Math.round(28 * u),
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: colors.primary,
            }}
          >
            <span
              style={{
                width: Math.round(12 * u),
                height: Math.round(12 * u),
                borderRadius: "50%",
                background: colors.primary,
              }}
            />
            {brandName}
          </div>
        </div>
      ) : null}

      {/* 3) Dải chân dung full khổ, neo đáy, mask mờ dần hai mép */}
      {portrait ? (
        <>
          {/* Quầng sáng brand phía sau người — tạo chiều sâu, tách khỏi nền */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              transform: "translateX(-50%)",
              width: Math.round(portraitWidth * 1.5),
              height: Math.round(height * 0.5),
              background: `radial-gradient(${Math.round(560 * u)}px ${Math.round(
                480 * u,
              )}px at 50% 46%, ${rgba(colors.accent, 0.18)} 0%, transparent 72%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              transform: "translateX(-50%)",
              width: portraitWidth,
              maskImage: maskY,
              WebkitMaskImage: maskY,
            }}
          >
            <div
              style={{
                maskImage: maskX,
                WebkitMaskImage: maskX,
              }}
            >
              <Img
                src={staticFile(portrait)}
                style={{
                  // Giữ tỉ lệ gốc — bề rộng quyết định, cao tự suy ra.
                  width: "100%",
                  height: "auto",
                  display: "block",
                  // Hạ bão hòa + tăng nhẹ tương phản để da/áo hợp tông nền tối
                  filter: "saturate(0.9) contrast(1.05) brightness(0.98)",
                }}
              />
            </div>
          </div>
        </>
      ) : null}

      {/* 4) Title — CHÍNH GIỮA khung, lớp trên cùng */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          transform: "translateY(-50%)",
          padding: `0 ${Math.round(84 * u)}px`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 1.16,
            letterSpacing: "-0.03em",
            color: colors.text,
            textShadow: `0 ${Math.round(18 * u)}px ${Math.round(48 * u)}px rgba(0,0,0,0.6)`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: `${padTop}px 0 ${padBottom}px`,
            }}
          >
            {title}
          </span>
          {highlight ? (
            <span
              style={{
                display: "inline-block",
                margin: `0 0 0 ${Math.round(titleSize * 0.16)}px`,
                padding: `${padTop}px 0 ${padBottom}px`,
                color: colors.primary,
                filter: `drop-shadow(0 0 ${Math.round(34 * u)}px ${rgba(colors.primary, 0.55)})`,
              }}
            >
              {highlight}
            </span>
          ) : null}
        </div>

        {/* Kẻ gradient dưới khối chữ */}
        <div
          style={{
            width: Math.round(220 * u),
            height: Math.max(2, Math.round(7 * u)),
            borderRadius: 50,
            margin: `${Math.round(30 * u)}px auto 0`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
            boxShadow: `0 0 ${Math.round(28 * u)}px ${rgba(colors.primary, 0.6)}`,
          }}
        />
      </div>

    </AbsoluteFill>
  );
};
