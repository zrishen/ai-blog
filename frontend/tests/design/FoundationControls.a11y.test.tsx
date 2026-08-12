import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "../../src/components/ui/alert";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import { Select } from "../../src/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../src/components/ui/tabs";
import { Textarea } from "../../src/components/ui/textarea";

describe("foundation controls accessibility", () => {
  it("keeps the shared controls free of actionable accessibility violations", async () => {
    const { container } = render(
      <main aria-label="视觉系统回归示例">
        <Tabs defaultValue="settings">
          <TabsList aria-label="设置类别">
            <TabsTrigger value="settings">设置</TabsTrigger>
            <TabsTrigger value="usage">用量</TabsTrigger>
          </TabsList>
          <TabsContent value="settings">
            <form aria-label="模型设置" className="space-y-3">
              <label htmlFor="model-name">模型名称</label>
              <Input id="model-name" name="model-name" required />
              <label htmlFor="protocol">协议</label>
              <Select id="protocol" name="protocol" defaultValue="openai">
                <option value="openai">OpenAI</option>
              </Select>
              <label htmlFor="note">备注</label>
              <Textarea id="note" name="note" />
              <Button type="submit">保存</Button>
            </form>
          </TabsContent>
          <TabsContent value="usage">本周用量</TabsContent>
        </Tabs>
        <Alert variant="warning">
          <AlertTitle>用量提醒</AlertTitle>
          <AlertDescription>本周额度即将用尽。</AlertDescription>
        </Alert>
      </main>,
    );

    const results = await axe.run(container, {
      rules: {
        // JSDOM 无法计算字体颜色对比，颜色对比由浏览器截图回归覆盖。
        "color-contrast": { enabled: false },
      },
    });

    expect(results.violations).toEqual([]);
  });
});
