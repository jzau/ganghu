import type { ConversationDto, ConversationSearchResultDto } from "@ai-chat/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { endpoints } from "../lib/api";
import type { Language } from "../lib/i18n";

type SearchItem = ConversationSearchResultDto;

export function SearchDialog({ language, recent, onClose, onSelect }: {
  language: Language;
  recent: ConversationDto[];
  onClose: () => void;
  onSelect: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useQuery({
    queryKey: ["conversation-search", debouncedQuery],
    queryFn: () => endpoints.searchConversations(debouncedQuery),
    enabled: debouncedQuery.length > 0
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const items: SearchItem[] = debouncedQuery
    ? search.data?.results ?? []
    : recent.slice(0, 5).map((conversation) => ({ ...conversation, snippet: null }));
  useEffect(() => { setSelectedIndex(-1); }, [debouncedQuery]);

  return createPortal(
    <div className="gg-search-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="gg-search-dialog" role="dialog" aria-modal="true" aria-label={language === "en" ? "Search conversations" : "搜索对话"}>
        <div className="gg-search-input-wrap">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={language === "en" ? "Search conversations…" : "搜索对话…"}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, items.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((index) => index <= 0 ? -1 : index - 1); }
              if (event.key === "Enter" && items[selectedIndex]) onSelect(items[selectedIndex].id);
            }}
          />
        </div>
        <p className="gg-search-label">{debouncedQuery ? (language === "en" ? "Results" : "搜索结果") : (language === "en" ? "Recent" : "最近对话")}</p>
        <div className="gg-search-results">
          {search.isFetching && debouncedQuery && <p className="gg-search-empty">{language === "en" ? "Searching…" : "搜索中…"}</p>}
          {!search.isFetching && items.length === 0 && <p className="gg-search-empty">{language === "en" ? "No conversations found" : "未找到对话"}</p>}
          {items.map((item, index) => (
            <button key={item.id} className={`gg-search-result ${index === selectedIndex ? "is-selected" : ""}`} onMouseEnter={() => setSelectedIndex(index)} onClick={() => onSelect(item.id)}>
              <span><strong>{item.title}</strong>{item.snippet && <small>{item.snippet}</small>}</span>
            </button>
          ))}
        </div>
      </section>
    </div>, document.body
  );
}
