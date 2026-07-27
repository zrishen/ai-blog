import type { BlogPost } from "../../../stores/chatStore";
import { useChat } from "../../../stores/chatStore";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { surfaceVariants } from "@/lib/visualVariants";
import { cn } from "@/lib/utils";
import { User, Eye, Calendar, Tags } from "lucide-react";
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
    <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${onDarkImage ? "border-white/22 bg-white/14 text-white/82 backdrop-blur-md" : ""}`}
          style={onDarkImage ? undefined : getBlogTagStyle(tag)}
        >
          <Tags className="w-3 h-3" />
          {tag}
        </span>
      ))}
    </div>
  );
}

export function BlogPostCard({ post, variant, onClick }: Props) {
  const { state } = useChat();
  const isDark = state.theme === "dark";
  const excerpt = getExcerpt(post);
  const tags = splitBlogTags(post.tags, 3);
  const hasCover = Boolean(post.cover_image);
  const isAIWriting = Boolean(state.blogStreamingByPostId[post.id]);

  if (variant === "feature-bg") {
    const coverDark = hasCover && isDark;
    return (
      <motion.article
        whileHover={{ y: -6, scale: 1.005 }}
        transition={{ duration: 0.22 }}
        className={cn(
          surfaceVariants({ variant: "featured" }),
          "group relative h-[11rem] w-full cursor-pointer overflow-hidden rounded-feature bg-card/94 md:h-[16rem]",
        )}
        onClick={() => onClick(post.id)}
      >
        {hasCover && (
          <>
            <img src={post.cover_image} alt={post.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            <div className={`absolute inset-0 ${isDark ? "bg-black/55" : "bg-white/10"}`} />
          </>
        )}

        <div className={`absolute inset-x-0 bottom-0 p-6 sm:p-8 ${coverDark ? "text-white" : "text-foreground"}`}>
          {(isAIWriting || post.status === "draft" || tags.length > 0) && (
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
              {isAIWriting && (
                <Badge className={coverDark ? "rounded-full bg-primary/80 text-primary-foreground backdrop-blur-md" : "rounded-full bg-primary/12 text-primary"}>
                  AI 正在写作
                </Badge>
              )}
              {post.status === "draft" && (
                <Badge variant="warning" className={coverDark ? "rounded-full border-warning/35 bg-warning/18 text-warning-foreground backdrop-blur-md" : "rounded-full"}>
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
            <p className={`mt-3 text-body-lg leading-relaxed line-clamp-2 ${coverDark ? "text-white/72" : "text-muted-foreground"}`}>
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
        className={cn(
          surfaceVariants({ variant: "interactive" }),
          "group flex h-[9rem] w-full cursor-pointer overflow-hidden rounded-feature bg-card/94 md:h-[13rem]",
        )}
        onClick={() => onClick(post.id)}
      >
        {hasCover && (
          <div className="relative h-full w-[42%] flex-shrink-0 overflow-hidden border-r border-border/70">
            <img src={post.cover_image} alt={post.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            {isDark && <div className="absolute inset-0 bg-black/55" />}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
          <div className="mb-2 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
            {isAIWriting && (
              <Badge className="rounded-full bg-primary/12 text-primary">AI 正在写作</Badge>
            )}
            {post.status === "draft" && (
              <Badge variant="warning" className="rounded-full">
                草稿
              </Badge>
            )}
            {tags.length > 0 && <TagList tags={tags} />}
          </div>
          <h2 className="text-xl font-black leading-tight tracking-[-0.04em] text-foreground truncate">
            {post.title}
          </h2>
          {excerpt && (
            <p className="mt-2 text-body-lg leading-relaxed text-muted-foreground line-clamp-2">
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
      className={cn(
        surfaceVariants({ variant: "interactive" }),
        "group flex h-auto min-h-[5rem] w-full cursor-pointer overflow-hidden rounded-surface bg-card/92 shadow-sm md:min-h-[7rem]",
      )}
      onClick={() => onClick(post.id)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-3 md:p-4">
        <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
          {isAIWriting && (
            <Badge className="rounded-full bg-primary/12 px-1.5 py-0 text-caption text-primary">AI 正在写作</Badge>
          )}
          {post.status === "draft" && (
            <Badge variant="warning" className="rounded-full px-1.5 py-0 text-caption">
              草稿
            </Badge>
          )}
          {tags.length > 0 && <TagList tags={tags} />}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {hasCover && (
            <img src={post.cover_image} alt={post.title} className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-1 ring-border/50" />
          )}
          <h3 className="min-w-0 text-body-lg font-black leading-snug tracking-[-0.025em] text-foreground truncate">
            {post.title}
          </h3>
        </div>
        {excerpt && (
          <p className="mt-1 text-meta leading-relaxed text-muted-foreground line-clamp-2">
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
