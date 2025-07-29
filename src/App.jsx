import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload,
  FileText,
  Download,
  Copy,
  AlertCircle,
  BarChart3,
  Zap,
  Settings,
  Camera,
} from "lucide-react";

// Import utilities
import { hebrewFonts } from "./utils/constants.js";
import { trackExtraction, trackTextAction } from "./utils/analytics.js";
import {
  validateAndSetFile,
  createDragDropHandlers,
  getAcceptedFileTypes,
  downloadTextFile,
} from "./utils/fileUtils.js";
import {
  loadLibraries,
  forceMemoryCleanup,
  selectProcessingStrategy,
  processImageFile,
  processParallel,
  processChunked,
} from "./utils/ocrUtils.js";
import {
  loadHebrewFonts,
  copyToClipboard,
  updateProgress,
  createBaseStyles,
} from "./utils/uiUtils.js";

const OptimizedHebrewPDFExtractor = () => {
  // Core state
  const [file, setFile] = useState(null);
  const [fileType, setFileType] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [selectedFont, setSelectedFont] = useState("noto");
  const [isDragOver, setIsDragOver] = useState(false);

  // Processing state
  const [processingStrategy, setProcessingStrategy] = useState("auto");
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [pageResults, setPageResults] = useState(new Map());
  const [processingStats, setProcessingStats] = useState({
    totalPages: 0,
    completedPages: 0,
    averageTimePerPage: 0,
    estimatedTimeRemaining: 0,
  });
  const [processingComplete, setProcessingComplete] = useState(false);
  const [intermediateResults, setIntermediateResults] = useState(new Map());

  const processingStatsRef = useRef({
    startTime: null,
    pageStartTimes: new Map(),
    completedTimes: [],
  });

  // Load Hebrew fonts on mount
  useEffect(() => {
    loadHebrewFonts();
  }, []);

  // Processing statistics helpers
  const updateProcessingStats = useCallback(
    (pageNum, isComplete = false) => {
      const now = Date.now();

      if (isComplete) {
        const pageStartTime =
          processingStatsRef.current.pageStartTimes.get(pageNum);
        if (pageStartTime) {
          const pageTime = now - pageStartTime;
          processingStatsRef.current.completedTimes.push(pageTime);

          const avgTime =
            processingStatsRef.current.completedTimes.reduce(
              (a, b) => a + b,
              0
            ) / processingStatsRef.current.completedTimes.length;

          const remainingPages =
            processingStats.totalPages - (processingStats.completedPages + 1);
          const estimatedRemaining = (avgTime * remainingPages) / 1000;

          setProcessingStats((prev) => {
            const newCompletedPages = prev.completedPages + 1;
            updateProgress(newCompletedPages, prev.totalPages, setProgress);

            return {
              ...prev,
              completedPages: newCompletedPages,
              averageTimePerPage: avgTime / 1000,
              estimatedTimeRemaining: estimatedRemaining,
            };
          });
        }
      } else {
        processingStatsRef.current.pageStartTimes.set(pageNum, now);
      }
    },
    [processingStats.totalPages]
  );

  // Store intermediate results without updating UI
  const storeIntermediateResults = useCallback((results) => {
    setIntermediateResults(new Map(results));
    setPageResults(new Map(results));
  }, []);

  // Finalize results and update UI
  const finalizeResults = useCallback(
    (results) => {
      const sortedPages = Array.from(results.keys()).sort((a, b) => a - b);
      const finalText = sortedPages
        .map((pageNum) => {
          const result = results.get(pageNum);
          if (fileType === "image" && results.size === 1) {
            return result.text;
          }
          return `--- Page ${pageNum} ---\n${result.text}\n`;
        })
        .join("\n");

      setExtractedText(finalText);
      setPageResults(new Map(results));
      setProcessingComplete(true);
    },
    [fileType]
  );

  // Main processing function
  const processFile = async () => {
    if (!file) return;

    setProcessing(true);
    setProgress(0);
    setError("");
    setExtractedText("");
    setMemoryUsage(0);
    setPageResults(new Map());
    setIntermediateResults(new Map());
    setProcessingComplete(false);

    processingStatsRef.current = {
      startTime: Date.now(),
      pageStartTimes: new Map(),
      completedTimes: [],
    };

    try {
      await loadLibraries(fileType);

      let results;
      let pageCount = 1;

      // Create callbacks object for utility functions
      const callbacks = {
        updateProcessingStats,
        setMemoryUsage,
        setProgress,
        setProcessingStats,
        storeIntermediateResults,
        memoryUsage,
        forceMemoryCleanup: () => forceMemoryCleanup(setMemoryUsage),
      };

      if (fileType === "image") {
        console.log(`Processing image: ${file.name}`);
        setProgress(10);
        results = await processImageFile(file, callbacks);
        pageCount = 1;
      } else {
        // Process PDF
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
          .promise;

        pageCount = pdf.numPages;
        const fileSizeMB = file.size / (1024 * 1024);

        setProcessingStats({
          totalPages: pageCount,
          completedPages: 0,
          averageTimePerPage: 0,
          estimatedTimeRemaining: 0,
        });

        setProgress(5);

        const strategy = selectProcessingStrategy(
          processingStrategy,
          pageCount,
          fileSizeMB
        );
        console.log(
          `Using strategy: ${strategy} for ${pageCount} pages (${fileSizeMB.toFixed(
            1
          )}MB)`
        );

        switch (strategy) {
          case "parallel":
            results = await processParallel(pdf, 3, callbacks);
            break;
          case "batch":
            results = await processParallel(pdf, 2, callbacks);
            break;
          case "chunked":
            results = await processChunked(pdf, 5, callbacks);
            break;
          case "progressive":
            results = await processChunked(pdf, 3, callbacks);
            break;
          default:
            results = await processChunked(pdf, 5, callbacks);
        }
      }

      finalizeResults(results);
      setProgress(100);

      // Track successful extraction
      const totalTime =
        (Date.now() - processingStatsRef.current.startTime) / 1000;
      trackExtraction(fileType, pageCount, totalTime, true);

      console.log(`Processing completed in ${totalTime.toFixed(1)}s`);
    } catch (err) {
      setError(`Error processing file: ${err.message}`);
      console.error("Processing error:", err);

      // Track failed extraction
      const totalTime =
        (Date.now() - processingStatsRef.current.startTime) / 1000;
      trackExtraction(fileType, pageResults.size || 1, totalTime, false);
    } finally {
      setProcessing(false);
      await forceMemoryCleanup(setMemoryUsage);
    }
  };

  // Event handlers
  const handleFileUpload = (event) => {
    const selectedFile = event.target.files[0];
    const callbacks = {
      setFile,
      setFileType,
      setError,
      setExtractedText,
      setPageResults,
      setIntermediateResults,
      setProcessingComplete,
    };
    validateAndSetFile(selectedFile, callbacks);
  };

  const handleFileSelect = (selectedFile) => {
    const callbacks = {
      setFile,
      setFileType,
      setError,
      setExtractedText,
      setPageResults,
      setIntermediateResults,
      setProcessingComplete,
    };
    validateAndSetFile(selectedFile, callbacks);
  };

  const handleCopyToClipboard = async () => {
    const success = await copyToClipboard(extractedText);
    if (success) {
      alert("Text copied to clipboard");
      trackTextAction("copy", fileType, extractedText.length);
    } else {
      alert("Failed to copy text to clipboard");
    }
  };

  const handleDownloadText = () => {
    downloadTextFile(extractedText, file.name);
    trackTextAction("download", fileType, extractedText.length);
  };

  // Create drag and drop handlers
  const dragDropHandlers = createDragDropHandlers(
    setIsDragOver,
    handleFileSelect
  );

  // Create styles
  const baseStyles = createBaseStyles(isDragOver, selectedFont, hebrewFonts);

  return (
    <div style={baseStyles.container}>
      <div style={baseStyles.card}>
        <h1 style={baseStyles.title}>
          <Zap size={28} style={{ display: "inline", marginRight: "8px" }} />
          Hebrew Text Extractor
        </h1>
        <p style={baseStyles.subtitle}>
          Convert Hebrew PDFs and images to editable text • Advanced OCR
          processing • Memory optimization • Multiple formats supported
        </p>

        {/* Strategy Selection - Only show for PDFs */}
        {(!file || fileType === "pdf") && (
          <div style={{ marginBottom: "24px" }}>
            <h3 style={baseStyles.sectionTitle}>
              <Settings
                size={20}
                style={{ display: "inline", marginRight: "8px" }}
              />
              Processing Strategy (for PDFs):
            </h3>
            <select
              value={processingStrategy}
              onChange={(e) => setProcessingStrategy(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                marginBottom: "8px",
              }}
            >
              <option value="auto">Auto-Select (Recommended)</option>
              <option value="parallel">Parallel (Fast, 1-10 pages)</option>
              <option value="batch">Batch (Balanced, 5-20 pages)</option>
              <option value="chunked">
                Chunked (Memory efficient, 20+ pages)
              </option>
              <option value="progressive">
                Progressive (Large files, 50+ pages)
              </option>
            </select>
            <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
              Auto-select chooses the best strategy based on file size and page
              count. Images are processed directly.
            </p>
          </div>
        )}

        {/* File Upload */}
        <div style={{ marginBottom: "24px" }}>
          <div
            onDragEnter={dragDropHandlers.handleDragEnter}
            onDragLeave={dragDropHandlers.handleDragLeave}
            onDragOver={dragDropHandlers.handleDragOver}
            onDrop={dragDropHandlers.handleDrop}
            style={baseStyles.dropzone}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", gap: "16px" }}>
                <Upload
                  size={48}
                  style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
                />
                <Camera
                  size={48}
                  style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
                />
              </div>
              <input
                type="file"
                accept={getAcceptedFileTypes()}
                onChange={handleFileUpload}
                style={{ display: "none" }}
                id="file-upload"
              />
              <label htmlFor="file-upload" style={baseStyles.button}>
                Choose PDF or Image File
              </label>
              <p style={{ color: "#6b7280", margin: 0 }}>
                {isDragOver
                  ? "Drop your file here!"
                  : "Or drag and drop a PDF or image file here"}
              </p>
              <p style={{ color: "#6b7280", fontSize: "12px", margin: 0 }}>
                Supported: PDF, JPG, PNG, WebP, BMP, TIFF, GIF
              </p>
              {file && (
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#059669", fontWeight: "500", margin: 0 }}>
                    Selected: {file.name} ({fileType?.toUpperCase()})
                  </p>
                  <p
                    style={{
                      color: "#6b7280",
                      fontSize: "12px",
                      margin: "4px 0 0 0",
                    }}
                  >
                    Size: {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Process Button */}
        {file && (
          <div style={{ marginBottom: "24px", textAlign: "center" }}>
            <button
              onClick={processFile}
              disabled={processing}
              style={{
                ...baseStyles.button,
                backgroundColor: processing ? "#9ca3af" : "#3b82f6",
                cursor: processing ? "not-allowed" : "pointer",
                margin: "0 auto",
              }}
            >
              <FileText size={20} />
              Extract Hebrew Text
            </button>
          </div>
        )}

        {/* Processing Statistics */}
        {processing && (
          <div style={baseStyles.statsCard}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <BarChart3 size={20} style={{ marginRight: "8px" }} />
              <h3 style={{ ...baseStyles.sectionTitle, margin: 0 }}>
                Processing Statistics
              </h3>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "16px",
                fontSize: "14px",
              }}
            >
              <div>
                <strong>Progress:</strong> {processingStats.completedPages}/
                {processingStats.totalPages}{" "}
                {fileType === "image" ? "image" : "pages"}
              </div>
            </div>
            <div
              style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}
            >
              Memory Usage: {memoryUsage.toFixed(0)} MB • Type:{" "}
              {fileType?.toUpperCase()}
              {fileType === "pdf" && (
                <>
                  {" "}
                  • Strategy:{" "}
                  {processingStrategy === "auto"
                    ? "Auto-selected"
                    : processingStrategy}
                </>
              )}
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {processing && (
          <div style={{ marginBottom: "24px" }}>
            <div
              style={{
                width: "100%",
                height: "8px",
                backgroundColor: "#e5e7eb",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  backgroundColor: "#3b82f6",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <p
              style={{
                fontSize: "14px",
                color: "#6b7280",
                marginTop: "8px",
                textAlign: "center",
              }}
            >
              {processingStats.completedPages === 0
                ? "Initializing..."
                : processingStats.completedPages === processingStats.totalPages
                ? "Finalizing results..."
                : fileType === "image"
                ? "Processing image with Hebrew OCR..."
                : `Processing pages with Hebrew OCR... (${processingStats.completedPages}/${processingStats.totalPages} pages completed)`}
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertCircle size={20} style={{ color: "#dc2626" }} />
            <span style={{ color: "#dc2626" }}>{error}</span>
          </div>
        )}

        {/* Results - Only show when processing is completely finished */}
        {!processing && processingComplete && extractedText && (
          <div style={{ marginBottom: "24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3 style={baseStyles.sectionTitle}>
                Extracted Text{" "}
                {fileType === "pdf" ? `(${pageResults.size} pages)` : ""}:
              </h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={handleCopyToClipboard}
                  style={{ ...baseStyles.button, backgroundColor: "#6b7280" }}
                >
                  <Copy size={16} />
                  Copy
                </button>
                <button
                  onClick={handleDownloadText}
                  style={{ ...baseStyles.button, backgroundColor: "#3b82f6" }}
                >
                  <Download size={16} />
                  Download
                </button>
              </div>
            </div>

            {/* Font Selector */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                  marginBottom: "4px",
                }}
              >
                Choose Hebrew Font:
              </label>
              <select
                value={selectedFont}
                onChange={(e) => setSelectedFont(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                }}
              >
                {Object.entries(hebrewFonts).map(([key, font]) => (
                  <option key={key} value={key}>
                    {font.name}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              value={extractedText}
              readOnly
              style={baseStyles.textarea}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default OptimizedHebrewPDFExtractor;
