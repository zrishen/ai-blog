import { useState, useEffect, useMemo } from "react";
import { useChat } from "../../stores/chatStore";
import { getOfficialIntroPost } from "../../api/client";
import type { BlogPostData } from "../../api/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Calendar, Eye, Tags, AlertCircle } from "lucide-react";
import { splitBlogTags, getBlogTagStyle } from "../blog/blogTags";

export function LandingPage() {
  const { dispatch } = useChat();
  const [post, setPost] = useState<BlogPostData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatch({ type: "SET_PAGE", payload: "blog" });
    dispatch({ type: "SET_BLOG_VIEW", payload: "list" });
    dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: null });
  }, [dispatch]);

  useEffect(() => {
    getOfficialIntroPost()
      .then((data) => {
        setPost(data);
        dispatch({ type: "SET_BLOG_POSTS", payload: [data] });
        dispatch({ type: "SET_BLOG_CURRENT_POST_ID", payload: data.id });
      })
      .catch(() => setError("项目介绍暂时无法加载，请稍后重试。"));
  }, [dispatch]);

  const tags = useMemo(() => splitBlogTags(post?.tags), [post?.tags]);
  const date = useMemo(() => {
    if (!post?.created_at) return "";
    return new Date(post.created_at).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [post?.created_at]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="rounded-[2rem] border border-border/70 bg-card/80 px-10 py-9 text-center shadow-xl shadow-foreground/5">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="w-6 h-6" />
          </div>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="rounded-[2rem] border border-border/70 bg-card/80 px-10 py-9 text-center shadow-xl shadow-foreground/5">
          <p className="text-muted-foreground">正在加载项目介绍...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-background px-2 py-2">
      <div className="mx-auto w-full max-w-[980px]">
        <motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden rounded-[2rem] border border-border/70 bg-card/92 shadow-xl shadow-foreground/5"
        >
          <div
            className="relative px-6 pt-8 sm:px-10 sm:pt-10 pb-0"
            style={post.cover_image ? {
              backgroundImage: `url(${post.cover_image})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            } : undefined}
          >
            {post.cover_image && (
              <div className="absolute inset-0 rounded-t-[2rem] bg-card/25 backdrop-blur-[1px]" />
            )}

            <div className="relative mb-5 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-primary/10 text-primary hover:bg-primary/14">
                <Sparkles className="mr-1 h-3 w-3" />
                官方介绍
              </Badge>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
                  style={getBlogTagStyle(tag)}
                >
                  <Tags className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="relative max-w-3xl text-4xl font-black leading-tight tracking-[-0.055em] text-foreground">
              {post.title}
            </h1>

            <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 pb-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {date}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Eye className="w-4 h-4" />
                {post.view_count} 次阅读
              </span>
            </div>
          </div>

          <div className="px-6 pb-10 sm:px-10">
            <div className="prose prose-slate dark:prose-invert mt-4 max-w-none text-foreground prose-headings:tracking-[-0.035em] prose-headings:text-foreground prose-p:leading-8 prose-a:text-primary prose-strong:text-foreground prose-code:rounded-md prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-2xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-blockquote:rounded-r-2xl prose-blockquote:border-l-primary prose-blockquote:bg-primary/5 prose-blockquote:py-1 prose-img:rounded-2xl prose-img:shadow-lg prose-hr:border-border">
              <Markdown remarkPlugins={[remarkGfm]}>{post.content || ""}</Markdown>
            </div>
          </div>
        </motion.article>
      </div>
    </div>
  );
}
