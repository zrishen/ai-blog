import { useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  FileStack,
  PenLine,
  Search,
  Sparkles,
} from "lucide-react";
import { LoginDialog } from "../auth/LoginDialog";
import { useAuth, type AuthUser } from "../../stores/authStore";
import "./LandingPage.css";

const workflow = [
  {
    number: "01",
    title: "捕捉灵感",
    description: "把零散想法、网页摘录和文件放进同一处，让素材先聚拢，再开始写。",
    icon: PenLine,
  },
  {
    number: "02",
    title: "研究与连接",
    description: "用 AI 追问、检索和梳理证据，把观点放进更清晰的知识关系里。",
    icon: Search,
  },
  {
    number: "03",
    title: "写作与发布",
    description: "从结构、段落到成稿持续打磨，最终发布成真正属于你的内容。",
    icon: BookOpen,
  },
];

const notes = [
  {
    label: "写作方法",
    title: "如何把一次灵感，变成可复用的知识资产",
    excerpt: "从临时笔记出发，逐步补齐上下文、证据和自己的判断。",
    tone: "blue",
  },
  {
    label: "AI 协作",
    title: "让 AI 成为编辑，而不是替你说话的人",
    excerpt: "保留作者的判断，把模型放在提问、校对与结构化的位置。",
    tone: "green",
  },
  {
    label: "深度研究",
    title: "从信息收藏到观点形成，中间还缺什么？",
    excerpt: "收藏只是开始，真正重要的是建立来源、主张与证据之间的连接。",
    tone: "amber",
  },
];

export function LandingPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginDestination, setLoginDestination] = useState<"blog" | "research">("blog");
  const personalBlogPath = user?.username
    ? `/u/${encodeURIComponent(user.username)}`
    : "/";

  const handlePersonalBlogClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isAuthenticated && user?.username) return;
    event.preventDefault();
    setLoginDestination("blog");
    setLoginDialogOpen(true);
  };

  const handleResearchClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isAuthenticated) return;
    event.preventDefault();
    setLoginDestination("research");
    setLoginDialogOpen(true);
  };

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    if (loginDestination === "research") {
      navigate("/research");
      return;
    }
    navigate(`/u/${encodeURIComponent(loggedInUser.username)}`);
  };

  return (
    <div className="site-home">
      <header className="site-header">
        <a className="site-brand" href="/" aria-label="AI Blog 首页">
          <span className="site-brand-mark">AI</span>
          <span>
            <strong>AI Blog</strong>
            <small>把想法写成体系</small>
          </span>
        </a>

        <nav className="site-nav" aria-label="首页导航">
          <a href="#workflow">工作流</a>
          <a href="#notes">精选内容</a>
          <a href="#features">核心能力</a>
        </nav>

        <Link className="site-header-cta" to={personalBlogPath} onClick={handlePersonalBlogClick}>
          打开工作台
          <ArrowRight aria-hidden="true" />
        </Link>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-hero-copy">
            <div className="site-eyebrow">
              <Sparkles aria-hidden="true" />
              AI 原生写作与知识空间
            </div>
            <h1>
              把零散的想法，
              <span>写成可以生长的知识。</span>
            </h1>
            <p className="site-hero-lead">
              AI Blog 把写作、资料库和深度研究放进同一个工作流。你负责判断与表达，AI
              帮你整理线索、发现连接、打磨成稿。
            </p>
            <div className="site-hero-actions">
              <Link className="site-primary-button" to={personalBlogPath} onClick={handlePersonalBlogClick}>
                进入创作空间
                <ArrowRight aria-hidden="true" />
              </Link>
              <a className="site-secondary-button" href="#workflow">
                看看如何工作
              </a>
            </div>
            <div className="site-trust-row" aria-label="产品特点">
              <span><Check aria-hidden="true" />内容由你掌控</span>
              <span><Check aria-hidden="true" />AI 全程协作</span>
              <span><Check aria-hidden="true" />研究可追溯</span>
            </div>
          </div>

          <div className="site-editor-scene" aria-label="AI Blog 写作界面示意">
            <div className="site-orbit site-orbit-one" />
            <div className="site-orbit site-orbit-two" />
            <div className="site-editor-card">
              <div className="site-editor-topbar">
                <span className="site-window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>notes / thinking-in-systems.md</span>
                <span className="site-saved">已保存</span>
              </div>
              <div className="site-editor-body">
                <div className="site-editor-kicker">正在写作 · 6 分钟阅读</div>
                <h2>让研究先形成证据，再长成文章。</h2>
                <p>
                  好文章不是信息的堆叠。它需要一个清楚的问题、可信的来源，以及作者愿意承担的判断。
                </p>
                <div className="site-editor-line short" />
                <div className="site-editor-line" />
                <div className="site-editor-line medium" />

                <aside className="site-ai-note">
                  <span><BrainCircuit aria-hidden="true" /></span>
                  <div>
                    <strong>AI 编辑建议</strong>
                    <p>这里可以补充一个反例，让“信息”和“证据”的区别更具体。</p>
                  </div>
                </aside>

                <div className="site-source-row">
                  <FileStack aria-hidden="true" />
                  <span>已关联 8 条笔记与 3 个来源</span>
                  <strong>查看关系</strong>
                </div>
              </div>
            </div>
            <div className="site-floating-tag site-floating-tag-one">研究图谱</div>
            <div className="site-floating-tag site-floating-tag-two">AI 对话</div>
          </div>
        </section>

        <section className="site-section site-workflow" id="workflow">
          <div className="site-section-heading">
            <span>一个连贯的创作过程</span>
            <h2>从想到，到想清楚，再到写出来。</h2>
            <p>不再在聊天窗口、收藏夹和文档之间来回搬运。</p>
          </div>

          <div className="site-workflow-grid">
            {workflow.map((item) => {
              const Icon = item.icon;
              return (
                <article className="site-workflow-card" key={item.number}>
                  <div className="site-step-meta">
                    <span>{item.number}</span>
                    <Icon aria-hidden="true" />
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="site-section site-notes" id="notes">
          <div className="site-section-heading site-section-heading-row">
            <div>
              <span>精选内容</span>
              <h2>写作，是思考留下的形状。</h2>
            </div>
            <p>围绕写作、研究与 AI 协作，持续沉淀真实可用的方法。</p>
          </div>

          <div className="site-notes-grid">
            {notes.map((note, index) => (
              <article className={`site-note-card site-note-${note.tone}`} key={note.title}>
                <div className="site-note-visual" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div className="site-note-rings"><i /><i /><i /></div>
                </div>
                <div className="site-note-copy">
                  <span>{note.label}</span>
                  <h3>{note.title}</h3>
                  <p>{note.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="site-section site-features" id="features">
          <div className="site-feature-intro">
            <span>围绕内容，而不是工具</span>
            <h2>越写，知识之间的连接越清楚。</h2>
            <p>
              每一次写作都可以回到你的资料、研究与历史内容。AI Blog
              不只帮你完成一篇文章，也帮你建立下一篇文章的起点。
            </p>
            <Link to="/research" onClick={handleResearchClick}>
              探索研究空间
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <div className="site-feature-board">
            <div className="site-feature-card site-feature-card-large">
              <BrainCircuit aria-hidden="true" />
              <div>
                <strong>上下文感知的 AI 协作</strong>
                <p>围绕当前文章、文件和研究主题展开对话，减少重复说明。</p>
              </div>
            </div>
            <div className="site-feature-card">
              <FileStack aria-hidden="true" />
              <div>
                <strong>统一资料库</strong>
                <p>集中管理文件、笔记和写作素材。</p>
              </div>
            </div>
            <div className="site-feature-card">
              <Search aria-hidden="true" />
              <div>
                <strong>可追溯研究</strong>
                <p>把来源、主张和证据放进同一张图谱。</p>
              </div>
            </div>
          </div>
        </section>

        <section className="site-cta-section">
          <div>
            <span>你的下一篇文章，可以从这里开始。</span>
            <h2>让想法不只被记录，也被真正理解。</h2>
          </div>
          <Link
            className="site-primary-button site-primary-button-light"
            to={personalBlogPath}
            onClick={handlePersonalBlogClick}
          >
            打开 AI Blog
            <ArrowRight aria-hidden="true" />
          </Link>
        </section>
      </main>

      <footer className="site-footer">
        <a className="site-brand" href="/" aria-label="AI Blog 首页">
          <span className="site-brand-mark">AI</span>
          <span><strong>AI Blog</strong></span>
        </a>
        <p>把想法写成体系，让知识继续生长。</p>
        <span>AI-native writing space</span>
      </footer>

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        onSuccess={handleLoginSuccess}
        appearance="light"
      />
    </div>
  );
}
