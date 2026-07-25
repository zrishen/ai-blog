import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const errors = [];

for (const [relativePath, requiredSymbol] of componentContracts) {
  const content = await readFile(resolve(relativePath), "utf8");
  if (!content.includes(requiredSymbol)) {
    errors.push(`${relativePath} must use ${requiredSymbol}.`);
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

if (errors.length) {
  console.error("Visual system guard failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Visual system guard passed for ${componentContracts.length} shared entry points.`);
