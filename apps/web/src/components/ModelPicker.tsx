import type { LlmModelDto } from "@ai-chat/shared";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Language } from "../lib/i18n";

type Props = {
  anchorRef: RefObject<HTMLDivElement>;
  models: LlmModelDto[];
  selectedId: string;
  language: Language;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
};

// A body portal keeps the sheet outside the composer's backdrop-filter,
// which otherwise becomes the containing block for fixed positioning in Safari.
export function ModelPicker({ anchorRef, models, selectedId, language, loading, failed, onRetry, onSelect, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose });
  callbacks.current = { onClose };
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [position, setPosition] = useState({ left: 12, bottom: 12 });
  const title = language === "en" ? "Choose a model" : "选择模型";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setMobile(media.matches);
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 244)),
        bottom: Math.max(12, Math.min(window.innerHeight - rect.top + 8, window.innerHeight - 80))
      });
    };
    update();
    window.addEventListener("resize", update);
    media.addEventListener("change", update);
    return () => { window.removeEventListener("resize", update); media.removeEventListener("change", update); };
  }, [anchorRef]);

  useEffect(() => {
    const trigger = anchorRef.current?.querySelector("button");
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panel.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) callbacks.current.onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); callbacks.current.onClose(); }
      const options = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) {
        event.preventDefault();
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : event.key === "ArrowDown" ? (index + 1) % options.length : index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length;
        options[next].focus();
      }
      if (event.key === "Tab" && mobile) {
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        const first = buttons[0]; const last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      trigger?.focus({ preventScroll: true });
    };
  }, [anchorRef, mobile]);

  return createPortal(<>
    {mobile && <div className="gg-model-backdrop" aria-hidden="true" />}
    <div className={`gg-model-picker ${mobile ? "is-mobile" : ""}`} ref={panel} role="dialog" aria-modal={mobile || undefined} aria-label={title} tabIndex={-1}
      style={mobile ? undefined : position}>
      {mobile && <header className="gg-model-heading"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={language === "en" ? "Close model selector" : "关闭模型选择"}><X size={20} /></button></header>}
      <div className="gg-model-options" role="listbox" aria-label={language === "en" ? "Models" : "模型"}>
        {models.map((model) => <button type="button" key={model.id} className={`gg-model-option ${model.id === selectedId ? "is-active" : ""}`} role="option" aria-selected={model.id === selectedId}
          onClick={() => { onSelect(model.id); onClose(); }}>
          <span><strong>{language === "zh" ? model.displayNameZh?.trim() || model.displayName : model.displayName}</strong>
            <small>{language === "zh" ? model.modelSeriesNameZh?.trim() || model.modelSeriesName?.trim() || model.providerModelId : model.modelSeriesName?.trim() || model.providerModelId}</small></span>
          {model.id === selectedId && <Check size={16} aria-hidden="true" />}
        </button>)}
      </div>
      {!models.length && <div className="gg-model-status" role="status">{loading ? (language === "en" ? "Loading models…" : "正在加载模型…")
        : failed ? (language === "en" ? "Could not load models." : "模型加载失败。") : (language === "en" ? "No models available yet." : "暂无可用模型。")}
        {failed && <button type="button" onClick={onRetry}>{language === "en" ? "Try again" : "重试"}</button>}</div>}
    </div>
  </>, document.body);
}
