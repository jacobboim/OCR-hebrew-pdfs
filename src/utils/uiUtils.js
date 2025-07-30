// src/utils/uiUtils.js
import { GOOGLE_FONTS_URL } from "./constants.js";

export const formatTime = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
};

export const loadHebrewFonts = () => {
  const link = document.createElement("link");
  link.href = GOOGLE_FONTS_URL;
  link.rel = "stylesheet";

  const existingLink = document.querySelector(`link[href="${link.href}"]`);
  if (!existingLink) {
    document.head.appendChild(link);
  }
};

export const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy text: ", err);
    return false;
  }
};

// Simple page-based progress calculation
export const updateProgress = (completedPages, totalPages, setProgress) => {
  if (totalPages === 0) return;

  const progressPercentage = (completedPages / totalPages) * 100;
  setProgress(Math.min(100, progressPercentage));
};

// Create base styles object
export const createBaseStyles = (isDragOver, selectedFont, hebrewFonts) => ({
  container: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    padding: "20px",
  },
  card: {
    maxWidth: "900px",
    margin: "0 auto",
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "32px",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  },
  title: {
    fontSize: "2rem",
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: "1rem",
    color: "#1f2937",
  },
  subtitle: {
    fontSize: "1rem",
    textAlign: "center",
    marginBottom: "2rem",
    color: "#6b7280",
  },
  sectionTitle: {
    fontSize: "1.125rem",
    fontWeight: "600",
    marginBottom: "12px",
    color: "#374151",
  },
  button: {
    backgroundColor: "#3b82f6",
    color: "white",
    padding: "12px 24px",
    borderRadius: "8px",
    border: "none",
    fontSize: "14px",
    fontWeight: "500",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  dropzone: {
    border: `2px dashed ${isDragOver ? "#3b82f6" : "#d1d5db"}`,
    borderRadius: "8px",
    padding: "48px 24px",
    textAlign: "center",
    backgroundColor: isDragOver ? "#eff6ff" : "#f9fafb",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  textarea: {
    width: "96%",
    height: "400px",
    padding: "16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "16px",
    lineHeight: "1.6",
    fontFamily: hebrewFonts[selectedFont].fontFamily,
    direction: "rtl",
    resize: "none",
    backgroundColor: "#ffffff",
  },
  statsCard: {
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "16px",
  },
});
