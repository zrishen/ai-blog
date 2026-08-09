import { formatDate as formatBjDate } from "@/lib/datetime";

export function formatDate(iso: string | undefined | null): string {
  return formatBjDate(iso);
}
