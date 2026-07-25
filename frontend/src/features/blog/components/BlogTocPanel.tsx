import { useEffect, useMemo, useState, useCallback } from "react";
import { useChat } from "../../../stores/chatStore";
import { ChevronRight } from "lucide-react";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import { extractHeadings, type TocItem } from "../utils/blogToc";

function getParentSlug(headings: TocItem[], slug: string): string {
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].slug === slug) {
      for (let j = i - 1; j >= 0; j--) {
        if (headings[j].level === 2) return headings[j].slug;
      }
      break;
    }
  }
  return "";
}

export function BlogTocPanel({ mode }: { mode: "view" | "edit" }) {
  const { state } = useChat();
  const currentBlogPost = state.blogPosts.find((p) => p.id === state.blogCurrentPostId);

  if (mode === "view") {
    return <BlogTocView content={currentBlogPost?.content || ""} title={currentBlogPost?.title} />;
  }
  return <BlogTocEdit title={currentBlogPost?.title} />;
}

function BlogTocView({ content, title }: { content: string; title?: string }) {
  const headings = useMemo(() => extractHeadings(content), [content]);
  const initialExpandedSlugs = useMemo(
    () => new Set(headings.filter((h) => h.level === 2).map((h) => h.slug)),
    [headings],
  );
  const [userToggledSlugs, setUserToggledSlugs] = useState<Set<string>>(new Set());
  const expandedHeadingSlugs = useMemo(() => {
    const next = new Set(initialExpandedSlugs);
    userToggledSlugs.forEach((slug) => {
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
    });
    return next;
  }, [initialExpandedSlugs, userToggledSlugs]);

  const toggleHeading = useCallback((slug: string) => {
    setUserToggledSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const scrollToHeading = useCallback((slug: string) => {
    const el = document.getElementById(slug);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="p-4 flex flex-col gap-3">
        <div className="text-[13px] text-muted-foreground leading-relaxed pb-2">
          当前文章
          <strong className="block text-[15px] text-foreground mt-1 truncate">
            {title || "加载中..."}
          </strong>
        </div>
        {headings.length > 0 && (
          <nav className="flex flex-col gap-0 mt-1">
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground/70 font-semibold px-1">目录</span>
            {headings.map((h) => {
              const isH2 = h.level === 2;
              return (
                <div key={h.slug} className={`flex items-center gap-0 px-1.5 py-1 rounded-lg ${isH2 ? "text-foreground font-medium" : h.level === 3 ? "text-muted-foreground" : "text-muted-foreground/70"} ${!isH2 && !expandedHeadingSlugs.has(getParentSlug(headings, h.slug)) ? "hidden" : ""}`}>
                  {isH2 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleHeading(h.slug); }}
                      className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                      title={expandedHeadingSlugs.has(h.slug) ? "收起" : "展开"}
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${expandedHeadingSlugs.has(h.slug) ? "rotate-90" : ""}`} />
                    </button>
                  )}
                  <button
                    onClick={() => scrollToHeading(h.slug)}
                    className={`flex-1 text-left text-sm leading-snug truncate transition-colors hover:text-primary hover:bg-primary/8 rounded-md ${isH2 ? "" : h.level === 3 ? "pl-3" : "pl-5"}`}
                  >
                    {h.text}
                  </button>
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </WorkspacePanel>
  );
}

function BlogTocEdit({ title }: { title?: string }) {
  const { state } = useChat();
  const [liveHeadings, setLiveHeadings] = useState<TocItem[]>([]);
  const [editExpandedSlugs, setEditExpandedSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (state.currentPage !== "blog" || state.blogCurrentView !== "edit") return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;

    const extract = () => {
      if (cancelled) return;
      const el = document.querySelector(".blog-editor-body .vditor-wysiwyg") as Element | null;
      if (!el || el.querySelectorAll("h2, h3, h4").length === 0) return false;

      const hs: TocItem[] = [];
      el.querySelectorAll("h2, h3, h4").forEach((node) => {
        const level = parseInt(node.tagName[1]);
        const text = node.textContent || "";
        const slug = text.toLowerCase().replace(/[^\w一-鿿]+/g, "-").replace(/^-|-$/g, "");
        hs.push({ level, text, slug });
      });
      if (!cancelled) {
        setLiveHeadings(hs);
        setEditExpandedSlugs(new Set(hs.filter((h) => h.level === 2).map((h) => h.slug)));
      }
      return true;
    };

    const tryExtract = () => {
      if (extract()) {
        const el = document.querySelector(".blog-editor-body .vditor-wysiwyg") as Element | null;
        if (el && !cancelled) {
          observer = new MutationObserver(() => extract());
          observer.observe(el, { childList: true, subtree: true, characterData: true });
        }
      } else {
        retryTimer = setTimeout(tryExtract, 200);
      }
    };

    tryExtract();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      observer?.disconnect();
      setLiveHeadings([]);
    };
  }, [state.currentPage, state.blogCurrentView]);

  const scrollToEl = (el: Element) => {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <WorkspacePanel className="overflow-y-auto select-none">
      <div className="p-4 flex flex-col gap-3">
        <div className="text-[13px] text-muted-foreground leading-relaxed pb-2">
          编辑中
          <strong className="block text-[15px] text-foreground mt-1 truncate">
            {title || "新文章"}
          </strong>
        </div>
        {liveHeadings.length > 0 && (
          <nav className="flex flex-col gap-0 mt-1">
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground/70 font-semibold px-1">目录</span>
            {liveHeadings.map((h) => {
              const isH2 = h.level === 2;
              return (
                <div key={`${h.slug}-${h.text}`} className={`flex items-center gap-0 px-1.5 py-1 rounded-lg ${isH2 ? "text-foreground font-medium" : h.level === 3 ? "text-muted-foreground" : "text-muted-foreground/70"} ${!isH2 && !editExpandedSlugs.has(getParentSlug(liveHeadings, h.slug)) ? "hidden" : ""}`}>
                  {isH2 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditExpandedSlugs((prev) => { const n = new Set(prev); if (n.has(h.slug)) { n.delete(h.slug); } else { n.add(h.slug); } return n; }); }}
                      className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                      title={editExpandedSlugs.has(h.slug) ? "收起" : "展开"}
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${editExpandedSlugs.has(h.slug) ? "rotate-90" : ""}`} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const editor = document.querySelector(".blog-editor-body .vditor-wysiwyg");
                      if (!editor) return;
                      const tag = `h${h.level}`;
                      const target = Array.from(editor.querySelectorAll(tag)).find(
                        (el) => el.textContent?.trim() === h.text
                      );
                      if (target) scrollToEl(target);
                    }}
                    className={`flex-1 text-left text-sm leading-snug truncate transition-colors hover:text-primary hover:bg-primary/8 rounded-md ${isH2 ? "" : h.level === 3 ? "pl-3" : "pl-5"}`}
                  >
                    {h.text}
                  </button>
                </div>
              );
            })}
          </nav>
        )}
        {liveHeadings.length === 0 && (
          <span className="text-[13px] text-muted-foreground/50 px-1 pt-2">输入标题后显示目录</span>
        )}
      </div>
    </WorkspacePanel>
  );
}
