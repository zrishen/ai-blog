import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "../../src/components/ui/alert";
import { Badge } from "../../src/components/ui/badge";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Select } from "../../src/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../../src/components/ui/tabs";
import { Textarea } from "../../src/components/ui/textarea";

describe("foundation controls", () => {
  it("uses the shared control radius and soft focus treatment", () => {
    render(
      <>
        <Button>保存</Button>
        <Input aria-label="标题" />
        <Textarea aria-label="内容" />
        <Select aria-label="协议"><option>OpenAI</option></Select>
        <Badge>进行中</Badge>
      </>,
    );

    expect(screen.getByRole("button", { name: "保存" })).toHaveClass("rounded-control", "focus-visible:ring-ring/20");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveClass("rounded-control", "border-border/70");
    expect(screen.getByRole("textbox", { name: "内容" })).toHaveClass("rounded-control", "border-border/70");
    expect(screen.getByRole("combobox", { name: "协议" })).toHaveClass("rounded-control", "border-border/70");
    expect(screen.getByText("进行中")).toHaveClass("rounded-control", "bg-primary/10");
  });

  it("keeps tab selection and alerts on the shared soft surface", () => {
    render(
      <>
        <Tabs defaultValue="overview">
          <TabsList aria-label="内容视图">
            <TabsTrigger value="overview">概览</TabsTrigger>
          </TabsList>
        </Tabs>
        <Alert variant="warning">额度即将用尽</Alert>
      </>,
    );

    expect(screen.getByRole("tablist", { name: "内容视图" })).toHaveClass("rounded-panel", "border-border/60");
    expect(screen.getByRole("tab", { name: "概览" })).toHaveClass("rounded-control", "data-[state=active]:bg-card/92");
    expect(screen.getByRole("status")).toHaveClass("rounded-panel", "border-warning/25", "bg-warning/10");
  });

  it("provides an underline variant for compact contextual tabs", () => {
    render(
      <Tabs variant="underline" defaultValue="login">
        <TabsList aria-label="登录方式">
          <TabsTrigger value="login">登录</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole("tablist", { name: "登录方式" })).toHaveClass("border-b", "bg-transparent");
    expect(screen.getByRole("tab", { name: "登录" })).toHaveClass("border-b-2", "data-[state=active]:border-primary");
  });
});
