import { useState, useRef, useCallback, useEffect } from "react";
import { useChat } from "../stores/chatStore";
import { useChatHooks } from "../hooks/useChat";
import "./KnowledgeBase.css";

export function KnowledgeBase() {
  const { state } = useChat();
  const { loadKBDocuments, uploadToKnowledgeBase, removeKBDocument } = useChatHooks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.activePanel === "knowledge") {
      loadKBDocuments();
    }
  }, [state.activePanel, loadKBDocuments]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      await uploadToKnowledgeBase(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [uploadToKnowledgeBase]);

  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("Delete this document?")) return;
    try {
      await removeKBDocument(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [removeKBDocument]);

  return (
    <div className="knowledge-base">
      <div className="kb-header">
        <h3>Knowledge Base</h3>
        <button
          className="kb-upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "+ Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
      </div>

      {error && (
        <div className="kb-error">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      <div className="kb-list">
        {state.kbDocuments.length === 0 ? (
          <div className="kb-empty">No documents uploaded yet.</div>
        ) : (
          state.kbDocuments.map((doc) => (
            <div key={doc.id} className="kb-document">
              <div className="kb-doc-info">
                <span className="kb-doc-name">{doc.original_name}</span>
                <span className="kb-doc-meta">
                  {doc.chunk_count} chunks · {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
              <button
                className="kb-doc-delete"
                onClick={() => handleDelete(doc.id)}
              >
                x
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
