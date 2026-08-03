"use client";

/**
 * Chọn giọng đọc cho tab "Text to video": engine + model TTS + ngôn ngữ + giọng
 * + "cách đọc".
 *
 * Vì sao chọn ENGINE trước mọi thứ khác: hai engine không cùng kho giọng, không
 * cùng chi phí, và không cùng điều kiện chạy (Gemini cần API key + mạng, VieNeu
 * cần Python + gói cài trên máy). Mọi lựa chọn phía dưới đều phụ thuộc engine
 * nên nó phải nằm trên cùng. Engine nào máy chưa chạy được thì KHÓA lại kèm lý
 * do - cho bấm vào một thứ chắc chắn hỏng là đẩy người dùng vào lỗi.
 *
 * Vì sao không dùng một <select> khổng lồ: có 30 giọng Gemini, mỗi giọng chỉ
 * khác nhau ở CHẤT giọng - nhìn tên không đoán được. Người dùng cần lọc và NGHE
 * THỬ trước khi chọn, việc đó một select không làm được.
 *
 * Vì sao nhóm theo GIỚI TÍNH (Gemini) chứ không theo chữ cái đầu: không ai đi
 * tìm "giọng bắt đầu bằng chữ K", người ta tìm "một giọng nam". Chữ cái đầu là
 * thông tin duy nhất mà cái tên tự nó đã nói ra - nhóm theo nó là nhóm theo con
 * số không. Với VieNeu thì nhóm theo LOẠI (có sẵn / đã nhân bản): kho chỉ vài
 * giọng, và ranh giới người dùng quan tâm là "giọng tôi tự tạo" chứ không phải
 * nam hay nữ (chất giọng đã ghi ngay dưới tên rồi).
 *
 * Nghe thử Gemini tốn tiền (mỗi lần bấm là một lần tổng hợp thật) nên: chỉ phát
 * khi bấm nút, không tự phát lúc mở trang hay khi rê chuột, và mỗi lúc chỉ một
 * giọng được phát - bấm giọng khác thì giọng đang phát dừng ngay. Quy tắc này
 * giữ nguyên cho VieNeu: ở đó không tốn tiền nhưng đọc chậm cỡ thời gian thật.
 *
 * Mô tả chất giọng ("chắc chắn, dứt khoát") dịch theo giao diện qua `timbreKey`,
 * KHÔNG lấy thẳng `label` của server (label luôn là tiếng Việt) - có vậy đổi UI
 * sang tiếng Anh thì mô tả giọng cũng sang tiếng Anh.
 */

import {
  AlertTriangle,
  Cloud,
  Cpu,
  Gauge,
  Globe,
  Loader2,
  Play,
  Search,
  Square,
  Timer,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTtsEngines,
  getTtsLanguages,
  getTtsModels,
  getTtsVoices,
  previewTtsVoice,
  TTS_ENGINES,
  type TextToVideoVoice,
  type TtsEngine,
  type TtsEngineStatus,
  type TtsGender,
  type TtsLanguage,
  type TtsModel,
  type TtsRegion,
  type TtsVoice,
  type TtsVoiceKind,
} from "@/lib/api";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InfoHint } from "@/components/InfoHint";
import { useT } from "@/lib/i18n";

/**
 * Các mức tốc độ đọc bày ra cho người dùng.
 *
 * Dừng ở x1.5: từ đó trở lên atempo bắt đầu nghe ra tiếng "lắp", mà mục đích ở
 * đây là đỡ buồn ngủ chứ không phải tua nhanh. Có cả mức chậm cho nội dung cần
 * nghe kỹ.
 */
const SPEEDS = [0.9, 1, 1.1, 1.2, 1.3, 1.5] as const;

/** Thứ tự nhóm hiện trên màn hình - nam trước vì đông nhất, lạ nhất để cuối. */
const GENDERS: TtsGender[] = ["nam", "nu", "trung-tinh"];

const GENDER_LABEL_KEY: Record<TtsGender, string> = {
  nam: "ttv.voice.gender.male",
  nu: "ttv.voice.gender.female",
  "trung-tinh": "ttv.voice.gender.neutral",
};

/** Vùng miền chỉ có ở engine chạy trên máy - Gemini trả region null cho mọi giọng. */
const REGIONS: TtsRegion[] = ["bac", "trung", "nam"];

const REGION_LABEL_KEY: Record<TtsRegion, string> = {
  bac: "ttv.voice.region.bac",
  trung: "ttv.voice.region.trung",
  nam: "ttv.voice.region.nam",
};

/** Giọng tự nhân bản lên trước: đó là thứ người dùng bỏ công tạo ra. */
const KINDS: TtsVoiceKind[] = ["cloned", "preset"];

const KIND_LABEL_KEY: Record<TtsVoiceKind, string> = {
  preset: "ttv.voice.kind.preset",
  cloned: "ttv.voice.kind.cloned",
};

const ENGINE_LABEL_KEY: Record<TtsEngine, string> = {
  gemini: "ttv.voice.engine.gemini",
  vieneu: "ttv.voice.engine.vieneu",
};

const ENGINE_DESC_KEY: Record<TtsEngine, string> = {
  gemini: "ttv.voice.engine.gemini-desc",
  vieneu: "ttv.voice.engine.vieneu-desc",
};

/** Đám mây vs con chip - hai icon nói ngay "chạy ở đâu" trước khi đọc chữ. */
const ENGINE_ICON: Record<TtsEngine, typeof Cloud> = {
  gemini: Cloud,
  vieneu: Cpu,
};

/**
 * Mã lý do server có thể trả về. Chỉ dịch mã nằm trong danh sách này; mã lạ
 * (server mới hơn web) rơi về ".unknown" thay vì in thẳng mã máy ra màn hình.
 */
const ENGINE_REASONS = [
  "NO_GEMINI_KEY",
  "NO_PYTHON",
  "NO_VIENEU",
  "NO_TORCH",
  "LOAD_FAILED",
] as const;

function reasonKey(reason: string): string {
  return (ENGINE_REASONS as readonly string[]).includes(reason)
    ? `ttv.voice.engine.why.${reason}`
    : "ttv.voice.engine.why.unknown";
}

/**
 * Ngưỡng cao độ (median f0 đo được, Hz) để gắn thêm chữ "trầm"/"cao".
 *
 * Không có ngưỡng chung cho cả hai giới: giọng nam nói thường 85-155 Hz, giọng
 * nữ 165-255 Hz - lấy một mốc duy nhất thì mọi giọng nam đều thành "trầm" và
 * mọi giọng nữ đều thành "cao", tức là không nói thêm được gì.
 *
 * Nên mỗi giới có mốc riêng, đặt sao cho chỉ hai đầu mút được gắn nhãn còn khúc
 * giữa để trống - nhãn chỉ có giá trị khi nó hiếm. Với dữ liệu thật hiện tại:
 * - nam: <120 → 4 giọng trầm (Algieba 109 thấp nhất), ≥135 → 5 giọng cao,
 *   7 giọng còn lại nằm giữa (baritone thường) nên không gắn gì.
 * - nữ: <185 → 4 giọng trầm (Gacrux 152 là contralto, thấp hơn giọng nữ kế
 *   tiếp tới 28 Hz), ≥215 → 3 giọng cao, 6 giọng ở giữa.
 *
 * Giọng trung tính KHÔNG gắn cao/thấp: hai mốc trên là mốc trong-nội-bộ-một-giới,
 * mà giọng lưỡng tính thì không có "giới" nào để so - gắn vào là bịa.
 */
const PITCH_BANDS: Record<"nam" | "nu", { low: number; high: number }> = {
  nam: { low: 120, high: 135 },
  nu: { low: 185, high: 215 },
};

/** Key dictionary cho chữ mô tả giọng, vd "nữ trầm". */
function qualifierKey(v: TtsVoice): string {
  if (v.gender === "trung-tinh") return "ttv.voice.q.neutral";
  const band = PITCH_BANDS[v.gender];
  // f0 = 0 nghĩa là CHƯA ĐO (giọng mới nhân bản chẳng hạn), không phải giọng
  // trầm nhất đời - đừng để số 0 biến mọi giọng chưa đo thành "nam trầm".
  const suffix =
    v.f0 <= 0 ? "" : v.f0 < band.low ? "-low" : v.f0 >= band.high ? "-high" : "";
  return v.gender === "nam"
    ? `ttv.voice.q.male${suffix}`
    : `ttv.voice.q.female${suffix}`;
}

/**
 * Lưới an toàn khi giọng không có `timbreKey`: server trả label kèm sẵn tên
 * ("Kore - Chắc chắn") - cắt tên đi để dòng dưới không lặp lại đúng chữ vừa
 * hiện ở dòng trên. Cắt cả theo `name` lẫn `title` vì giọng nhân bản có hai giá
 * trị đó khác nhau (id kebab-case vs tên người dùng đặt).
 */
function timbre(v: TtsVoice): string {
  for (const prefix of [v.title, v.name]) {
    if (!prefix || !v.label.startsWith(prefix)) continue;
    const rest = v.label.slice(prefix.length).replace(/^\s*[-–—:]\s*/, "");
    if (rest) return rest;
  }
  return v.label;
}

/**
 * Mô tả chất giọng để hiện lên màn hình.
 *
 * Ưu tiên bản dịch theo `timbreKey`. t() trả lại CHÍNH CÁI KEY khi thiếu từ
 * điển, nên phải so lại: nếu tra ra đúng key thì coi như không có bản dịch và
 * quay về label của server - thà hiện tiếng Việt còn hơn phun chuỗi
 * "ttv.timbre.foo" ra mặt người dùng.
 */
function describe(v: TtsVoice, t: (key: string) => string): string {
  if (v.timbreKey) {
    const key = `ttv.timbre.${v.timbreKey}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return timbre(v);
}

/** Giọng mặc định khi đổi engine - ưu tiên giọng có sẵn cho ổn định. */
function pickDefaultVoice(list: TtsVoice[]): TtsVoice | null {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));
  return sorted.find((v) => v.kind === "preset") ?? sorted[0];
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function VoicePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: TextToVideoVoice;
  /** Chỉ gửi phần vừa đổi - cha tự merge để không nuốt thay đổi song song. */
  onChange: (patch: Partial<TextToVideoVoice>) => void;
  disabled?: boolean;
}) {
  const { t, tf, lang } = useT();

  // Phiên cũ lưu trước khi có engine thứ hai không có field này - đọc lên thành
  // "gemini" đúng như server làm, đừng để undefined lọt xuống dưới.
  const engine: TtsEngine = value.engine === "vieneu" ? "vieneu" : "gemini";
  const isGemini = engine === "gemini";

  const [engines, setEngines] = useState<TtsEngineStatus[] | null>(null);
  const [models, setModels] = useState<TtsModel[] | null>(null);
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [languages, setLanguages] = useState<TtsLanguage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<TtsEngine | null>(null);

  const [query, setQuery] = useState("");
  /** null = chip "Tất cả". */
  const [genderFilter, setGenderFilter] = useState<TtsGender | null>(null);
  const [regionFilter, setRegionFilter] = useState<TtsRegion | null>(null);

  // Nghe thử: một audio element dùng chung - mỗi lúc chỉ một giọng được phát
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /**
   * Giọng đã tải theo từng engine. Đổi engine qua lại là chuyện thường (nghe
   * thử bên này rồi quay về bên kia) - nhớ lại để khỏi gọi mạng mỗi lần bấm.
   */
  const voiceCache = useRef<Partial<Record<TtsEngine, TtsVoice[]>>>({});

  const loadVoices = useCallback(async (e: TtsEngine): Promise<TtsVoice[]> => {
    const hit = voiceCache.current[e];
    if (hit) return hit;
    const list = await getTtsVoices(e);
    voiceCache.current[e] = list;
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    getTtsEngines()
      .then((list) => {
        if (!alive) return;
        setEngines(list);
      })
      .catch((e) => {
        if (!alive) return;
        // Không hỏi được server thì coi như không engine nào chạy được - khối
        // "chưa có engine nào" phía dưới sẽ nói cách khắc phục.
        setEngines([]);
        setLoadError(errText(e));
      });
    // Model và ngôn ngữ CHỈ dành cho Gemini: lỗi ở đây không được che danh sách
    // giọng của engine chạy trên máy, nên nuốt lỗi riêng thay vì gộp Promise.all.
    getTtsModels()
      .then((m) => alive && setModels(m))
      .catch(() => alive && setModels([]));
    getTtsLanguages()
      .then((l) => alive && setLanguages(l))
      .catch(() => alive && setLanguages([]));
    return () => {
      alive = false;
    };
  }, []);

  const status = engines?.find((s) => s.engine === engine) ?? null;
  const engineReady = status?.available === true;
  const noEngine = engines !== null && !engines.some((s) => s.available);

  // Danh sách giọng đi theo engine đang chọn - hai engine không dùng chung kho
  useEffect(() => {
    if (engines === null) return; // chưa biết engine nào chạy được, đợi đã
    if (!engineReady) {
      // Engine hỏng thì gọi /voices cũng chỉ nhận đúng lỗi vừa hiện ở thẻ engine
      setVoices([]);
      return;
    }
    let alive = true;
    setVoices(null);
    loadVoices(engine)
      .then((list) => {
        if (!alive) return;
        setVoices(list);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setVoices([]);
        setLoadError(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [engine, engines, engineReady, loadVoices]);

  /** Dừng tiếng đang phát và thu hồi blob URL - gọi trước mỗi lần phát mới. */
  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(null);
  }

  // Rời trang giữa lúc đang phát → tắt tiếng, không để audio chạy mồ côi
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  /**
   * Đổi engine. BẮT BUỘC đặt lại `name` trong cùng một patch: tên giọng của
   * engine cũ không tồn tại ở engine mới, để nguyên là phiên mang một cái tên
   * chết và lúc đọc mới báo lỗi.
   */
  async function switchEngine(next: TtsEngine) {
    if (disabled || next === engine || switching !== null) return;
    stop();
    setSwitching(next);
    setPreviewError(null);
    setQuery("");
    setGenderFilter(null);
    setRegionFilter(null);
    try {
      const list = await loadVoices(next);
      onChange({ engine: next, name: pickDefaultVoice(list)?.name ?? "" });
    } catch (e) {
      // Vẫn đổi engine để người dùng thấy tình trạng của nó, nhưng không giữ
      // lại tên giọng cũ - nó chắc chắn sai với engine mới.
      setLoadError(errText(e));
      onChange({ engine: next, name: "" });
    } finally {
      setSwitching(null);
    }
  }

  async function togglePreview(name: string) {
    if (disabled) return;
    if (playing === name) {
      stop();
      return;
    }
    stop();
    if (loadingVoice) return; // đang chờ một bản nghe thử khác - đừng đặt thêm
    setLoadingVoice(name);
    setPreviewError(null);
    try {
      // KHÔNG gửi đoạn kịch bản thật: nghe thử chỉ cần đủ để biết chất giọng.
      // Bỏ trống thì server đọc câu mẫu ngắn cố định (~5s) - nhanh hơn và rẻ
      // hơn nhiều so với tổng hợp cả một đoạn 400-800 ký tự chỉ để nghe vài
      // giây đầu. Câu mẫu do SERVER giữ, web chỉ báo giao diện đang ở ngôn ngữ
      // nào để nghe thử ra đúng thứ tiếng người dùng đang đọc.
      // Model / cách đọc / mã ngôn ngữ là field riêng của Gemini - gửi kèm khi
      // chạy engine trên máy chỉ làm nhiễu.
      const blob = await previewTtsVoice(
        isGemini
          ? {
              voice: name,
              engine,
              model: value.model,
              style: value.style,
              language: value.language,
              uiLang: lang,
            }
          : { voice: name, engine, uiLang: lang }
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => stop();
      audio.onerror = () => {
        stop();
        setPreviewError(tf("ttv.voice.preview-error", { name }));
      };
      audioRef.current = audio;
      urlRef.current = url;
      setPlaying(name);
      await audio.play().catch(() => stop());
    } catch (e) {
      setPreviewError(errText(e));
    } finally {
      setLoadingVoice(null);
    }
  }

  const list = voices ?? [];
  const q = query.trim().toLowerCase();
  // Lọc chữ TRƯỚC, đếm chip sau: con số trên chip phải nói về đúng cái danh
  // sách đang thấy, không thì bấm "Nam (16)" mà ra 2 giọng là chip nói dối.
  // Tìm cả theo mô tả ĐÃ DỊCH: gõ "warm" ở bản tiếng Anh phải ra giọng ấm.
  const searched = q
    ? list.filter((v) =>
        [v.title, v.name, describe(v, t), v.note]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : list;

  const showRegion = engine === "vieneu";
  const matchRegion = (v: TtsVoice) =>
    !showRegion || !regionFilter || v.region === regionFilter;
  const matchGender = (v: TtsVoice) => !genderFilter || v.gender === genderFilter;

  // Số trên mỗi chip đếm theo danh sách đã áp bộ lọc CÒN LẠI (không tự đếm
  // chính mình) - có vậy bấm vào chip nào cũng ra đúng chừng ấy giọng.
  const counts: Record<TtsGender, number> = { nam: 0, nu: 0, "trung-tinh": 0 };
  let genderTotal = 0;
  for (const v of searched) {
    if (!matchRegion(v)) continue;
    counts[v.gender] += 1;
    genderTotal += 1;
  }

  const regionCounts: Record<TtsRegion, number> = { bac: 0, trung: 0, nam: 0 };
  let regionTotal = 0;
  for (const v of searched) {
    if (!matchGender(v)) continue;
    if (v.region) regionCounts[v.region] += 1;
    regionTotal += 1;
  }

  const filtered = searched.filter((v) => matchGender(v) && matchRegion(v));

  /**
   * Nhóm hiện trên màn hình. Gemini nhóm theo giới tính (30 giọng, đó là cách
   * người ta tìm); VieNeu nhóm theo loại vì ranh giới đáng kể ở đó là "giọng
   * mình tự nhân bản" - trong mỗi nhóm xếp theo tên hiển thị cho dễ quét.
   */
  const byTitle = (a: TtsVoice, b: TtsVoice) => a.title.localeCompare(b.title);
  const groupList: {
    key: string;
    label: string;
    neutralNote: boolean;
    items: TtsVoice[];
  }[] = (
    isGemini
      ? GENDERS.map((g) => ({
          key: g,
          label: t(GENDER_LABEL_KEY[g]),
          // Cảnh báo lưỡng tính là chuyện của giọng Gemini, không dán bừa sang
          // engine khác
          neutralNote: g === "trung-tinh",
          items: filtered.filter((v) => v.gender === g).sort(byTitle),
        }))
      : KINDS.map((k) => ({
          key: k,
          label: t(KIND_LABEL_KEY[k]),
          neutralNote: false,
          items: filtered.filter((v) => v.kind === k).sort(byTitle),
        }))
  ).filter((g) => g.items.length > 0);

  // Bản ghi của giọng đang chọn - để lấy tên hiển thị + mô tả cho dòng tóm tắt
  const selected = list.find((v) => v.name === value.name) ?? null;

  // Giọng đã lưu không (chưa) có trong danh sách → vẫn cho hiện, không âm thầm mất
  const selectedMissing =
    value.name !== "" && list.length > 0 && !list.some((v) => v.name === value.name);
  const modelMissing =
    value.model !== null &&
    models !== null &&
    !models.some((m) => m.id === value.model);
  const languageMissing =
    value.language !== "" &&
    languages !== null &&
    languages.length > 0 &&
    !languages.some((l) => l.code === value.language);

  // Engine trên máy chạy được nhưng chưa nhân bản giọng nào → chỉ đường sang
  // trang Giọng đọc, đừng để người dùng tự mò xem tạo giọng riêng ở đâu
  const clonedEmpty =
    showRegion &&
    engineReady &&
    voices !== null &&
    !list.some((v) => v.kind === "cloned");

  return (
    <div className="flex flex-col gap-4">
      {/* Không lấy được danh sách = gần như luôn do thiếu khóa Gemini - nói thẳng
          cách sửa thay vì để người dùng nhìn một khung trống */}
      {loadError && (
        <div className="flex flex-col gap-1.5">
          <ErrorBanner message={t("ttv.voice.load-error")} detail={loadError} />
          {isGemini && (
            <p className="text-xs text-[var(--text-muted)]">
              {t("ttv.voice.gemini-hint")}
            </p>
          )}
        </div>
      )}

      {/* 0. Engine đọc - quyết định mọi thứ phía dưới nên đứng trên cùng */}
      <div>
        <span className="label">{t("ttv.voice.engine")}</span>
        {engines === null ? (
          <p className="flex items-center gap-1.5 py-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            {t("ttv.voice.engine.checking")}
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label={t("ttv.voice.engine")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {TTS_ENGINES.map((e) => {
                const st = engines.find((s) => s.engine === e) ?? null;
                const ok = st?.available === true;
                const active = engine === e;
                const busy = switching === e;
                const Icon = ENGINE_ICON[e];
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    // Engine máy chưa chạy được thì KHÓA - hiện ra để giải thích
                    // vì sao, chứ không cho chọn một thứ chắc chắn lỗi
                    disabled={disabled || !ok || switching !== null}
                    onClick={() => switchEngine(e)}
                    className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius)] border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)]"
                    } ${ok ? "" : "opacity-70"}`}
                  >
                    {/* Cho XUỐNG DÒNG chứ không cắt bằng "…": cột này hẹp, mà
                        cắt đi thì "Gemini (đám mây)" chỉ còn "Gemi…" - mất đúng
                        phần nói cho người dùng biết engine chạy ở đâu. */}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                      {busy ? (
                        <Loader2
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="shrink-0 animate-spin text-[var(--text-muted)]"
                        />
                      ) : (
                        <Icon
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                          className={`shrink-0 ${
                            active
                              ? "text-[var(--primary)]"
                              : "text-[var(--text-muted)]"
                          }`}
                        />
                      )}
                      <span
                        className={`min-w-0 text-[13px] leading-snug font-semibold ${
                          active ? "text-[var(--primary)]" : "text-[var(--text)]"
                        }`}
                      >
                        {t(ENGINE_LABEL_KEY[e])}
                      </span>
                      <span
                        className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          ok
                            ? "bg-[var(--success-bg)] text-[var(--success)]"
                            : "bg-[var(--danger-bg)] text-[var(--danger)]"
                        }`}
                      >
                        {ok
                          ? t("ttv.voice.engine.ready")
                          : t("ttv.voice.engine.unavailable")}
                      </span>
                    </span>
                    <span className="text-[11px] leading-snug text-[var(--text-muted)]">
                      {t(ENGINE_DESC_KEY[e])}
                    </span>
                    {ok && st?.canClone && (
                      <span className="text-[11px] leading-snug font-medium text-[var(--success)]">
                        {t("ttv.voice.engine.clone-ready")}
                      </span>
                    )}
                    {/* Có mã lý do là có chuyện chưa ổn - kể cả khi vẫn đọc được
                        (vd đọc được nhưng thiếu torch nên chưa nhân bản được) */}
                    {st?.reason && (
                      <span className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--danger)]">
                        <AlertTriangle
                          size={12}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">{t(reasonKey(st.reason))}</span>
                      </span>
                    )}
                    {st?.reason && st.detail && (
                      <span className="min-w-0 text-[10px] leading-snug text-[var(--text-muted)]">
                        <span className="block">{t("voices.detail")}</span>
                        {/* Đường dẫn Python dài - cho ngắt giữa chữ, tuyệt đối
                            không để nó đẩy ngang cả cột */}
                        <span className="block break-all font-mono">
                          {st.detail}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {noEngine && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--danger)]">
                <AlertTriangle
                  size={13}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                {t("ttv.voice.engine.none")}
              </p>
            )}
          </>
        )}
      </div>

      {/* 1. Giọng đang chọn - danh sách giọng cuộn trong khung riêng, không có
          dòng này thì chọn xong kéo đi chỗ khác là quên mất mình đã chọn ai */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
        <span className="shrink-0 text-xs text-[var(--text-muted)]">
          {t("ttv.voice.selected")}
        </span>
        {value.name ? (
          <>
            {/* Hiện TÊN HIỂN THỊ, không hiện `name`: với giọng nhân bản thì
                `name` là id kebab-case, phun ra đây chỉ tổ xấu và khó nhận ra */}
            <span className="min-w-0 truncate text-sm font-semibold text-[var(--primary)]">
              {selected?.title || value.name}
            </span>
            {selected && (
              <span
                className="min-w-0 truncate text-xs text-[var(--text-muted)]"
                title={
                  selected.f0 > 0
                    ? tf("ttv.voice.f0-title", { f0: selected.f0 })
                    : undefined
                }
              >
                · {t(qualifierKey(selected))} · {describe(selected, t)}
              </span>
            )}
            {isGemini && (
              <span className="ml-auto min-w-0 max-w-full truncate text-xs text-[var(--text-muted)]">
                {value.style.trim() || t("ttv.voice.style-default")}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 text-sm text-[var(--text-muted)]">
            {t("ttv.voice.none-selected")}
          </span>
        )}
      </div>

      {/* 2. Model TTS - CHỈ Gemini. Engine trên máy chỉ có một model nên hiện ô
          này ở đó là bày ra một cái nút không làm gì */}
      {isGemini && (
        <div>
          <label className="label" htmlFor="ttv-tts-model">
            {t("ttv.voice.model")}
            <InfoHint
              className="ml-1.5 align-middle"
              titleKey="help.ttv-voice-model.title"
              bodyKey="help.ttv-voice-model.body"
            />
          </label>
          <select
            id="ttv-tts-model"
            className="input"
            value={value.model ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ model: e.target.value || null })}
          >
            <option value="">{t("ttv.voice.model-default")}</option>
            {modelMissing && <option value={value.model!}>{value.model}</option>}
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 3. Ngôn ngữ - ĐỘC LẬP với giọng, cố ý không dùng để lọc danh sách
          giọng. Cũng chỉ Gemini: engine trên máy đọc tiếng Việt, không nhận mã
          ngôn ngữ */}
      {isGemini && (
        <div>
          <label className="label" htmlFor="ttv-tts-language">
            {t("ttv.voice.language")}
            <InfoHint
              className="ml-1.5 align-middle"
              titleKey="help.ttv-voice-language.title"
              bodyKey="help.ttv-voice-language.body"
            />
          </label>
          <select
            id="ttv-tts-language"
            className="input"
            value={value.language}
            disabled={disabled}
            onChange={(e) => onChange({ language: e.target.value })}
          >
            {languageMissing && (
              <option value={value.language}>{value.language}</option>
            )}
            {(languages ?? []).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
            <Globe size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t("ttv.voice.language-hint")}
          </p>
        </div>
      )}

      {/* 4. Danh sách giọng - lọc theo giới tính (+ vùng miền với engine trên
          máy) + ô tìm, nghe thử từng giọng */}
      <div>
        <span className="label">
          {t("ttv.voice.voice")}
          <InfoHint
            className="ml-1.5 align-middle"
            titleKey="help.ttv-voice.title"
            bodyKey="help.ttv-voice.body"
          />
        </span>

        <div
          role="group"
          aria-label={t("ttv.voice.filter-aria")}
          className="mb-2 flex flex-wrap gap-1.5"
        >
          {([null, ...GENDERS] as (TtsGender | null)[]).map((g) => {
            const active = genderFilter === g;
            const label = g ? t(GENDER_LABEL_KEY[g]) : t("ttv.voice.filter.all");
            const n = g ? counts[g] : genderTotal;
            // Chip 0 giọng là ngõ cụt: bấm vào chỉ ra danh sách rỗng. Ẩn đi,
            // trừ chip "Tất cả" (luôn phải có đường quay lại).
            if (g && n === 0 && genderFilter !== g) return null;
            return (
              <button
                key={g ?? "all"}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => setGenderFilter(g)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {label}
                <span className="ml-1 tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Vùng miền chỉ có nghĩa với giọng chạy trên máy - giọng Gemini trả
            region null nên hiện bộ lọc này ở đó là bày ra một hàng nút chết */}
        {showRegion && (
          <div
            role="group"
            aria-label={t("ttv.voice.region")}
            className="mb-2 flex flex-wrap gap-1.5"
          >
            {([null, ...REGIONS] as (TtsRegion | null)[]).map((r) => {
              const active = regionFilter === r;
              const label = r
                ? t(REGION_LABEL_KEY[r])
                : t("ttv.voice.region.all");
              const n = r ? regionCounts[r] : regionTotal;
              // Cùng lý do như chip giới tính: không bày ngõ cụt
              if (r && n === 0 && regionFilter !== r) return null;
              return (
                <button
                  key={r ?? "all"}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => setRegionFilter(r)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {label}
                  <span className="ml-1 tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="relative mb-2">
          <Search
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            className="input pl-8"
            value={query}
            disabled={disabled}
            aria-label={t("ttv.voice.search")}
            placeholder={t("ttv.voice.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {clonedEmpty && (
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-dashed border-[var(--border)] px-2.5 py-2">
            <span className="min-w-0 text-[11px] leading-snug text-[var(--text-muted)]">
              {t("ttv.voice.cloned-empty")}
            </span>
            <Link
              href="/voices"
              className="shrink-0 text-[11px] font-medium text-[var(--primary)] hover:underline"
            >
              {t("ttv.voice.manage")}
            </Link>
          </div>
        )}

        {previewError && (
          <div className="mb-2">
            <ErrorBanner message={t("ttv.voice.preview-failed")} detail={previewError} />
          </div>
        )}

        {voices === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </p>
        ) : groupList.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            {list.length === 0 ? t("ttv.voice.none") : t("ttv.voice.no-match")}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t("ttv.voice.voice")}
            className="max-h-[320px] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)] p-2"
          >
            {selectedMissing && (
              <p className="mb-2 flex items-start gap-1.5 px-1 text-xs text-[var(--text-muted)]">
                <AlertTriangle
                  size={13}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-[var(--danger)]"
                />
                {tf("ttv.voice.missing", { name: value.name })}
              </p>
            )}
            {groupList.map((group) => (
              <div key={group.key} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                  {group.label}
                  <span className="ml-1 tabular-nums opacity-70">
                    {group.items.length}
                  </span>
                </p>
                {/* Giọng lưỡng tính đảo giới giữa các lần tổng hợp - báo trước ở
                    ngay đầu nhóm, đừng để người dùng phát hiện lúc render xong */}
                {group.neutralNote && (
                  <p className="mb-1 flex items-start gap-1.5 px-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    <AlertTriangle
                      size={12}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-[var(--danger)]"
                    />
                    {t("ttv.voice.neutral-note")}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
                  {group.items.map((v) => {
                    const active = value.name === v.name;
                    const isLoading = loadingVoice === v.name;
                    const isPlaying = playing === v.name;
                    return (
                      <div
                        key={`${v.engine}:${v.name}`}
                        className={`flex min-w-0 items-center gap-2 rounded-[var(--radius)] border p-2 transition-colors duration-150 ${
                          active
                            ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                            : "border-[var(--border)] bg-[var(--surface)]"
                        }`}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={disabled}
                          onClick={() => onChange({ name: v.name })}
                          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={`min-w-0 truncate text-[13px] font-semibold ${
                                active
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--text)]"
                              }`}
                            >
                              {v.title}
                            </span>
                            {/* Giọng nhân bản nằm lẫn trong nhóm khác (khi đang
                                lọc/tìm) vẫn phải nhận ra ngay là của mình */}
                            {v.kind === "cloned" && (
                              <span className="shrink-0 rounded-full bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                                {t("ttv.voice.kind.cloned")}
                              </span>
                            )}
                          </span>
                          {/* Số Hz để trong title chứ không hiện ra: người chọn
                              giọng cần biết "nữ trầm", không cần biết 152.
                              Cho xuống dòng chứ KHÔNG cắt bằng "…": cột này hẹp,
                              cắt đi thì "nam trầm · mượt mà" chỉ còn "nam trầm ·
                              mu…" - mất đúng phần mô tả chất giọng cần đọc. */}
                          <span
                            className="block text-[11px] leading-snug text-[var(--text-muted)]"
                            title={
                              v.f0 > 0
                                ? tf("ttv.voice.f0-title", { f0: v.f0 })
                                : undefined
                            }
                          >
                            {t(qualifierKey(v))} · {describe(v, t)}
                          </span>
                          {/* Ghi chú người dùng tự nhập lúc nhân bản - cắt một
                              dòng, không để ghi chú dài xé toang cái thẻ */}
                          {v.note && (
                            <span className="block truncate text-[11px] leading-snug text-[var(--text-muted)] opacity-80">
                              {v.note}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={disabled || (loadingVoice !== null && !isLoading)}
                          title={
                            isPlaying ? t("ttv.voice.stop") : t("ttv.voice.preview")
                          }
                          aria-label={
                            isPlaying
                              ? tf("ttv.voice.stop-aria", { name: v.title })
                              : tf("ttv.voice.preview-aria", { name: v.title })
                          }
                          onClick={() => togglePreview(v.name)}
                          className={`shrink-0 rounded-[var(--radius)] p-1.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                            isPlaying
                              ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                              : "text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text)]"
                          }`}
                        >
                          {isLoading ? (
                            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                          ) : isPlaying ? (
                            <Square size={14} strokeWidth={2} />
                          ) : (
                            <Play size={14} strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* "Nghe thử tốn tiền" chỉ đúng với Gemini. Engine chạy trên máy không
            mất đồng nào, cái người dùng cần biết ở đó là lần đọc đầu chậm vì
            phải nạp model - nói nhầm câu là mất lòng tin vào cả hai câu */}
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          {isGemini ? (
            <Volume2 size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <Timer size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          {isGemini ? t("ttv.voice.preview-cost") : t("voices.first-run-slow")}
        </p>
      </div>

      {/* 5. Tốc độ đọc - áp cho MỌI engine (làm bằng ffmpeg sau khi tổng hợp,
          không phụ thuộc engine nào đọc) */}
      <div>
        <span className="label">{t("ttv.voice.speed")}</span>
        <div role="group" aria-label={t("ttv.voice.speed")} className="flex flex-wrap gap-1.5">
          {SPEEDS.map((s) => {
            const active = Math.abs(value.speed - s) < 0.001;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onChange({ speed: s })}
                className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {s === 1 ? t("ttv.voice.speed-normal") : `x${s}`}
              </button>
            );
          })}
        </div>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <Gauge size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          {t("ttv.voice.speed-hint")}
        </p>
        {Math.abs(value.speed - 1) > 0.001 && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("ttv.voice.speed-preview-note")}
          </p>
        )}
      </div>

      {/* 6. Cách đọc - prompt tự do, đổi là thời lượng đổi theo. Chỉ Gemini:
          engine trên máy không nhận lời chỉ dẫn cách đọc */}
      {isGemini && (
        <div>
          <label className="label" htmlFor="ttv-voice-style">
            {t("ttv.voice.style")}
            <InfoHint
              className="ml-1.5 align-middle"
              titleKey="help.ttv-voice-style.title"
              bodyKey="help.ttv-voice-style.body"
            />
          </label>
          <input
            id="ttv-voice-style"
            className="input"
            value={value.style}
            disabled={disabled}
            placeholder={t("ttv.voice.style-placeholder")}
            onChange={(e) => onChange({ style: e.target.value })}
          />
          <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--danger)]">
            <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t("ttv.voice.style-warning")}
          </p>
        </div>
      )}
    </div>
  );
}
