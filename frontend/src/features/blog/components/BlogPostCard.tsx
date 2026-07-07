import type { BlogPost } from "../../../stores/chatStore";
import { useChat } from "../../../stores/chatStore";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { User, Eye, Calendar, Tags, FileText } from "lucide-react";
import { getBlogTagStyle, splitBlogTags } from "../utils/blogTags";

interface Props {
  post: BlogPost;
  variant: "feature-bg" | "feature-side" | "compact";
  onClick: (id: number) => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function getExcerpt(post: BlogPost) {
  const text = post.excerpt || post.content || "";
  const cleaned = text.replace(/[#*`>[\]!|~\\]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= 128) return cleaned;
  return cleaned.substring(0, 128) + "…";
}

function MetaInfo({ post, className }: { post: BlogPost; className?: string }) {
  const dateStr = post.published_at || post.created_at;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className || "text-muted-foreground"}`}>
      {post.author && (
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          {post.author}
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        {formatDate(dateStr)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Eye className="w-3 h-3" />
        {post.view_count}
      </span>
    </div>
  );
}

function TagList({ tags, onDarkImage = false }: { tags: string[]; onDarkImage?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${onDarkImage ? "border-white/22 bg-white/14 text-white/82 backdrop-blur-md" : ""}`}
          style={onDarkImage ? undefined : getBlogTagStyle(tag)}
        >
          <Tags className="w-3 h-3" />
          {tag}
        </span>
      ))}
    </div>
  );
}

function EmptyCover({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center border border-dashed border-border/80 bg-secondary/55 text-muted-foreground ${className}`}>
      <FileText className="h-7 w-7" />
    </div>
  );
}

export function BlogPostCard({ post, variant, onClick }: Props) {
  const { state } = useChat();
  const isDark = state.theme === "dark";
  const excerpt = getExcerpt(post);
  const tags = splitBlogTags(post.tags, 3);
  const hasCover = Boolean(post.cover_image);

  if (variant === "feature-bg") {
    const coverDark = hasCover && isDark;
    return (
      <motion.article
        whileHover={{ y: -6, scale: 1.005 }}
        transition={{ duration: 0.22 }}
        className={`group relative h-[16rem] w-full cursor-pointer overflow-hidden rounded-[2rem] border border-border/70 shadow-xl shadow-foreground/5 bg-card/94`}
        onClick={() => onClick(post.id)}
      >
        {hasCover && (
          <>
            <img src={post.cover_image} alt={post.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            <div className={`absolute inset-0 ${isDark ? "bg-slate-950/75" : "bg-card/25 backdrop-blur-[1px]"}`} />
          </>
        )}

        <div className={`absolute inset-x-0 bottom-0 p-6 sm:p-8 ${coverDark ? "text-white" : "text-foreground"}`}>
          {(post.status === "draft" || tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {post.status === "draft" && (
                <Badge variant="outline" className={coverDark ? "rounded-full border-amber-300/35 bg-amber-400/16 text-amber-100 backdrop-blur-md" : "rounded-full border-amber-400/30 bg-amber-500/10 text-amber-600"}>
                  草稿
                </Badge>
              )}
              {tags.length > 0 && <TagList tags={tags} onDarkImage={coverDark} />}
            </div>
          )}
          <h2 className="mt-4 text-2xl font-black leading-tight tracking-[-0.045em] truncate sm:text-4xl">
            {post.title}
          </h2>
          {excerpt && (
            <p className={`mt-3 text-[15px] leading-relaxed line-clamp-2 ${coverDark ? "text-white/72" : "text-muted-foreground"}`}>
              {excerpt}{excerpt.length >= 128 ? "..." : ""}
            </p>
          )}
          <MetaInfo post={post} className={`mt-5 ${coverDark ? "text-white/60" : "text-muted-foreground"}`} />
        </div>
      </motion.article>
    );
  }

  if (variant === "feature-side") {
    return (
      <motion.article
        whileHover={{ y: -5 }}
        transition={{ duration: 0.2 }}
        className="group flex min-h-[13rem] w-full cursor-pointer flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/94 shadow-xl shadow-foreground/5 transition-all duration-200 hover:border-primary/25 lg:h-[13rem] lg:flex-row"
        onClick={() => onClick(post.id)}
      >
        {hasCover ? (
          <div className="relative h-64 flex-shrink-0 overflow-hidden border-b border-border/70 lg:h-full lg:w-[42%] lg:border-b-0 lg:border-r">
            <img src={post.cover_image} alt={post.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            {isDark && <div className="absolute inset-0 bg-slate-950/75" />}
          </div>
        ) : (
          <EmptyCover className="h-52 flex-shrink-0 border-x-0 border-t-0 lg:h-full lg:w-[34%] lg:border-b-0 lg:border-l-0 lg:border-r" />
        )}
        <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {post.status === "draft" && (
              <Badge variant="outline" className="rounded-full border-amber-400/30 bg-amber-500/10 text-amber-600">
                草稿
              </Badge>
            )}
            {tags.length > 0 && <TagList tags={tags} />}
          </div>
          <h2 className="text-xl font-black leading-tight tracking-[-0.04em] text-foreground truncate">
            {post.title}
          </h2>
          {excerpt && (
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground line-clamp-2">
              {excerpt}
            </p>
          )}
          <div className="mt-auto pt-3">
            <MetaInfo post={post} />
          </div>
        </div>
      </motion.article>
    );
  }

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ duration: 0.18 }}
      className="group flex h-auto min-h-[7rem] w-full cursor-pointer overflow-hidden rounded-[1.55rem] border border-border/70 bg-card/92 shadow-sm transition-all duration-200 hover:border-primary/25 hover:shadow-xl hover:shadow-foreground/5"
      onClick={() => onClick(post.id)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-1 overflow-hidden">
          {post.status === "draft" && (
            <Badge variant="outline" className="rounded-full border-amber-400/30 bg-amber-500/10 text-amber-600 text-[11px] px-1.5 py-0">
              草稿
            </Badge>
          )}
          {tags.length > 0 && <TagList tags={tags} />}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {hasCover && (
            <img src={post.cover_image} alt={post.title} className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-1 ring-border/50" />
          )}
          <h3 className="min-w-0 text-[15px] font-black leading-snug tracking-[-0.025em] text-foreground truncate">
            {post.title}
          </h3>
        </div>
        {excerpt && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {excerpt}
          </p>
        )}
        <div className="mt-auto pt-1.5">
          <MetaInfo post={post} />
        </div>
      </div>
    </motion.article>
  );
}
