import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const componentContracts = [
  ["src/components/NavBar.tsx", "navItemVariants"],
  ["src/features/admin/components/AdminNav.tsx", "navItemVariants"],
  ["src/features/ai-chat/ai-sidebar/ConversationListView.tsx", "surfaceVariants"],
  ["src/features/subscription/components/SubscriptionPanel.tsx", "surfaceVariants"],
  ["src/features/blog/components/BlogOverviewPanel.tsx", "WorkspacePanel"],
  ["src/features/blog/components/BlogPostCard.tsx", "surfaceVariants"],
  ["src/features/auth/LoginForm.tsx", "TabsTrigger"],
  ["src/features/auth/LoginForm.tsx", "Alert"],
  ["src/components/NavBar.tsx", "Select"],
  ["src/features/plugins/PluginCenterDialog.tsx", "DialogContent"],
  ["src/features/admin/components/PluginsPage.tsx", "Textarea"],
  ["src/features/subscription/components/SubscriptionPanel.tsx", "Alert"],
  ["src/features/blog/components/BlogPostView.tsx", "variant=\"destructive\""],
];

const foundationContracts = [
  ["src/components/ui/button.tsx", "rounded-control"],
  ["src/components/ui/input.tsx", "rounded-control"],
  ["src/components/ui/textarea.tsx", "rounded-control"],
  ["src/components/ui/select.tsx", "rounded-control"],
  ["src/components/ui/badge.tsx", "variant: {"],
  ["src/components/ui/tabs.tsx", "rounded-panel"],
  ["src/components/ui/alert.tsx", "variant: {"],
  ["src/components/ui/dropdown-menu.tsx", "rounded-panel"],
  ["src/components/ui/context-menu.tsx", "rounded-panel"],
  ["src/components/ui/tooltip.tsx", "rounded-control"],
];

const retiredPatterns = [
  "SOFT_SELECTED_SURFACE",
  "border-primary/25 bg-primary/10 shadow-md shadow-primary/8",
  "border-primary/18 bg-primary/10 text-primary shadow-sm shadow-primary/8",
];

const emptyStateSurfaceContracts = [
  ["src/features/blog/components/BlogPage.tsx", "border-dashed"],
];

const rawNativeControlAllowlist = new Set([
  "src/components/ui/input.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/select.tsx",
  // 文件选择器没有可见视觉表面，保留原生隐藏 input。
  "src/features/ai-chat/ai-sidebar/ChatInputBar.tsx",
  "src/features/blog/components/BlogEditor.tsx",
  "src/features/workspace/WorkspaceNav.tsx",
]);

// These are implementation details of a primitive; product code must use a named radius token.
const rawRadiusAllowlist = new Set([
  "src/components/ui/scroll-area.tsx",
]);

// These files use palette color as data encoding (file-type icons, graph nodes) or
// categorical chart-like tones (admin metric tiles) where no semantic token exists.
// Everywhere else, color must come from semantic tokens (bg-/text-/border-<token>).
const colorPaletteAllowlist = new Set([
  // 文件类型图标:颜色编码文件格式
  "src/components/fileIcons.tsx",
  // 管理后台 metric tile:分类着色(无对应语义 token)
  "src/features/admin/components/OverviewPage.tsx",
]);

// Mermaid owns its renderer palette and cannot consume Tailwind classes.
const rendererColorAllowlist = new Set([
  "src/components/MermaidBlock.tsx",
]);

const errors = [];

for (const [relativePath, requiredSymbol] of componentContracts) {
  const content = await readFile(resolve(relativePath), "utf8");
  if (!content.includes(requiredSymbol)) {
    errors.push(`${relativePath} must use ${requiredSymbol}.`);
  }
}

for (const [relativePath, requiredSymbol] of foundationContracts) {
  const content = await readFile(resolve(relativePath), "utf8");
  if (!content.includes(requiredSymbol)) {
    errors.push(`${relativePath} must preserve the shared foundation token: ${requiredSymbol}.`);
  }
}

const allSourceFiles = await Promise.all(
  componentContracts.map(async ([relativePath]) => [
    relativePath,
    await readFile(resolve(relativePath), "utf8"),
  ]),
);

for (const [relativePath, content] of allSourceFiles) {
  for (const pattern of retiredPatterns) {
    if (content.includes(pattern)) {
      errors.push(`${relativePath} still contains the retired style: ${pattern}`);
    }
  }
}

for (const [relativePath, forbiddenPattern] of emptyStateSurfaceContracts) {
  const content = await readFile(resolve(relativePath), "utf8");
  if (content.includes(forbiddenPattern)) {
    errors.push(`${relativePath} must not use ${forbiddenPattern} for a passive empty state.`);
  }
}

async function listTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(entryPath);
    return entry.name.endsWith(".tsx") ? [entryPath] : [];
  }));
  return paths.flat();
}

const sourceFiles = await listTsxFiles(resolve("src"));

for (const sourcePath of sourceFiles) {
  const sourceRelativePath = relative(process.cwd(), sourcePath).replaceAll("\\", "/");
  const content = await readFile(sourcePath, "utf8");

  if (!rawNativeControlAllowlist.has(sourceRelativePath)) {
    const rawControl = content.match(/<(input|textarea|select)\b/);
    if (rawControl) {
      errors.push(`${sourceRelativePath} contains a raw <${rawControl[1]}>; use the shared control component instead.`);
    }
  }

  if (!rawRadiusAllowlist.has(sourceRelativePath)) {
    const rawRadius = content.match(/rounded-\[(?!inherit\])[^\]]+\]/);
    if (rawRadius) {
      errors.push(`${sourceRelativePath} contains ${rawRadius[0]}; use a named radius token instead.`);
    }
  }

  if (!colorPaletteAllowlist.has(sourceRelativePath)) {
    const paletteColor = content.match(/\b(?:bg|text|ring|fill|stroke|border|from|to|via)-(?:amber|blue|cyan|emerald|green|indigo|lime|orange|pink|purple|red|rose|sky|teal|violet|slate|gray|neutral|zinc|stone)-/);
    if (paletteColor) {
      errors.push(`${sourceRelativePath} contains ${paletteColor[0]}; use a semantic color token (bg-/text-/border-<token>) instead.`);
    }
  }

  if (!rendererColorAllowlist.has(sourceRelativePath)) {
    const hardcodedColor = content.match(/#[0-9a-fA-F]{3,8}\b/);
    if (hardcodedColor) {
      errors.push(`${sourceRelativePath} contains ${hardcodedColor[0]}; use a semantic color token instead.`);
    }
  }
}

if (errors.length) {
  console.error("Visual system guard failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Visual system guard passed for ${componentContracts.length} shared entry points, ${foundationContracts.length} foundation contracts, and ${sourceFiles.length} source files.`);
