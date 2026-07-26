import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const componentContracts = [
  ["src/components/NavBar.tsx", "navItemVariants"],
  ["src/features/admin/components/AdminNav.tsx", "navItemVariants"],
  ["src/features/ai-chat/ai-sidebar/ConversationListView.tsx", "surfaceVariants"],
  ["src/features/research/ResearchPanel.tsx", "surfaceVariants"],
  ["src/features/research/ResearchPanel.tsx", "WorkspacePanel"],
  ["src/features/research/ResearchGraphPage.tsx", "surfaceVariants"],
  ["src/features/subscription/components/SubscriptionPanel.tsx", "surfaceVariants"],
  ["src/features/file/components/FilePanel.tsx", "WorkspacePanel"],
  ["src/features/blog/components/BlogOverviewPanel.tsx", "WorkspacePanel"],
  ["src/features/blog/components/BlogPostCard.tsx", "surfaceVariants"],
  ["src/features/file/panes/LibraryOverviewPane.tsx", "Surface"],
  ["src/features/research/tabs/OverviewTab.tsx", "SelectableSurface"],
  ["src/features/auth/LoginForm.tsx", "TabsTrigger"],
  ["src/features/auth/LoginForm.tsx", "Alert"],
  ["src/components/NavBar.tsx", "Select"],
  ["src/features/file/components/FilePanel.tsx", "Select"],
  ["src/features/plugins/PluginCenterDialog.tsx", "DialogContent"],
  ["src/features/admin/components/PluginsPage.tsx", "Textarea"],
  ["src/features/subscription/components/SubscriptionPanel.tsx", "Alert"],
  ["src/features/research/process/RunDetail.tsx", "Alert"],
  ["src/features/blog/components/BlogPostView.tsx", "variant=\"destructive\""],
  ["src/features/research/tabs/ProposalsTab.tsx", "statusBadgeVariant"],
  ["src/features/research/tabs/OverviewTab.tsx", "statusBadgeVariant"],
  ["src/features/research/tabs/ClaimsTab.tsx", "statusBadgeVariant"],
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
  ["src/features/research/ResearchGraphPage.tsx", "border-dashed"],
  ["src/features/research/ResearchPanel.tsx", "border-dashed"],
];

const rawNativeControlAllowlist = new Set([
  "src/components/ui/input.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/select.tsx",
  // 文件选择器没有可见视觉表面，保留原生隐藏 input。
  "src/features/ai-chat/ai-sidebar/ChatInputBar.tsx",
  "src/features/blog/components/BlogEditor.tsx",
  "src/features/file/components/FilePanel.tsx",
]);

// These are implementation details of a primitive; product code must use a named radius token.
const rawRadiusAllowlist = new Set([
  "src/components/ui/scroll-area.tsx",
]);

// Research graph nodes use color as data encoding. Product-card borders must stay semantic.
const dataEncodingBorderAllowlist = new Set([
  "src/features/research/nodes/EntityNode.tsx",
  "src/features/research/nodes/EvidenceNode.tsx",
  "src/features/research/nodes/SourceNode.tsx",
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

  if (!dataEncodingBorderAllowlist.has(sourceRelativePath)) {
    const paletteBorder = content.match(/\bborder-(?:amber|blue|cyan|emerald|green|indigo|lime|orange|pink|purple|red|rose|sky|teal|violet)-/);
    if (paletteBorder) {
      errors.push(`${sourceRelativePath} contains ${paletteBorder[0]}; card borders must use semantic border tokens.`);
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
