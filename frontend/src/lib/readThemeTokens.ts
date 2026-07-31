// 读取当前主题的语义色 token（HSL 三元组），供左栏 iframe 注入。
// 让 AI 生成的 HTML 用 var(--background) 等即可跟随明暗主题。
// token 定义见 index.css :root / [data-theme="dark"]。

const TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border",
  "input",
  "ring",
] as const;

export type ThemeTokenName = (typeof TOKEN_NAMES)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;

export function readThemeTokens(): ThemeTokens {
  const root = document.documentElement;
  const get = (name: string) => getComputedStyle(root).getPropertyValue(`--${name}`).trim();
  const tokens = {} as ThemeTokens;
  for (const name of TOKEN_NAMES) {
    tokens[name] = get(name);
  }
  return tokens;
}

// 拼 :root CSS 变量声明，注入 iframe srcdoc，让其中 var(--token) 生效。
export function themeTokensToCss(tokens: ThemeTokens): string {
  const lines = Object.entries(tokens)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `--${name}:hsl(${value});`);
  return `:root{${lines.join("")}}`;
}
