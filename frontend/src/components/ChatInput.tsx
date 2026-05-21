import { useState, useRef, useEffect } from "react";
import type { ChangeEvent } from "react";
import { useChat } from "../stores/chatStore";
import { useChatHooks } from "../hooks/useChat";
import { uploadFile } from "../api/client";
import "./ChatInput.css";

function convertToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SUPPORTED_DOC_EXTENSIONS = [".docx", ".xlsx", ".pdf"];

export function ChatInput() {
  const [input, setInput] = useState("");
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [fileUrl, setFileUrl] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | undefined>();
  const { state } = useChat();
  const { sendMessage } = useChatHooks();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;
        const file = new File([blob], "pasted-image.png", { type: "image/png" });
        if (file.size > 20 * 1024 * 1024) {
          alert("图片大小不能超过 20MB。");
          return;
        }
        const base64 = await convertToBase64(file);
        setImageUrl(base64);
        return;
      }
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Handle image files (client-side base64)
    if (file.type.startsWith("image/")) {
      if (file.size > 20 * 1024 * 1024) {
        alert("图片大小不能超过 20MB。");
      }
      const base64 = await convertToBase64(file);
      setImageUrl(base64);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Handle document files (server upload)
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_DOC_EXTENSIONS.includes(ext)) {
      alert("不支持的文件类型，请上传 .docx、.xlsx 或 .pdf 文件。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("文件大小不能超过 10MB。");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    try {
      const result = await uploadFile(file);
      setFileUrl(result.download_url);
      setFileName(result.original_name);
    } catch (err) {
      alert(`上传失败: ${err instanceof Error ? err.message : "未知错误"}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = () => {
    setImageUrl(undefined);
  };

  const removeFile = () => {
    setFileUrl(undefined);
    setFileName(undefined);
  };

  const handleSend = () => {
    if (!input.trim() && !imageUrl && !fileUrl) return;
    if (state.isStreaming) return;
    const text = input;
    const img = imageUrl;
    const file = fileUrl;
    setInput("");
    setImageUrl(undefined);
    setFileUrl(undefined);
    setFileName(undefined);
    sendMessage(text, img, file);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasContent = input.trim() || imageUrl || fileUrl;

  return (
    <div className="chat-input-container">
      {imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt="Preview" />
          <button className="image-preview-remove" onClick={removeImage}>x</button>
        </div>
      )}
      {fileUrl && fileName && (
        <div className="file-preview">
          <span className="file-preview-name">{fileName}</span>
          <button className="file-preview-remove" onClick={removeFile}>x</button>
        </div>
      )}
      <div className="chat-input-wrapper">
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={state.isStreaming}
          title="添加图片或上传文件"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.docx,.xlsx"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="有问题，尽管问"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!hasContent || state.isStreaming}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
