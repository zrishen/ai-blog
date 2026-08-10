import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { AdminPage, AdminPageHeader } from "@/features/admin/components/AdminPage";

describe("admin visual system", () => {
  it("uses themed card borders and soft shadows instead of the text color", () => {
    render(<Card data-testid="admin-card">内容</Card>);

    expect(screen.getByTestId("admin-card")).toHaveClass(
      "rounded-surface",
      "border-border/70",
      "shadow-surface",
      "bg-card/86",
    );
  });

  it("keeps page headings and table separators on the shared admin surface", () => {
    render(
      <AdminPage>
        <AdminPageHeader title="用户管理" description="维护用户信息" />
        <Table>
          <TableBody>
            <TableRow data-testid="admin-row" />
          </TableBody>
        </Table>
      </AdminPage>,
    );

    expect(screen.getByRole("heading", { name: "用户管理" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-row")).toHaveClass("border-border/60");
    expect(screen.getByTestId("admin-page-content")).toHaveClass("w-full", "p-2");
    expect(screen.getByTestId("admin-page-content")).not.toHaveClass("mx-auto", "max-w-7xl");
  });
});
