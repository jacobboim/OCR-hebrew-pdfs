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
  ExternalLink,
  Bot,
} from "lucide-react";

// Import utilities
import { hebrewFonts } from "./utils/constants.js";
import {
  trackExtraction,
  trackTextAction,
  trackUserEngagement,
  trackError,
  trackPerformance,
} from "./utils/analytics.js";
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
  processHebrewSeferPage,
  processHebrewSeferImage,
  processParallelHebrewSefer,
  processChunkedHebrewSefer,
} from "./utils/columnOcrUtils.js";
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
  const [columnMode, setColumnMode] = useState("auto"); // New: Column processing mode
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [pageResults, setPageResults] = useState(new Map());
  const [processingStats, setProcessingStats] = useState({
    totalPages: 0,
    completedPages: 0,
    averageTimePerPage: 0,
    estimatedTimeRemaining: 0,
  });

  const [sessionStartTime] = useState(Date.now());
  const [actionsCount, setActionsCount] = useState(0);
  const [sessionData, setSessionData] = useState({
    filesProcessed: 0,
    successfulExtractions: 0,
    errors: 0,
    totalProcessingTime: 0,
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

  // Track user engagement on component unmount
  useEffect(() => {
    const trackSessionEnd = () => {
      const sessionDuration = (Date.now() - sessionStartTime) / 1000;

      trackUserEngagement(sessionDuration, actionsCount);

      // Track session summary
      trackPerformance("session_summary", sessionDuration, {
        filesProcessed: sessionData.filesProcessed,
        successfulExtractions: sessionData.successfulExtractions,
        errors: sessionData.errors,
        totalProcessingTime: sessionData.totalProcessingTime,
        actionsCount,
      });
    };

    // Track on page unload
    window.addEventListener("beforeunload", trackSessionEnd);

    return () => {
      trackSessionEnd();
      window.removeEventListener("beforeunload", trackSessionEnd);
    };
  }, [sessionStartTime, actionsCount, sessionData]);

  const handleError = useCallback(
    (error, context = {}) => {
      console.error("App Error:", error);
      setError(error.message);

      trackError("processing_error", error.message, {
        fileType,
        fileName: file?.name,
        ...context,
      });

      setSessionData((prev) => ({ ...prev, errors: prev.errors + 1 }));
    },
    [fileType, file]
  );

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

    const startTime = Date.now();
    setActionsCount((prev) => prev + 1);

    setProcessing(true);
    setProgress(0);
    setError("");
    setExtractedText("");
    setMemoryUsage(0);
    setPageResults(new Map());
    setIntermediateResults(new Map());
    setProcessingComplete(false);

    processingStatsRef.current = {
      startTime,
      pageStartTimes: new Map(),
      completedTimes: [],
    };

    try {
      await loadLibraries(fileType);

      let results;
      let pageCount = 1;

      // Track performance metrics
      trackPerformance("memory_usage_start", memoryUsage, { fileType });

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
        console.log(
          `Processing image: ${file.name} with column mode: ${columnMode}`
        );
        setProgress(10);

        if (columnMode === "auto" || columnMode === "force_columns") {
          // Use Hebrew sefer processing with column detection
          results = await processHebrewSeferImage(file, columnMode, callbacks);
        } else {
          // Use standard image processing
          results = await processImageFile(file, callbacks);
        }
        pageCount = 1;
      } else {
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

        // Track strategy selection
        trackPerformance("strategy_selected", strategy, {
          pageCount,
          fileSizeMB,
          processingStrategy,
        });

        console.log(
          `Using strategy: ${strategy} for ${pageCount} pages (${fileSizeMB.toFixed(
            1
          )}MB) with column mode: ${columnMode}`
        );

        // Enhanced callbacks for Hebrew sefer processing
        const enhancedCallbacks = {
          ...callbacks,
          columnMode,
        };

        switch (strategy) {
          case "parallel":
            if (columnMode === "auto" || columnMode === "force_columns") {
              // Use Hebrew sefer processing for parallel
              results = await processParallelHebrewSefer(
                pdf,
                3,
                columnMode,
                enhancedCallbacks
              );
            } else {
              results = await processParallel(pdf, 3, callbacks);
            }
            break;
          case "batch":
            if (columnMode === "auto" || columnMode === "force_columns") {
              results = await processParallelHebrewSefer(
                pdf,
                2,
                columnMode,
                enhancedCallbacks
              );
            } else {
              results = await processParallel(pdf, 2, callbacks);
            }
            break;
          case "chunked":
            if (columnMode === "auto" || columnMode === "force_columns") {
              results = await processChunkedHebrewSefer(
                pdf,
                5,
                columnMode,
                enhancedCallbacks
              );
            } else {
              results = await processChunked(pdf, 5, callbacks);
            }
            break;
          case "progressive":
            if (columnMode === "auto" || columnMode === "force_columns") {
              results = await processChunkedHebrewSefer(
                pdf,
                3,
                columnMode,
                enhancedCallbacks
              );
            } else {
              results = await processChunked(pdf, 3, callbacks);
            }
            break;
          default:
            if (columnMode === "auto" || columnMode === "force_columns") {
              results = await processChunkedHebrewSefer(
                pdf,
                5,
                columnMode,
                enhancedCallbacks
              );
            } else {
              results = await processChunked(pdf, 5, callbacks);
            }
        }
      }

      finalizeResults(results);
      setProgress(100);

      const totalTime = (Date.now() - startTime) / 1000;
      const successfulPages = results.size;

      // Enhanced tracking with more context
      trackExtraction(fileType, pageCount, totalTime, true);

      // Track additional performance metrics
      trackPerformance("extraction_completed", totalTime, {
        fileType,
        pageCount,
        strategy: processingStrategy,
        columnMode,
        successRate: (successfulPages / pageCount) * 100,
        memoryPeak: memoryUsage,
      });

      // Update session data
      setSessionData((prev) => ({
        ...prev,
        filesProcessed: prev.filesProcessed + 1,
        successfulExtractions: prev.successfulExtractions + 1,
        totalProcessingTime: prev.totalProcessingTime + totalTime,
      }));

      console.log(`Processing completed in ${totalTime.toFixed(1)}s`);
    } catch (err) {
      const totalTime = (Date.now() - startTime) / 1000;

      handleError(err, {
        processingTime: totalTime,
        strategy: processingStrategy,
        columnMode,
        pageCount: pageResults.size || 1,
      });

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

    const success = validateAndSetFile(selectedFile, callbacks);

    if (success) {
      setActionsCount((prev) => prev + 1);

      // Track file characteristics
      trackPerformance("file_selected", selectedFile.size, {
        fileType: selectedFile.type.includes("pdf") ? "pdf" : "image",
        fileName: selectedFile.name,
        lastModified: selectedFile.lastModified,
      });
    }
  };

  const handleCopyToClipboard = async () => {
    const success = await copyToClipboard(extractedText);
    setActionsCount((prev) => prev + 1);

    if (success) {
      alert("Text copied to clipboard");
      trackTextAction("copy", fileType, extractedText.length);

      // Track additional context
      trackPerformance("copy_action", extractedText.length, {
        fileType,
        pageCount: pageResults.size,
        wordCount: extractedText.split(/\s+/).length,
      });
    } else {
      handleError(new Error("Failed to copy to clipboard"), { action: "copy" });
    }
  };

  const handleDownloadText = () => {
    try {
      downloadTextFile(extractedText, file.name);
      setActionsCount((prev) => prev + 1);

      trackTextAction("download", fileType, extractedText.length);

      // Track additional context
      trackPerformance("download_action", extractedText.length, {
        fileType,
        pageCount: pageResults.size,
        fileName: file.name,
        wordCount: extractedText.split(/\s+/).length,
      });
    } catch (err) {
      handleError(err, { action: "download" });
    }
  };

  // NEW: Claude helper functions
  const handleCopyForClaude = async () => {
    if (!extractedText.trim()) {
      setError("No text to copy for Claude translation.");
      return;
    }

    const claudePrompt = `Please translate this Hebrew text to English. This text was extracted using OCR (Optical Character Recognition) from a PDF/image, so there may be some extraction errors.

    Please:
    1. Translate the Hebrew text to English
    2. Use your best judgment to identify and ignore obvious OCR errors (random characters, misplaced numbers, or garbled text that doesn't make sense in Hebrew)
    3. If you encounter questionable characters or sections, try to infer the intended meaning from context
    4. Maintain the original formatting and line breaks where they make sense
    5. If there are sections that appear to be complete OCR gibberish, you can note them as "[unclear text]" in your translation but still show the transaltion anyway just right after the translation show the "[unclear text]" in the translation
    
    Provide a clean, readable English translation:
    
    ${extractedText}`;

    try {
      await navigator.clipboard.writeText(claudePrompt);
      setActionsCount((prev) => prev + 1);

      // Track the Claude copy action
      trackTextAction("copy_for_claude", fileType, extractedText.length);

      // Track additional context
      trackPerformance("claude_copy_action", extractedText.length, {
        fileType,
        pageCount: pageResults.size,
        wordCount: extractedText.split(/\s+/).length,
        promptLength: claudePrompt.length,
      });

      // Also track the Claude opening
      trackPerformance("claude_opened", 1, {
        fileType,
        hasExtractedText: !!extractedText.trim(),
      });

      // Open Claude automatically
      window.open("https://claude.ai/chat", "_blank", "noopener,noreferrer");
    } catch (err) {
      handleError(new Error("Failed to copy text for Claude"), {
        action: "copy_for_claude",
      });
    }
  };
  const handleOpenClaude = () => {
    setActionsCount((prev) => prev + 1);

    // Track Claude opening
    trackPerformance("claude_opened", 1, {
      fileType,
      hasExtractedText: !!extractedText.trim(),
    });

    window.open("https://claude.ai/chat", "_blank", "noopener,noreferrer");
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

        {/* Column Detection Mode */}
        <div style={{ marginBottom: "24px" }}>
          <h3 style={baseStyles.sectionTitle}>
            📖 Hebrew Sefer Layout (Column Detection):
          </h3>
          <select
            value={columnMode}
            onChange={(e) => setColumnMode(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              fontSize: "14px",
              marginBottom: "8px",
            }}
          >
            <option value="auto">
              Auto-Detect Columns (Recommended for Sefarim)
            </option>
            <option value="force_columns">Force Two-Column Processing</option>
            <option value="single">Single Column (Standard OCR)</option>
          </select>
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              backgroundColor: "#f9fafb",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #e5e7eb",
            }}
          >
            <p style={{ margin: "0 0 4px 0", fontWeight: "500" }}>
              📚 <strong>For Traditional Hebrew Sefarim:</strong>
            </p>
            <p style={{ margin: 0 }}>
              • <strong>Auto-Detect</strong>: Automatically detects two-column
              layout in Hebrew books
              <br />• <strong>Force Columns</strong>: Always processes as two
              columns (right first, then left)
              <br />• <strong>Single Column</strong>: Standard OCR processing
              (may mix columns)
            </p>
          </div>
        </div>

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
              {fileType?.toUpperCase()} • Column Mode:{" "}
              {columnMode === "auto"
                ? "Auto-Detect"
                : columnMode === "force_columns"
                ? "Forced Columns"
                : "Single Column"}
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
                ? `Processing image with Hebrew OCR${
                    columnMode !== "single" ? " (with column detection)" : ""
                  }...`
                : `Processing pages with Hebrew OCR${
                    columnMode !== "single" ? " (with column detection)" : ""
                  }... (${processingStats.completedPages}/${
                    processingStats.totalPages
                  } pages completed)`}
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
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div>
                <h3 style={baseStyles.sectionTitle}>
                  Extracted Text{" "}
                  {fileType === "pdf" ? `(${pageResults.size} pages)` : ""}:
                </h3>
                {/* Column Detection Info */}
                {pageResults.size > 0 && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      marginTop: "4px",
                    }}
                  >
                    {(() => {
                      const firstResult = Array.from(pageResults.values())[0];
                      if (
                        firstResult?.columnData &&
                        firstResult.columnData.length > 1
                      ) {
                        return "✅ Columns detected and processed separately (right column first, then left)";
                      } else if (firstResult?.processingMode === "single") {
                        return "📄 Processed as single column";
                      } else if (columnMode === "force_columns") {
                        return "🔧 Forced two-column processing";
                      }
                      return null;
                    })()}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={handleCopyToClipboard}
                  style={{ ...baseStyles.button, backgroundColor: "#6b7280" }}
                >
                  <Copy size={16} />
                  Copy
                </button>
                <button
                  onClick={handleCopyForClaude}
                  style={{ ...baseStyles.button, backgroundColor: "#8b5cf6" }}
                  title="Copy text with translation prompt for Claude AI"
                >
                  <Bot size={16} />
                  Copy for Claude
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

            {/* Claude Helper Section */}
            <div
              style={{
                backgroundColor: "#f3f4f6",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "16px",
                fontSize: "14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <Bot size={16} style={{ color: "#8b5cf6" }} />
                <strong>Need Translation?</strong>
              </div>
              <p style={{ margin: "0 0 8px 0", color: "#6b7280" }}>
                Use Claude AI to translate your Hebrew text to English{" "}
                {(() => {
                  const firstResult = Array.from(pageResults.values())[0];
                  if (
                    firstResult?.columnData &&
                    firstResult.columnData.length > 1
                  ) {
                    return "(columns were processed separately for better accuracy)";
                  }
                  return "";
                })()}
                :
              </p>
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <span style={{ fontSize: "12px", color: "#6b7280" }}>
                  1. Click "Copy for Claude" → 2. Paste & translate
                </span>
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

// import React, { useState, useCallback, useEffect, useRef } from "react";
// import {
//   Upload,
//   FileText,
//   Download,
//   Copy,
//   AlertCircle,
//   BarChart3,
//   Zap,
//   Settings,
//   Camera,
//   ExternalLink,
//   Bot,
// } from "lucide-react";

// // Import utilities
// import { hebrewFonts } from "./utils/constants.js";
// import {
//   trackExtraction,
//   trackTextAction,
//   trackUserEngagement,
//   trackError,
//   trackPerformance,
// } from "./utils/analytics.js";
// import {
//   validateAndSetFile,
//   createDragDropHandlers,
//   getAcceptedFileTypes,
//   downloadTextFile,
// } from "./utils/fileUtils.js";
// import {
//   loadLibraries,
//   forceMemoryCleanup,
//   selectProcessingStrategy,
//   processImageFile,
//   processParallel,
//   processChunked,
// } from "./utils/ocrUtils.js";
// import {
//   loadHebrewFonts,
//   copyToClipboard,
//   updateProgress,
//   createBaseStyles,
// } from "./utils/uiUtils.js";

// const OptimizedHebrewPDFExtractor = () => {
//   // Core state
//   const [file, setFile] = useState(null);
//   const [fileType, setFileType] = useState(null);
//   const [processing, setProcessing] = useState(false);
//   const [extractedText, setExtractedText] = useState("");
//   const [progress, setProgress] = useState(0);
//   const [error, setError] = useState("");
//   const [selectedFont, setSelectedFont] = useState("noto");
//   const [isDragOver, setIsDragOver] = useState(false);

//   // Processing state
//   const [processingStrategy, setProcessingStrategy] = useState("auto");
//   const [memoryUsage, setMemoryUsage] = useState(0);
//   const [pageResults, setPageResults] = useState(new Map());
//   const [processingStats, setProcessingStats] = useState({
//     totalPages: 0,
//     completedPages: 0,
//     averageTimePerPage: 0,
//     estimatedTimeRemaining: 0,
//   });

//   const [sessionStartTime] = useState(Date.now());
//   const [actionsCount, setActionsCount] = useState(0);
//   const [sessionData, setSessionData] = useState({
//     filesProcessed: 0,
//     successfulExtractions: 0,
//     errors: 0,
//     totalProcessingTime: 0,
//   });

//   const [processingComplete, setProcessingComplete] = useState(false);
//   const [intermediateResults, setIntermediateResults] = useState(new Map());

//   const processingStatsRef = useRef({
//     startTime: null,
//     pageStartTimes: new Map(),
//     completedTimes: [],
//   });

//   // Load Hebrew fonts on mount
//   useEffect(() => {
//     loadHebrewFonts();
//   }, []);

//   // Track user engagement on component unmount
//   useEffect(() => {
//     const trackSessionEnd = () => {
//       const sessionDuration = (Date.now() - sessionStartTime) / 1000;

//       trackUserEngagement(sessionDuration, actionsCount);

//       // Track session summary
//       trackPerformance("session_summary", sessionDuration, {
//         filesProcessed: sessionData.filesProcessed,
//         successfulExtractions: sessionData.successfulExtractions,
//         errors: sessionData.errors,
//         totalProcessingTime: sessionData.totalProcessingTime,
//         actionsCount,
//       });
//     };

//     // Track on page unload
//     window.addEventListener("beforeunload", trackSessionEnd);

//     return () => {
//       trackSessionEnd();
//       window.removeEventListener("beforeunload", trackSessionEnd);
//     };
//   }, [sessionStartTime, actionsCount, sessionData]);

//   const handleError = useCallback(
//     (error, context = {}) => {
//       console.error("App Error:", error);
//       setError(error.message);

//       trackError("processing_error", error.message, {
//         fileType,
//         fileName: file?.name,
//         ...context,
//       });

//       setSessionData((prev) => ({ ...prev, errors: prev.errors + 1 }));
//     },
//     [fileType, file]
//   );

//   // Processing statistics helpers
//   const updateProcessingStats = useCallback(
//     (pageNum, isComplete = false) => {
//       const now = Date.now();

//       if (isComplete) {
//         const pageStartTime =
//           processingStatsRef.current.pageStartTimes.get(pageNum);
//         if (pageStartTime) {
//           const pageTime = now - pageStartTime;
//           processingStatsRef.current.completedTimes.push(pageTime);

//           const avgTime =
//             processingStatsRef.current.completedTimes.reduce(
//               (a, b) => a + b,
//               0
//             ) / processingStatsRef.current.completedTimes.length;

//           const remainingPages =
//             processingStats.totalPages - (processingStats.completedPages + 1);
//           const estimatedRemaining = (avgTime * remainingPages) / 1000;

//           setProcessingStats((prev) => {
//             const newCompletedPages = prev.completedPages + 1;
//             updateProgress(newCompletedPages, prev.totalPages, setProgress);

//             return {
//               ...prev,
//               completedPages: newCompletedPages,
//               averageTimePerPage: avgTime / 1000,
//               estimatedTimeRemaining: estimatedRemaining,
//             };
//           });
//         }
//       } else {
//         processingStatsRef.current.pageStartTimes.set(pageNum, now);
//       }
//     },
//     [processingStats.totalPages]
//   );

//   // Store intermediate results without updating UI
//   const storeIntermediateResults = useCallback((results) => {
//     setIntermediateResults(new Map(results));
//     setPageResults(new Map(results));
//   }, []);

//   // Finalize results and update UI
//   const finalizeResults = useCallback(
//     (results) => {
//       const sortedPages = Array.from(results.keys()).sort((a, b) => a - b);
//       const finalText = sortedPages
//         .map((pageNum) => {
//           const result = results.get(pageNum);
//           if (fileType === "image" && results.size === 1) {
//             return result.text;
//           }
//           return `--- Page ${pageNum} ---\n${result.text}\n`;
//         })
//         .join("\n");

//       setExtractedText(finalText);
//       setPageResults(new Map(results));
//       setProcessingComplete(true);
//     },
//     [fileType]
//   );

//   // Main processing function
//   const processFile = async () => {
//     if (!file) return;

//     const startTime = Date.now();
//     setActionsCount((prev) => prev + 1);

//     setProcessing(true);
//     setProgress(0);
//     setError("");
//     setExtractedText("");
//     setMemoryUsage(0);
//     setPageResults(new Map());
//     setIntermediateResults(new Map());
//     setProcessingComplete(false);

//     processingStatsRef.current = {
//       startTime,
//       pageStartTimes: new Map(),
//       completedTimes: [],
//     };

//     try {
//       await loadLibraries(fileType);

//       let results;
//       let pageCount = 1;

//       // Track performance metrics
//       trackPerformance("memory_usage_start", memoryUsage, { fileType });

//       const callbacks = {
//         updateProcessingStats,
//         setMemoryUsage,
//         setProgress,
//         setProcessingStats,
//         storeIntermediateResults,
//         memoryUsage,
//         forceMemoryCleanup: () => forceMemoryCleanup(setMemoryUsage),
//       };

//       if (fileType === "image") {
//         console.log(`Processing image: ${file.name}`);
//         setProgress(10);
//         results = await processImageFile(file, callbacks);
//         pageCount = 1;
//       } else {
//         const arrayBuffer = await file.arrayBuffer();
//         const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
//           .promise;

//         pageCount = pdf.numPages;
//         const fileSizeMB = file.size / (1024 * 1024);

//         setProcessingStats({
//           totalPages: pageCount,
//           completedPages: 0,
//           averageTimePerPage: 0,
//           estimatedTimeRemaining: 0,
//         });

//         setProgress(5);

//         const strategy = selectProcessingStrategy(
//           processingStrategy,
//           pageCount,
//           fileSizeMB
//         );

//         // Track strategy selection
//         trackPerformance("strategy_selected", strategy, {
//           pageCount,
//           fileSizeMB,
//           processingStrategy,
//         });

//         console.log(
//           `Using strategy: ${strategy} for ${pageCount} pages (${fileSizeMB.toFixed(
//             1
//           )}MB)`
//         );

//         switch (strategy) {
//           case "parallel":
//             results = await processParallel(pdf, 3, callbacks);
//             break;
//           case "batch":
//             results = await processParallel(pdf, 2, callbacks);
//             break;
//           case "chunked":
//             results = await processChunked(pdf, 5, callbacks);
//             break;
//           case "progressive":
//             results = await processChunked(pdf, 3, callbacks);
//             break;
//           default:
//             results = await processChunked(pdf, 5, callbacks);
//         }
//       }

//       finalizeResults(results);
//       setProgress(100);

//       const totalTime = (Date.now() - startTime) / 1000;
//       const successfulPages = results.size;

//       // Enhanced tracking with more context
//       trackExtraction(fileType, pageCount, totalTime, true);

//       // Track additional performance metrics
//       trackPerformance("extraction_completed", totalTime, {
//         fileType,
//         pageCount,
//         strategy: processingStrategy,
//         successRate: (successfulPages / pageCount) * 100,
//         memoryPeak: memoryUsage,
//       });

//       // Update session data
//       setSessionData((prev) => ({
//         ...prev,
//         filesProcessed: prev.filesProcessed + 1,
//         successfulExtractions: prev.successfulExtractions + 1,
//         totalProcessingTime: prev.totalProcessingTime + totalTime,
//       }));

//       console.log(`Processing completed in ${totalTime.toFixed(1)}s`);
//     } catch (err) {
//       const totalTime = (Date.now() - startTime) / 1000;

//       handleError(err, {
//         processingTime: totalTime,
//         strategy: processingStrategy,
//         pageCount: pageResults.size || 1,
//       });

//       trackExtraction(fileType, pageResults.size || 1, totalTime, false);
//     } finally {
//       setProcessing(false);
//       await forceMemoryCleanup(setMemoryUsage);
//     }
//   };

//   // Event handlers
//   const handleFileUpload = (event) => {
//     const selectedFile = event.target.files[0];
//     const callbacks = {
//       setFile,
//       setFileType,
//       setError,
//       setExtractedText,
//       setPageResults,
//       setIntermediateResults,
//       setProcessingComplete,
//     };
//     validateAndSetFile(selectedFile, callbacks);
//   };

//   const handleFileSelect = (selectedFile) => {
//     const callbacks = {
//       setFile,
//       setFileType,
//       setError,
//       setExtractedText,
//       setPageResults,
//       setIntermediateResults,
//       setProcessingComplete,
//     };

//     const success = validateAndSetFile(selectedFile, callbacks);

//     if (success) {
//       setActionsCount((prev) => prev + 1);

//       // Track file characteristics
//       trackPerformance("file_selected", selectedFile.size, {
//         fileType: selectedFile.type.includes("pdf") ? "pdf" : "image",
//         fileName: selectedFile.name,
//         lastModified: selectedFile.lastModified,
//       });
//     }
//   };

//   const handleCopyToClipboard = async () => {
//     const success = await copyToClipboard(extractedText);
//     setActionsCount((prev) => prev + 1);

//     if (success) {
//       alert("Text copied to clipboard");
//       trackTextAction("copy", fileType, extractedText.length);

//       // Track additional context
//       trackPerformance("copy_action", extractedText.length, {
//         fileType,
//         pageCount: pageResults.size,
//         wordCount: extractedText.split(/\s+/).length,
//       });
//     } else {
//       handleError(new Error("Failed to copy to clipboard"), { action: "copy" });
//     }
//   };

//   const handleDownloadText = () => {
//     try {
//       downloadTextFile(extractedText, file.name);
//       setActionsCount((prev) => prev + 1);

//       trackTextAction("download", fileType, extractedText.length);

//       // Track additional context
//       trackPerformance("download_action", extractedText.length, {
//         fileType,
//         pageCount: pageResults.size,
//         fileName: file.name,
//         wordCount: extractedText.split(/\s+/).length,
//       });
//     } catch (err) {
//       handleError(err, { action: "download" });
//     }
//   };

//   // NEW: Claude helper functions
//   const handleCopyForClaude = async () => {
//     if (!extractedText.trim()) {
//       setError("No text to copy for Claude translation.");
//       return;
//     }

//     const claudePrompt = `Please translate this Hebrew text to English. This text was extracted using OCR (Optical Character Recognition) from a PDF/image, so there may be some extraction errors.

//     Please:
//     1. Translate the Hebrew text to English
//     2. Use your best judgment to identify and ignore obvious OCR errors (random characters, misplaced numbers, or garbled text that doesn't make sense in Hebrew)
//     3. If you encounter questionable characters or sections, try to infer the intended meaning from context
//     4. Maintain the original formatting and line breaks where they make sense
//     5. If there are sections that appear to be complete OCR gibberish, you can note them as "[unclear text]" in your translation but still show the transaltion anyway just right after the translation show the "[unclear text]" in the translation

//     Provide a clean, readable English translation:

//     ${extractedText}`;

//     try {
//       await navigator.clipboard.writeText(claudePrompt);
//       setActionsCount((prev) => prev + 1);

//       // Track the Claude copy action
//       trackTextAction("copy_for_claude", fileType, extractedText.length);

//       // Track additional context
//       trackPerformance("claude_copy_action", extractedText.length, {
//         fileType,
//         pageCount: pageResults.size,
//         wordCount: extractedText.split(/\s+/).length,
//         promptLength: claudePrompt.length,
//       });

//       // Also track the Claude opening
//       trackPerformance("claude_opened", 1, {
//         fileType,
//         hasExtractedText: !!extractedText.trim(),
//       });

//       // Open Claude automatically
//       window.open("https://claude.ai/chat", "_blank", "noopener,noreferrer");
//     } catch (err) {
//       handleError(new Error("Failed to copy text for Claude"), {
//         action: "copy_for_claude",
//       });
//     }
//   };
//   const handleOpenClaude = () => {
//     setActionsCount((prev) => prev + 1);

//     // Track Claude opening
//     trackPerformance("claude_opened", 1, {
//       fileType,
//       hasExtractedText: !!extractedText.trim(),
//     });

//     window.open("https://claude.ai/chat", "_blank", "noopener,noreferrer");
//   };

//   // Create drag and drop handlers
//   const dragDropHandlers = createDragDropHandlers(
//     setIsDragOver,
//     handleFileSelect
//   );

//   // Create styles
//   const baseStyles = createBaseStyles(isDragOver, selectedFont, hebrewFonts);

//   return (
//     <div style={baseStyles.container}>
//       <div style={baseStyles.card}>
//         <h1 style={baseStyles.title}>
//           <Zap size={28} style={{ display: "inline", marginRight: "8px" }} />
//           Hebrew Text Extractor
//         </h1>
//         <p style={baseStyles.subtitle}>
//           Convert Hebrew PDFs and images to editable text • Advanced OCR
//           processing • Memory optimization • Multiple formats supported
//         </p>

//         {/* Strategy Selection - Only show for PDFs */}
//         {(!file || fileType === "pdf") && (
//           <div style={{ marginBottom: "24px" }}>
//             <h3 style={baseStyles.sectionTitle}>
//               <Settings
//                 size={20}
//                 style={{ display: "inline", marginRight: "8px" }}
//               />
//               Processing Strategy (for PDFs):
//             </h3>
//             <select
//               value={processingStrategy}
//               onChange={(e) => setProcessingStrategy(e.target.value)}
//               style={{
//                 width: "100%",
//                 padding: "8px 12px",
//                 border: "1px solid #d1d5db",
//                 borderRadius: "6px",
//                 fontSize: "14px",
//                 marginBottom: "8px",
//               }}
//             >
//               <option value="auto">Auto-Select (Recommended)</option>
//               <option value="parallel">Parallel (Fast, 1-10 pages)</option>
//               <option value="batch">Batch (Balanced, 5-20 pages)</option>
//               <option value="chunked">
//                 Chunked (Memory efficient, 20+ pages)
//               </option>
//               <option value="progressive">
//                 Progressive (Large files, 50+ pages)
//               </option>
//             </select>
//             <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
//               Auto-select chooses the best strategy based on file size and page
//               count. Images are processed directly.
//             </p>
//           </div>
//         )}

//         {/* File Upload */}
//         <div style={{ marginBottom: "24px" }}>
//           <div
//             onDragEnter={dragDropHandlers.handleDragEnter}
//             onDragLeave={dragDropHandlers.handleDragLeave}
//             onDragOver={dragDropHandlers.handleDragOver}
//             onDrop={dragDropHandlers.handleDrop}
//             style={baseStyles.dropzone}
//           >
//             <div
//               style={{
//                 display: "flex",
//                 flexDirection: "column",
//                 alignItems: "center",
//                 gap: "16px",
//               }}
//             >
//               <div style={{ display: "flex", gap: "16px" }}>
//                 <Upload
//                   size={48}
//                   style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
//                 />
//                 <Camera
//                   size={48}
//                   style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
//                 />
//               </div>
//               <input
//                 type="file"
//                 accept={getAcceptedFileTypes()}
//                 onChange={handleFileUpload}
//                 style={{ display: "none" }}
//                 id="file-upload"
//               />
//               <label htmlFor="file-upload" style={baseStyles.button}>
//                 Choose PDF or Image File
//               </label>
//               <p style={{ color: "#6b7280", margin: 0 }}>
//                 {isDragOver
//                   ? "Drop your file here!"
//                   : "Or drag and drop a PDF or image file here"}
//               </p>
//               <p style={{ color: "#6b7280", fontSize: "12px", margin: 0 }}>
//                 Supported: PDF, JPG, PNG, WebP, BMP, TIFF, GIF
//               </p>
//               {file && (
//                 <div style={{ textAlign: "center" }}>
//                   <p style={{ color: "#059669", fontWeight: "500", margin: 0 }}>
//                     Selected: {file.name} ({fileType?.toUpperCase()})
//                   </p>
//                   <p
//                     style={{
//                       color: "#6b7280",
//                       fontSize: "12px",
//                       margin: "4px 0 0 0",
//                     }}
//                   >
//                     Size: {(file.size / (1024 * 1024)).toFixed(1)} MB
//                   </p>
//                 </div>
//               )}
//             </div>
//           </div>
//         </div>

//         {/* Process Button */}
//         {file && (
//           <div style={{ marginBottom: "24px", textAlign: "center" }}>
//             <button
//               onClick={processFile}
//               disabled={processing}
//               style={{
//                 ...baseStyles.button,
//                 backgroundColor: processing ? "#9ca3af" : "#3b82f6",
//                 cursor: processing ? "not-allowed" : "pointer",
//                 margin: "0 auto",
//               }}
//             >
//               <FileText size={20} />
//               Extract Hebrew Text
//             </button>
//           </div>
//         )}

//         {/* Processing Statistics */}
//         {processing && (
//           <div style={baseStyles.statsCard}>
//             <div
//               style={{
//                 display: "flex",
//                 alignItems: "center",
//                 marginBottom: "12px",
//               }}
//             >
//               <BarChart3 size={20} style={{ marginRight: "8px" }} />
//               <h3 style={{ ...baseStyles.sectionTitle, margin: 0 }}>
//                 Processing Statistics
//               </h3>
//             </div>
//             <div
//               style={{
//                 display: "grid",
//                 gridTemplateColumns: "1fr 1fr 1fr",
//                 gap: "16px",
//                 fontSize: "14px",
//               }}
//             >
//               <div>
//                 <strong>Progress:</strong> {processingStats.completedPages}/
//                 {processingStats.totalPages}{" "}
//                 {fileType === "image" ? "image" : "pages"}
//               </div>
//             </div>
//             <div
//               style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}
//             >
//               Memory Usage: {memoryUsage.toFixed(0)} MB • Type:{" "}
//               {fileType?.toUpperCase()}
//               {fileType === "pdf" && (
//                 <>
//                   {" "}
//                   • Strategy:{" "}
//                   {processingStrategy === "auto"
//                     ? "Auto-selected"
//                     : processingStrategy}
//                 </>
//               )}
//             </div>
//           </div>
//         )}

//         {/* Progress Bar */}
//         {processing && (
//           <div style={{ marginBottom: "24px" }}>
//             <div
//               style={{
//                 width: "100%",
//                 height: "8px",
//                 backgroundColor: "#e5e7eb",
//                 borderRadius: "4px",
//                 overflow: "hidden",
//               }}
//             >
//               <div
//                 style={{
//                   width: `${progress}%`,
//                   height: "100%",
//                   backgroundColor: "#3b82f6",
//                   transition: "width 0.3s ease",
//                 }}
//               />
//             </div>
//             <p
//               style={{
//                 fontSize: "14px",
//                 color: "#6b7280",
//                 marginTop: "8px",
//                 textAlign: "center",
//               }}
//             >
//               {processingStats.completedPages === 0
//                 ? "Initializing..."
//                 : processingStats.completedPages === processingStats.totalPages
//                 ? "Finalizing results..."
//                 : fileType === "image"
//                 ? "Processing image with Hebrew OCR..."
//                 : `Processing pages with Hebrew OCR... (${processingStats.completedPages}/${processingStats.totalPages} pages completed)`}
//             </p>
//           </div>
//         )}

//         {/* Error Display */}
//         {error && (
//           <div
//             style={{
//               backgroundColor: "#fef2f2",
//               border: "1px solid #fecaca",
//               borderRadius: "8px",
//               padding: "12px",
//               marginBottom: "24px",
//               display: "flex",
//               alignItems: "center",
//               gap: "8px",
//             }}
//           >
//             <AlertCircle size={20} style={{ color: "#dc2626" }} />
//             <span style={{ color: "#dc2626" }}>{error}</span>
//           </div>
//         )}

//         {/* Results - Only show when processing is completely finished */}
//         {!processing && processingComplete && extractedText && (
//           <div style={{ marginBottom: "24px" }}>
//             <div
//               style={{
//                 display: "flex",
//                 justifyContent: "space-between",
//                 alignItems: "center",
//                 marginBottom: "16px",
//                 flexWrap: "wrap",
//                 gap: "8px",
//               }}
//             >
//               <h3 style={baseStyles.sectionTitle}>
//                 Extracted Text{" "}
//                 {fileType === "pdf" ? `(${pageResults.size} pages)` : ""}:
//               </h3>
//               <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
//                 <button
//                   onClick={handleCopyToClipboard}
//                   style={{ ...baseStyles.button, backgroundColor: "#6b7280" }}
//                 >
//                   <Copy size={16} />
//                   Copy
//                 </button>
//                 <button
//                   onClick={handleCopyForClaude}
//                   style={{ ...baseStyles.button, backgroundColor: "#8b5cf6" }}
//                   title="Copy text with translation prompt for Claude AI"
//                 >
//                   <Bot size={16} />
//                   Copy for Claude
//                 </button>
//                 <button
//                   onClick={handleDownloadText}
//                   style={{ ...baseStyles.button, backgroundColor: "#3b82f6" }}
//                 >
//                   <Download size={16} />
//                   Download
//                 </button>
//               </div>
//             </div>

//             {/* Claude Helper Section */}
//             <div
//               style={{
//                 backgroundColor: "#f3f4f6",
//                 border: "1px solid #e5e7eb",
//                 borderRadius: "8px",
//                 padding: "12px",
//                 marginBottom: "16px",
//                 fontSize: "14px",
//               }}
//             >
//               <div
//                 style={{
//                   display: "flex",
//                   alignItems: "center",
//                   gap: "8px",
//                   marginBottom: "8px",
//                 }}
//               >
//                 <Bot size={16} style={{ color: "#8b5cf6" }} />
//                 <strong>Need Translation?</strong>
//               </div>
//               <p style={{ margin: "0 0 8px 0", color: "#6b7280" }}>
//                 Use Claude AI to translate your Hebrew text to English:
//               </p>
//               <div
//                 style={{ display: "flex", gap: "8px", alignItems: "center" }}
//               >
//                 <span style={{ fontSize: "12px", color: "#6b7280" }}>
//                   1. Click "Copy for Claude" → 2. Paste & translate
//                 </span>
//               </div>
//             </div>

//             {/* Font Selector */}
//             <div style={{ marginBottom: "16px" }}>
//               <label
//                 style={{
//                   display: "block",
//                   fontSize: "14px",
//                   fontWeight: "500",
//                   color: "#374151",
//                   marginBottom: "4px",
//                 }}
//               >
//                 Choose Hebrew Font:
//               </label>
//               <select
//                 value={selectedFont}
//                 onChange={(e) => setSelectedFont(e.target.value)}
//                 style={{
//                   width: "100%",
//                   padding: "8px 12px",
//                   border: "1px solid #d1d5db",
//                   borderRadius: "6px",
//                   fontSize: "14px",
//                 }}
//               >
//                 {Object.entries(hebrewFonts).map(([key, font]) => (
//                   <option key={key} value={key}>
//                     {font.name}
//                   </option>
//                 ))}
//               </select>
//             </div>

//             <textarea
//               value={extractedText}
//               readOnly
//               style={baseStyles.textarea}
//             />
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default OptimizedHebrewPDFExtractor;
