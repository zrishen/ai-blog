export interface FileCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  parent_id: number | null;
  children?: FileCategory[];
  created_at: string;
}

export interface FileDocument {
  id: number;
  collection_name: string;
  original_name: string;
  file_path: string;
  chunk_count: number;
  category_id: number | null;
  created_at: string;
}
