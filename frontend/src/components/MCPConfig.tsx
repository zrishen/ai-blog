import { useState, useCallback, useEffect } from "react";
import { useChat } from "../stores/chatStore";
import { useChatHooks } from "../hooks/useChat";
import "./MCPConfig.css";

interface MCPServerFormData {
  name: string;
  server_type: "stdio" | "sse";
  command: string;
  args: string;
  url: string;
}

export function MCPConfig() {
  const { state, dispatch } = useChat();
  const { loadMCPServers, addMCPServer, removeMCPServer } = useChatHooks();
  const [servers, setServers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<MCPServerFormData>({
    name: "",
    server_type: "stdio",
    command: "",
    args: "",
    url: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.activePanel === "mcp") {
      loadMCPServers();
    }
  }, [state.activePanel, loadMCPServers]);

  useEffect(() => {
    setServers(state.mcpServers);
  }, [state.mcpServers]);

  const handleToggle = useCallback(
    async (id: number, isActive: boolean) => {
      try {
        const { toggleMCPServer } = await import("../api/client");
        await toggleMCPServer(id, !isActive);
        setServers((prev: any) =>
          prev.map((s: any) => (s.id === id ? { ...s, is_active: !isActive } : s)),
        );
        dispatch({
          type: "SET_MCP_SERVERS",
          payload: servers.map((s: any) => (s.id === id ? { ...s, is_active: !isActive } : s)),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Toggle failed");
      }
    },
    [servers, dispatch],
  );

  const handleAdd = useCallback(async () => {
    if (!formData.name.trim()) {
      setError("Name is required");
      return;
    }
    if (formData.server_type === "stdio" && !formData.command.trim()) {
      setError("Command is required for stdio servers");
      return;
    }
    if (formData.server_type === "sse" && !formData.url.trim()) {
      setError("URL is required for SSE servers");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addMCPServer({
        name: formData.name.trim(),
        server_type: formData.server_type,
        command: formData.server_type === "stdio" ? formData.command.trim() || undefined : undefined,
        args:
          formData.server_type === "stdio" && formData.args.trim()
            ? formData.args.trim().split(/\s+/).filter(Boolean)
            : undefined,
        url: formData.server_type === "sse" ? formData.url.trim() || undefined : undefined,
      });
      setShowForm(false);
      setFormData({ name: "", server_type: "stdio", command: "", args: "", url: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }, [formData, addMCPServer]);

  const handleDelete = useCallback(
    async (id: number) => {
      // builtin servers should use toggle, not delete
      const srv = servers.find((s: any) => s.id === id);
      if (srv && srv.server_type === "builtin") {
        setError("Cannot delete built-in servers, use the toggle switch instead");
        return;
      }
      if (!confirm("Delete this MCP server?")) return;
      try {
        await removeMCPServer(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [servers, removeMCPServer],
  );

  return (
    <div className="mcp-config">
      <div className="mcp-header">
        <h3>MCP Servers</h3>
        <button
          className="mcp-add-btn"
          onClick={() => setShowForm(!showForm)}
          disabled={saving}
        >
          {saving ? "Saving..." : "+ Add"}
        </button>
      </div>

      {error && (
        <div className="mcp-error">
          {error}
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}

      {showForm && (
        <div className="mcp-form">
          <input
            placeholder="Server name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <select
            value={formData.server_type}
            onChange={(e) =>
              setFormData({
                ...formData,
                server_type: e.target.value as "stdio" | "sse",
              })
            }
          >
            <option value="stdio">stdio (local process)</option>
            <option value="sse">SSE (remote)</option>
          </select>

          {formData.server_type === "stdio" && (
            <>
              <input
                placeholder="Command (e.g. python)"
                value={formData.command}
                onChange={(e) => setFormData({ ...formData, command: e.target.value })}
              />
              <input
                placeholder="Args (space-separated, e.g. -m src.services.mcp_server_tools)"
                value={formData.args}
                onChange={(e) => setFormData({ ...formData, args: e.target.value })}
              />
            </>
          )}

          {formData.server_type === "sse" && (
            <input
              placeholder="SSE URL (e.g. https://example.com/mcp)"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
            />
          )}

          <div className="mcp-form-actions">
            <button onClick={handleAdd} disabled={saving}>
              Save
            </button>
            <button onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mcp-list">
        {servers.length === 0 ? (
          <div className="mcp-empty">No MCP servers configured.</div>
        ) : (
          servers.map((server: any) => (
            <div key={server.id} className={`mcp-card${server.server_type === "builtin" ? " mcp-card-builtin" : ""}`}>
              <div className="mcp-card-info">
                <span className="mcp-card-name">
                  {server.server_type === "builtin" ? "🔧" : server.server_type === "stdio" ? "⚙️" : "🌐"}{" "}
                  {server.name}
                </span>
                <span className="mcp-card-meta">
                  <span className={`type-badge type-badge-${server.server_type}`}>{server.server_type}</span>
                  {server.command && ` · ${server.command}`}
                  {server.url && ` · ${server.url}`}
                </span>
              </div>
              <div className="mcp-card-actions">
                {server.server_type === "builtin" ? (
                  <label className="mcp-toggle">
                    <input
                      type="checkbox"
                      checked={server.is_active}
                      onChange={() => handleToggle(server.id, server.is_active)}
                    />
                    <span className="mcp-toggle-track">
                      <span className="mcp-toggle-thumb" />
                    </span>
                  </label>
                ) : (
                  <button
                    className="mcp-delete-btn"
                    onClick={() => handleDelete(server.id)}
                    title="Delete"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
