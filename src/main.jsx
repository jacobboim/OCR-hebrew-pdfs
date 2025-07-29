import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Analytics helper functions
export const trackEvent = (eventName, parameters = {}) => {
  if (window.gtag) {
    window.gtag("event", eventName, parameters);
  }
};

export const trackFileUpload = (fileType, fileSizeMB) => {
  trackEvent("file_upload", {
    file_type: fileType,
    file_size_mb: fileSizeMB,
    event_category: "File Management",
  });
};

export const trackExtraction = (
  fileType,
  pageCount,
  processingTime,
  success = true
) => {
  trackEvent(success ? "extraction_success" : "extraction_error", {
    file_type: fileType,
    page_count: pageCount,
    processing_time_seconds: processingTime,
    event_category: "Text Extraction",
  });
};

export const trackTextAction = (action, fileType, textLength) => {
  trackEvent("text_action", {
    action: action, // 'copy' or 'download'
    file_type: fileType,
    text_length: textLength,
    event_category: "Text Management",
  });
};

// Analytics initialization component
function AnalyticsWrapper({ children }) {
  useEffect(() => {
    // Initialize Google Analytics
    if (window.gtag) {
      window.gtag("config", "G-SYFCR38GW8", {
        page_title: "Hebrew Text Extractor",
        page_location: window.location.href,
      });

      // Track initial page load
      window.gtag("event", "page_view", {
        page_title: "Hebrew Text Extractor - Home",
        page_location: window.location.href,
      });
    }
  }, []);

  return children;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AnalyticsWrapper>
      <App />
    </AnalyticsWrapper>
  </StrictMode>
);
