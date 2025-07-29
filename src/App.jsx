import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload,
  FileText,
  Download,
  Copy,
  Loader2,
  AlertCircle,
  BarChart3,
  Zap,
  Settings,
  Camera,
} from "lucide-react";

const OptimizedHebrewPDFExtractor = () => {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [selectedFont, setSelectedFont] = useState("noto");
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileType, setFileType] = useState(null); // 'pdf' or 'image'

  // Advanced state for optimizations
  const [processingStrategy, setProcessingStrategy] = useState("auto");
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [pageResults, setPageResults] = useState(new Map());
  const [processingStats, setProcessingStats] = useState({
    totalPages: 0,
    completedPages: 0,
    averageTimePerPage: 0,
    estimatedTimeRemaining: 0,
  });

  // Add state to track if processing is completely finished
  const [processingComplete, setProcessingComplete] = useState(false);

  // Store intermediate results separately from final results
  const [intermediateResults, setIntermediateResults] = useState(new Map());

  const processingStatsRef = useRef({
    startTime: null,
    pageStartTimes: new Map(),
    completedTimes: [],
  });

  // Supported file types
  const supportedImageTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
    "image/gif",
  ];

  // Font options for Hebrew text
  const hebrewFonts = {
    noto: {
      name: "Noto Sans Hebrew (Clean)",
      fontFamily:
        "'Noto Sans Hebrew', 'Arial Hebrew', 'Times New Roman', sans-serif",
    },
    frank: {
      name: "Frank Ruhl Libre (Traditional)",
      fontFamily:
        "'Frank Ruhl Libre', 'Times New Roman Hebrew', 'Arial Hebrew', serif",
    },
    rubik: {
      name: "Rubik (Modern)",
      fontFamily: "'Rubik', 'Arial Hebrew', 'Helvetica Neue', sans-serif",
    },
    heebo: {
      name: "Heebo (Readable)",
      fontFamily: "'Heebo', 'Arial Hebrew', 'Segoe UI', sans-serif",
    },
    system: {
      name: "System Hebrew (Default)",
      fontFamily: "'Arial Hebrew', 'David', 'Times New Roman', sans-serif",
    },
  };

  // Load Hebrew fonts
  useEffect(() => {
    const loadHebrewFonts = () => {
      const link = document.createElement("link");
      link.href =
        "https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Frank+Ruhl+Libre:wght@400;700&family=Rubik:wght@400;700&family=Heebo:wght@400;700&display=swap";
      link.rel = "stylesheet";

      const existingLink = document.querySelector(`link[href="${link.href}"]`);
      if (!existingLink) {
        document.head.appendChild(link);
      }
    };

    loadHebrewFonts();
  }, []);

  // Load required libraries
  const loadLibraries = useCallback(async () => {
    if (!window.Tesseract) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
    }

    // Only load PDF.js if we're processing a PDF
    if (fileType === "pdf" && !window.pdfjsLib) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
  }, [fileType]);

  // Memory management utilities
  const estimateMemoryUsage = (canvas) => {
    return (canvas.width * canvas.height * 4) / (1024 * 1024); // MB
  };

  const forceMemoryCleanup = async () => {
    if (window.gc) {
      window.gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    setMemoryUsage((prev) => prev * 0.7);
  };

  // Adaptive scaling based on page size and complexity
  const getOptimalScale = (viewport, pageComplexity = "medium") => {
    const area = viewport.width * viewport.height;
    const baseScale = area > 2000000 ? 1.2 : area > 1000000 ? 1.5 : 2.0;

    // Adjust for complexity and strategy
    const complexityMultiplier =
      pageComplexity === "high" ? 1.2 : pageComplexity === "low" ? 0.8 : 1.0;
    return Math.min(baseScale * complexityMultiplier, 2.5);
  };

  // Hebrew-specific image preprocessing
  const preprocessForHebrewOCR = (canvas, context) => {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Enhanced preprocessing for Hebrew text
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

      // Enhanced binarization with Hebrew text optimization
      const threshold = 128;
      const enhancedGray = gray < threshold ? 0 : 255;

      // Apply contrast enhancement
      const contrast = 1.3;
      const brightness = 10;
      const enhanced = Math.min(
        255,
        Math.max(0, enhancedGray * contrast + brightness)
      );

      data[i] = enhanced; // Red
      data[i + 1] = enhanced; // Green
      data[i + 2] = enhanced; // Blue
    }

    context.putImageData(imageData, 0, 0);

    // Use WebP for better compression if supported
    const format = "image/webp";
    const quality = 0.85;
    return canvas.toDataURL(format, quality);
  };

  // Load image to canvas
  const loadImageToCanvas = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        // Set canvas dimensions to image dimensions
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // Draw image to canvas
        context.drawImage(img, 0, 0);

        resolve({
          canvas,
          context,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  // Strategy selection based on file characteristics
  const selectProcessingStrategy = (pageCount, fileSizeMB) => {
    if (processingStrategy !== "auto") return processingStrategy;

    if (pageCount <= 5) return "parallel";
    if (pageCount <= 15) return "batch";
    if (pageCount <= 50) return "chunked";
    return "progressive";
  };

  // Simple page-based progress calculation
  const updateProgress = (completedPages, totalPages) => {
    if (totalPages === 0) return;

    const progressPercentage = (completedPages / totalPages) * 100;
    setProgress(Math.min(100, progressPercentage));
  };

  // Update processing statistics
  const updateProcessingStats = (pageNum, isComplete = false) => {
    const now = Date.now();

    if (isComplete) {
      const pageStartTime =
        processingStatsRef.current.pageStartTimes.get(pageNum);
      if (pageStartTime) {
        const pageTime = now - pageStartTime;
        processingStatsRef.current.completedTimes.push(pageTime);

        const avgTime =
          processingStatsRef.current.completedTimes.reduce((a, b) => a + b, 0) /
          processingStatsRef.current.completedTimes.length;

        const remainingPages =
          processingStats.totalPages - (processingStats.completedPages + 1);
        const estimatedRemaining = (avgTime * remainingPages) / 1000; // seconds

        setProcessingStats((prev) => {
          const newCompletedPages = prev.completedPages + 1;

          // Update progress based on completed pages
          updateProgress(newCompletedPages, prev.totalPages);

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
  };

  // Process a single image file
  const processImageFile = async () => {
    setProcessingStats({
      totalPages: 1,
      completedPages: 0,
      averageTimePerPage: 0,
      estimatedTimeRemaining: 0,
    });

    updateProcessingStats(1, false);

    try {
      const { canvas, context } = await loadImageToCanvas(file);

      // Track memory usage
      const memUsage = estimateMemoryUsage(canvas);
      setMemoryUsage(memUsage);

      // Hebrew-specific preprocessing
      const optimizedImage = preprocessForHebrewOCR(canvas, context);

      // OCR with progress tracking
      const result = await window.Tesseract.recognize(optimizedImage, "heb", {
        logger: (m) => {
          if (m.status === "recognizing text" && m.progress) {
            // Update progress for single image
            setProgress(m.progress * 90); // Leave 10% for finalization
          }
        },
      });

      // Cleanup
      canvas.remove();
      setMemoryUsage(0);

      updateProcessingStats(1, true);

      return new Map([
        [
          1,
          {
            pageNum: 1,
            text: result.data.text,
            confidence: result.data.confidence,
          },
        ],
      ]);
    } catch (error) {
      console.error("Error processing image:", error);
      updateProcessingStats(1, true);
      return new Map([
        [
          1,
          {
            pageNum: 1,
            text: `[Error processing image: ${error.message}]`,
            confidence: 0,
          },
        ],
      ]);
    }
  };

  // Single page processing with optimizations (for PDFs)
  const processSinglePage = async (pdf, pageNum, strategy = "default") => {
    updateProcessingStats(pageNum, false);

    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });

      // Adaptive scaling
      const optimalScale = getOptimalScale(viewport);
      const scaledViewport = page.getViewport({ scale: optimalScale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      // Track memory usage
      const memUsage = estimateMemoryUsage(canvas);
      setMemoryUsage((prev) => prev + memUsage);

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      }).promise;

      // Hebrew-specific preprocessing
      const optimizedImage = preprocessForHebrewOCR(canvas, context);

      // OCR with simplified progress tracking
      const result = await window.Tesseract.recognize(optimizedImage, "heb", {
        logger: (m) => {
          // Optional: log OCR progress without updating main progress bar
          if (m.status === "recognizing text" && m.progress) {
            console.log(
              `Page ${pageNum} OCR progress: ${(m.progress * 100).toFixed(1)}%`
            );
          }
        },
      });

      // Cleanup
      page.cleanup();
      canvas.remove();
      setMemoryUsage((prev) => prev - memUsage);

      updateProcessingStats(pageNum, true);

      return {
        pageNum,
        text: result.data.text,
        confidence: result.data.confidence,
      };
    } catch (error) {
      console.error(`Error processing page ${pageNum}:`, error);
      updateProcessingStats(pageNum, true);
      return {
        pageNum,
        text: `[Error processing page ${pageNum}: ${error.message}]`,
        confidence: 0,
      };
    }
  };

  // Store intermediate results without updating UI
  const storeIntermediateResults = (results) => {
    setIntermediateResults(new Map(results));
    setPageResults(new Map(results));
  };

  // Parallel processing strategy
  const processParallel = async (pdf, maxConcurrency = 3) => {
    const results = new Map();
    const semaphore = Array(maxConcurrency)
      .fill()
      .map(() => Promise.resolve());
    let semIndex = 0;

    const processPage = async (pageNum) => {
      await semaphore[semIndex];
      semaphore[semIndex] = processSinglePage(pdf, pageNum, "parallel");
      const result = await semaphore[semIndex];
      results.set(pageNum, result);

      // Store intermediate results without showing final UI
      storeIntermediateResults(results);

      semIndex = (semIndex + 1) % maxConcurrency;
    };

    const promises = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      promises.push(processPage(i));
    }

    await Promise.all(promises);
    return results;
  };

  // Chunked processing for large files
  const processChunked = async (pdf, chunkSize = 5) => {
    const results = new Map();
    const totalPages = pdf.numPages;

    for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
      const endPage = Math.min(startPage + chunkSize - 1, totalPages);

      console.log(`Processing chunk: pages ${startPage}-${endPage}`);

      // Check memory usage
      if (memoryUsage > 800) {
        console.log("Memory cleanup triggered...");
        await forceMemoryCleanup();
      }

      // Process chunk in parallel
      const chunkPromises = [];
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        chunkPromises.push(processSinglePage(pdf, pageNum, "chunked"));
      }

      try {
        const chunkResults = await Promise.all(chunkPromises);
        chunkResults.forEach((result) => {
          results.set(result.pageNum, result);
        });

        // Store intermediate results without showing final UI
        storeIntermediateResults(results);

        // Save intermediate results every 20 pages
        if (startPage % 20 === 1 && results.size > 0) {
          console.log(`Saved intermediate results: ${results.size} pages`);
        }
      } catch (error) {
        console.error(`Chunk ${startPage}-${endPage} failed:`, error);
      }
    }

    return results;
  };

  // Finalize results and update UI - only called when processing is complete
  const finalizeResults = (results) => {
    const sortedPages = Array.from(results.keys()).sort((a, b) => a - b);
    const finalText = sortedPages
      .map((pageNum) => {
        const result = results.get(pageNum);
        // For single images, don't add page headers
        if (fileType === "image" && results.size === 1) {
          return result.text;
        }
        return `--- Page ${pageNum} ---\n${result.text}\n`;
      })
      .join("\n");

    setExtractedText(finalText);
    setPageResults(new Map(results));
    setProcessingComplete(true);
  };

  // Main processing function with strategy selection
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

    // Initialize stats
    processingStatsRef.current = {
      startTime: Date.now(),
      pageStartTimes: new Map(),
      completedTimes: [],
    };

    try {
      await loadLibraries();

      let results;

      if (fileType === "image") {
        // Process single image
        console.log(`Processing image: ${file.name}`);
        setProgress(10);
        results = await processImageFile();
      } else {
        // Process PDF
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
          .promise;

        const pageCount = pdf.numPages;
        const fileSizeMB = file.size / (1024 * 1024);

        setProcessingStats({
          totalPages: pageCount,
          completedPages: 0,
          averageTimePerPage: 0,
          estimatedTimeRemaining: 0,
        });

        setProgress(5);

        // Select optimal processing strategy
        const strategy = selectProcessingStrategy(pageCount, fileSizeMB);
        console.log(
          `Using strategy: ${strategy} for ${pageCount} pages (${fileSizeMB.toFixed(
            1
          )}MB)`
        );

        switch (strategy) {
          case "parallel":
            results = await processParallel(pdf, 3);
            break;
          case "batch":
            results = await processParallel(pdf, 2);
            break;
          case "chunked":
            results = await processChunked(pdf, 5);
            break;
          case "progressive":
            results = await processChunked(pdf, 3);
            break;
          default:
            results = await processChunked(pdf, 5);
        }
      }

      // Finalize results - this will show the extracted text section
      finalizeResults(results);
      setProgress(100);

      // Final statistics
      const totalTime =
        (Date.now() - processingStatsRef.current.startTime) / 1000;
      console.log(`Processing completed in ${totalTime.toFixed(1)}s`);
    } catch (err) {
      setError(`Error processing file: ${err.message}`);
      console.error("Processing error:", err);
    } finally {
      setProcessing(false);
      await forceMemoryCleanup();
    }
  };

  const validateAndSetFile = (selectedFile) => {
    if (!selectedFile) {
      setError("Please select a file");
      return false;
    }

    const isPdf = selectedFile.type === "application/pdf";
    const isImage = supportedImageTypes.includes(selectedFile.type);

    if (isPdf || isImage) {
      setFile(selectedFile);
      setFileType(isPdf ? "pdf" : "image");
      setError("");
      setExtractedText("");
      setPageResults(new Map());
      setIntermediateResults(new Map());
      setProcessingComplete(false);
      return true;
    } else {
      setError(
        "Please select a valid PDF file or image (JPG, PNG, WebP, BMP, TIFF, GIF)"
      );
      return false;
    }
  };

  const handleFileUpload = (event) => {
    const selectedFile = event.target.files[0];
    validateAndSetFile(selectedFile);
  };

  // Drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(extractedText).then(() => {
      alert("Text copied to clipboard");
    });
  };

  const downloadText = () => {
    const blob = new Blob([extractedText], {
      type: "text/plain; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
    a.download = `${fileName}_extracted_text.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  };

  const getAcceptedFileTypes = () => {
    return (
      ".pdf," +
      supportedImageTypes
        .map((type) => {
          switch (type) {
            case "image/jpeg":
              return ".jpg,.jpeg";
            case "image/png":
              return ".png";
            case "image/webp":
              return ".webp";
            case "image/bmp":
              return ".bmp";
            case "image/tiff":
              return ".tiff,.tif";
            case "image/gif":
              return ".gif";
            default:
              return "";
          }
        })
        .join(",")
    );
  };

  const baseStyles = {
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
      width: "100%",
      height: "400px",
      padding: "16px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "16px",
      lineHeight: "1.6",
      fontFamily: hebrewFonts[selectedFont].fontFamily,
      direction: "rtl",
      resize: "vertical",
      backgroundColor: "#ffffff",
    },
    statsCard: {
      backgroundColor: "#f3f4f6",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "16px",
    },
  };

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
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
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
              <>
                <FileText size={20} />
                Extract Hebrew Text
              </>
            </button>
          </div>
        )}

        {/* Processing Statistics - Show current progress while processing */}
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
                  onClick={copyToClipboard}
                  style={{
                    ...baseStyles.button,
                    backgroundColor: "#6b7280",
                  }}
                >
                  <Copy size={16} />
                  Copy
                </button>
                <button
                  onClick={downloadText}
                  style={{
                    ...baseStyles.button,
                    backgroundColor: "#3b82f6",
                  }}
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

// GOOD CODE

// import React, { useState, useCallback, useEffect, useRef } from "react";
// import {
//   Upload,
//   FileText,
//   Download,
//   Copy,
//   Loader2,
//   AlertCircle,
//   BarChart3,
//   Zap,
//   Settings,
// } from "lucide-react";

// const OptimizedHebrewPDFExtractor = () => {
//   const [file, setFile] = useState(null);
//   const [processing, setProcessing] = useState(false);
//   const [extractedText, setExtractedText] = useState("");
//   const [progress, setProgress] = useState(0);
//   const [error, setError] = useState("");
//   const [selectedFont, setSelectedFont] = useState("noto");
//   const [isDragOver, setIsDragOver] = useState(false);

//   // Advanced state for optimizations
//   const [processingStrategy, setProcessingStrategy] = useState("auto");
//   const [memoryUsage, setMemoryUsage] = useState(0);
//   const [pageResults, setPageResults] = useState(new Map());
//   const [processingStats, setProcessingStats] = useState({
//     totalPages: 0,
//     completedPages: 0,
//     averageTimePerPage: 0,
//     estimatedTimeRemaining: 0,
//   });

//   // Add state to track if processing is completely finished
//   const [processingComplete, setProcessingComplete] = useState(false);

//   // Store intermediate results separately from final results
//   const [intermediateResults, setIntermediateResults] = useState(new Map());

//   const processingStatsRef = useRef({
//     startTime: null,
//     pageStartTimes: new Map(),
//     completedTimes: [],
//   });

//   // Font options for Hebrew text
//   const hebrewFonts = {
//     noto: {
//       name: "Noto Sans Hebrew (Clean)",
//       fontFamily:
//         "'Noto Sans Hebrew', 'Arial Hebrew', 'Times New Roman', sans-serif",
//     },
//     frank: {
//       name: "Frank Ruhl Libre (Traditional)",
//       fontFamily:
//         "'Frank Ruhl Libre', 'Times New Roman Hebrew', 'Arial Hebrew', serif",
//     },
//     rubik: {
//       name: "Rubik (Modern)",
//       fontFamily: "'Rubik', 'Arial Hebrew', 'Helvetica Neue', sans-serif",
//     },
//     heebo: {
//       name: "Heebo (Readable)",
//       fontFamily: "'Heebo', 'Arial Hebrew', 'Segoe UI', sans-serif",
//     },
//     system: {
//       name: "System Hebrew (Default)",
//       fontFamily: "'Arial Hebrew', 'David', 'Times New Roman', sans-serif",
//     },
//   };

//   // Load Hebrew fonts
//   useEffect(() => {
//     const loadHebrewFonts = () => {
//       const link = document.createElement("link");
//       link.href =
//         "https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Frank+Ruhl+Libre:wght@400;700&family=Rubik:wght@400;700&family=Heebo:wght@400;700&display=swap";
//       link.rel = "stylesheet";

//       const existingLink = document.querySelector(`link[href="${link.href}"]`);
//       if (!existingLink) {
//         document.head.appendChild(link);
//       }
//     };

//     loadHebrewFonts();
//   }, []);

//   // Load required libraries
//   const loadLibraries = useCallback(async () => {
//     if (!window.Tesseract) {
//       const script = document.createElement("script");
//       script.src =
//         "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
//       document.head.appendChild(script);
//       await new Promise((resolve) => (script.onload = resolve));
//     }

//     if (!window.pdfjsLib) {
//       const script = document.createElement("script");
//       script.src =
//         "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
//       document.head.appendChild(script);
//       await new Promise((resolve) => (script.onload = resolve));
//       window.pdfjsLib.GlobalWorkerOptions.workerSrc =
//         "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
//     }
//   }, []);

//   // Memory management utilities
//   const estimateMemoryUsage = (canvas) => {
//     return (canvas.width * canvas.height * 4) / (1024 * 1024); // MB
//   };

//   const forceMemoryCleanup = async () => {
//     if (window.gc) {
//       window.gc();
//     }
//     await new Promise((resolve) => setTimeout(resolve, 100));
//     setMemoryUsage((prev) => prev * 0.7);
//   };

//   // Adaptive scaling based on page size and complexity
//   const getOptimalScale = (viewport, pageComplexity = "medium") => {
//     const area = viewport.width * viewport.height;
//     const baseScale = area > 2000000 ? 1.2 : area > 1000000 ? 1.5 : 2.0;

//     // Adjust for complexity and strategy
//     const complexityMultiplier =
//       pageComplexity === "high" ? 1.2 : pageComplexity === "low" ? 0.8 : 1.0;
//     return Math.min(baseScale * complexityMultiplier, 2.5);
//   };

//   // Hebrew-specific image preprocessing
//   const preprocessForHebrewOCR = (canvas, context) => {
//     const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
//     const data = imageData.data;

//     // Enhanced preprocessing for Hebrew text
//     for (let i = 0; i < data.length; i += 4) {
//       const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

//       // Enhanced binarization with Hebrew text optimization
//       const threshold = 128;
//       const enhancedGray = gray < threshold ? 0 : 255;

//       // Apply contrast enhancement
//       const contrast = 1.3;
//       const brightness = 10;
//       const enhanced = Math.min(
//         255,
//         Math.max(0, enhancedGray * contrast + brightness)
//       );

//       data[i] = enhanced; // Red
//       data[i + 1] = enhanced; // Green
//       data[i + 2] = enhanced; // Blue
//     }

//     context.putImageData(imageData, 0, 0);

//     // Use WebP for better compression if supported
//     const format = "image/webp";
//     const quality = 0.85;
//     return canvas.toDataURL(format, quality);
//   };

//   // Strategy selection based on file characteristics
//   const selectProcessingStrategy = (pageCount, fileSizeMB) => {
//     if (processingStrategy !== "auto") return processingStrategy;

//     if (pageCount <= 5) return "parallel";
//     if (pageCount <= 15) return "batch";
//     if (pageCount <= 50) return "chunked";
//     return "progressive";
//   };

//   // Simple page-based progress calculation
//   const updateProgress = (completedPages, totalPages) => {
//     if (totalPages === 0) return;

//     const progressPercentage = (completedPages / totalPages) * 100;
//     setProgress(Math.min(100, progressPercentage));
//   };

//   // Update processing statistics
//   const updateProcessingStats = (pageNum, isComplete = false) => {
//     const now = Date.now();

//     if (isComplete) {
//       const pageStartTime =
//         processingStatsRef.current.pageStartTimes.get(pageNum);
//       if (pageStartTime) {
//         const pageTime = now - pageStartTime;
//         processingStatsRef.current.completedTimes.push(pageTime);

//         const avgTime =
//           processingStatsRef.current.completedTimes.reduce((a, b) => a + b, 0) /
//           processingStatsRef.current.completedTimes.length;

//         const remainingPages =
//           processingStats.totalPages - (processingStats.completedPages + 1);
//         const estimatedRemaining = (avgTime * remainingPages) / 1000; // seconds

//         setProcessingStats((prev) => {
//           const newCompletedPages = prev.completedPages + 1;

//           // Update progress based on completed pages
//           updateProgress(newCompletedPages, prev.totalPages);

//           return {
//             ...prev,
//             completedPages: newCompletedPages,
//             averageTimePerPage: avgTime / 1000,
//             estimatedTimeRemaining: estimatedRemaining,
//           };
//         });
//       }
//     } else {
//       processingStatsRef.current.pageStartTimes.set(pageNum, now);
//     }
//   };

//   // Single page processing with optimizations
//   const processSinglePage = async (pdf, pageNum, strategy = "default") => {
//     updateProcessingStats(pageNum, false);

//     try {
//       const page = await pdf.getPage(pageNum);
//       const viewport = page.getViewport({ scale: 1.0 });

//       // Adaptive scaling
//       const optimalScale = getOptimalScale(viewport);
//       const scaledViewport = page.getViewport({ scale: optimalScale });

//       const canvas = document.createElement("canvas");
//       const context = canvas.getContext("2d");
//       canvas.width = scaledViewport.width;
//       canvas.height = scaledViewport.height;

//       // Track memory usage
//       const memUsage = estimateMemoryUsage(canvas);
//       setMemoryUsage((prev) => prev + memUsage);

//       await page.render({
//         canvasContext: context,
//         viewport: scaledViewport,
//       }).promise;

//       // Hebrew-specific preprocessing
//       const optimizedImage = preprocessForHebrewOCR(canvas, context);

//       // OCR with simplified progress tracking
//       const result = await window.Tesseract.recognize(optimizedImage, "heb", {
//         logger: (m) => {
//           // Optional: log OCR progress without updating main progress bar
//           if (m.status === "recognizing text" && m.progress) {
//             console.log(
//               `Page ${pageNum} OCR progress: ${(m.progress * 100).toFixed(1)}%`
//             );
//           }
//         },
//       });

//       // Cleanup
//       page.cleanup();
//       canvas.remove();
//       setMemoryUsage((prev) => prev - memUsage);

//       updateProcessingStats(pageNum, true);

//       return {
//         pageNum,
//         text: result.data.text,
//         confidence: result.data.confidence,
//       };
//     } catch (error) {
//       console.error(`Error processing page ${pageNum}:`, error);
//       updateProcessingStats(pageNum, true);
//       return {
//         pageNum,
//         text: `[Error processing page ${pageNum}: ${error.message}]`,
//         confidence: 0,
//       };
//     }
//   };

//   // Store intermediate results without updating UI
//   const storeIntermediateResults = (results) => {
//     setIntermediateResults(new Map(results));
//     setPageResults(new Map(results));
//   };

//   // Parallel processing strategy
//   const processParallel = async (pdf, maxConcurrency = 3) => {
//     const results = new Map();
//     const semaphore = Array(maxConcurrency)
//       .fill()
//       .map(() => Promise.resolve());
//     let semIndex = 0;

//     const processPage = async (pageNum) => {
//       await semaphore[semIndex];
//       semaphore[semIndex] = processSinglePage(pdf, pageNum, "parallel");
//       const result = await semaphore[semIndex];
//       results.set(pageNum, result);

//       // Store intermediate results without showing final UI
//       storeIntermediateResults(results);

//       semIndex = (semIndex + 1) % maxConcurrency;
//     };

//     const promises = [];
//     for (let i = 1; i <= pdf.numPages; i++) {
//       promises.push(processPage(i));
//     }

//     await Promise.all(promises);
//     return results;
//   };

//   // Chunked processing for large files
//   const processChunked = async (pdf, chunkSize = 5) => {
//     const results = new Map();
//     const totalPages = pdf.numPages;

//     for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
//       const endPage = Math.min(startPage + chunkSize - 1, totalPages);

//       console.log(`Processing chunk: pages ${startPage}-${endPage}`);

//       // Check memory usage
//       if (memoryUsage > 800) {
//         console.log("Memory cleanup triggered...");
//         await forceMemoryCleanup();
//       }

//       // Process chunk in parallel
//       const chunkPromises = [];
//       for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
//         chunkPromises.push(processSinglePage(pdf, pageNum, "chunked"));
//       }

//       try {
//         const chunkResults = await Promise.all(chunkPromises);
//         chunkResults.forEach((result) => {
//           results.set(result.pageNum, result);
//         });

//         // Store intermediate results without showing final UI
//         storeIntermediateResults(results);

//         // Save intermediate results every 20 pages
//         if (startPage % 20 === 1 && results.size > 0) {
//           console.log(`Saved intermediate results: ${results.size} pages`);
//         }
//       } catch (error) {
//         console.error(`Chunk ${startPage}-${endPage} failed:`, error);
//       }
//     }

//     return results;
//   };

//   // Finalize results and update UI - only called when processing is complete
//   const finalizeResults = (results) => {
//     const sortedPages = Array.from(results.keys()).sort((a, b) => a - b);
//     const finalText = sortedPages
//       .map((pageNum) => {
//         const result = results.get(pageNum);
//         return `--- Page ${pageNum} ---\n${result.text}\n`;
//       })
//       .join("\n");

//     setExtractedText(finalText);
//     setPageResults(new Map(results));
//     setProcessingComplete(true);
//   };

//   // Main processing function with strategy selection
//   const processFile = async () => {
//     if (!file) return;

//     setProcessing(true);
//     setProgress(0);
//     setError("");
//     setExtractedText("");
//     setMemoryUsage(0);
//     setPageResults(new Map());
//     setIntermediateResults(new Map());
//     setProcessingComplete(false);

//     // Initialize stats
//     processingStatsRef.current = {
//       startTime: Date.now(),
//       pageStartTimes: new Map(),
//       completedTimes: [],
//     };

//     try {
//       await loadLibraries();

//       const arrayBuffer = await file.arrayBuffer();
//       const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
//         .promise;

//       const pageCount = pdf.numPages;
//       const fileSizeMB = file.size / (1024 * 1024);

//       setProcessingStats({
//         totalPages: pageCount,
//         completedPages: 0,
//         averageTimePerPage: 0,
//         estimatedTimeRemaining: 0,
//       });

//       setProgress(5);

//       // Select optimal processing strategy
//       const strategy = selectProcessingStrategy(pageCount, fileSizeMB);
//       console.log(
//         `Using strategy: ${strategy} for ${pageCount} pages (${fileSizeMB.toFixed(
//           1
//         )}MB)`
//       );

//       let results;

//       switch (strategy) {
//         case "parallel":
//           results = await processParallel(pdf, 3);
//           break;
//         case "batch":
//           results = await processParallel(pdf, 2);
//           break;
//         case "chunked":
//           results = await processChunked(pdf, 5);
//           break;
//         case "progressive":
//           results = await processChunked(pdf, 3);
//           break;
//         default:
//           results = await processChunked(pdf, 5);
//       }

//       // Finalize results - this will show the extracted text section
//       finalizeResults(results);
//       setProgress(100);

//       // Final statistics
//       const totalTime =
//         (Date.now() - processingStatsRef.current.startTime) / 1000;
//       console.log(
//         `Processing completed in ${totalTime.toFixed(1)}s (${(
//           totalTime / pageCount
//         ).toFixed(1)}s per page)`
//       );
//     } catch (err) {
//       setError(`Error processing file: ${err.message}`);
//       console.error("Processing error:", err);
//     } finally {
//       setProcessing(false);
//       await forceMemoryCleanup();
//     }
//   };

//   const validateAndSetFile = (selectedFile) => {
//     if (selectedFile && selectedFile.type === "application/pdf") {
//       setFile(selectedFile);
//       setError("");
//       setExtractedText("");
//       setPageResults(new Map());
//       setIntermediateResults(new Map());
//       setProcessingComplete(false);
//       return true;
//     } else {
//       setError("Please select a valid PDF file");
//       return false;
//     }
//   };

//   const handleFileUpload = (event) => {
//     const selectedFile = event.target.files[0];
//     validateAndSetFile(selectedFile);
//   };

//   // Drag and drop handlers
//   const handleDragEnter = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setIsDragOver(true);
//   };

//   const handleDragLeave = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     if (!e.currentTarget.contains(e.relatedTarget)) {
//       setIsDragOver(false);
//     }
//   };

//   const handleDragOver = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//   };

//   const handleDrop = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setIsDragOver(false);
//     const files = e.dataTransfer.files;
//     if (files.length > 0) {
//       validateAndSetFile(files[0]);
//     }
//   };

//   const copyToClipboard = () => {
//     navigator.clipboard.writeText(extractedText).then(() => {
//       alert("Text copied to clipboard");
//     });
//   };

//   const downloadText = () => {
//     const blob = new Blob([extractedText], {
//       type: "text/plain; charset=utf-8",
//     });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = `${file.name.replace(".pdf", "")}_extracted_text.txt`;
//     a.click();
//     URL.revokeObjectURL(url);
//   };

//   const formatTime = (seconds) => {
//     if (seconds < 60) return `${seconds.toFixed(0)}s`;
//     const minutes = Math.floor(seconds / 60);
//     const remainingSeconds = seconds % 60;
//     return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
//   };

//   const baseStyles = {
//     container: {
//       minHeight: "100vh",
//       backgroundColor: "#f8fafc",
//       padding: "20px",
//     },
//     card: {
//       maxWidth: "900px",
//       margin: "0 auto",
//       backgroundColor: "white",
//       borderRadius: "12px",
//       padding: "32px",
//       boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
//     },
//     title: {
//       fontSize: "2rem",
//       fontWeight: "bold",
//       textAlign: "center",
//       marginBottom: "1rem",
//       color: "#1f2937",
//     },
//     subtitle: {
//       fontSize: "1rem",
//       textAlign: "center",
//       marginBottom: "2rem",
//       color: "#6b7280",
//     },
//     sectionTitle: {
//       fontSize: "1.125rem",
//       fontWeight: "600",
//       marginBottom: "12px",
//       color: "#374151",
//     },
//     button: {
//       backgroundColor: "#3b82f6",
//       color: "white",
//       padding: "12px 24px",
//       borderRadius: "8px",
//       border: "none",
//       fontSize: "14px",
//       fontWeight: "500",
//       cursor: "pointer",
//       display: "flex",
//       alignItems: "center",
//       gap: "8px",
//     },
//     dropzone: {
//       border: `2px dashed ${isDragOver ? "#3b82f6" : "#d1d5db"}`,
//       borderRadius: "8px",
//       padding: "48px 24px",
//       textAlign: "center",
//       backgroundColor: isDragOver ? "#eff6ff" : "#f9fafb",
//       cursor: "pointer",
//       transition: "all 0.2s",
//     },
//     textarea: {
//       width: "100%",
//       height: "400px",
//       padding: "16px",
//       border: "1px solid #d1d5db",
//       borderRadius: "8px",
//       fontSize: "16px",
//       lineHeight: "1.6",
//       fontFamily: hebrewFonts[selectedFont].fontFamily,
//       direction: "rtl",
//       resize: "vertical",
//       backgroundColor: "#ffffff",
//     },
//     statsCard: {
//       backgroundColor: "#f3f4f6",
//       border: "1px solid #e5e7eb",
//       borderRadius: "8px",
//       padding: "16px",
//       marginBottom: "16px",
//     },
//   };

//   return (
//     <div style={baseStyles.container}>
//       <div style={baseStyles.card}>
//         <h1 style={baseStyles.title}>
//           <Zap size={28} style={{ display: "inline", marginRight: "8px" }} />
//           Optimized Hebrew PDF OCR
//         </h1>
//         <p style={baseStyles.subtitle}>
//           Advanced parallel processing • Adaptive scaling • Memory optimization
//           • Progressive results
//         </p>

//         {/* Strategy Selection */}
//         <div style={{ marginBottom: "24px" }}>
//           <h3 style={baseStyles.sectionTitle}>
//             <Settings
//               size={20}
//               style={{ display: "inline", marginRight: "8px" }}
//             />
//             Processing Strategy:
//           </h3>
//           <select
//             value={processingStrategy}
//             onChange={(e) => setProcessingStrategy(e.target.value)}
//             style={{
//               width: "100%",
//               padding: "8px 12px",
//               border: "1px solid #d1d5db",
//               borderRadius: "6px",
//               fontSize: "14px",
//               marginBottom: "8px",
//             }}
//           >
//             <option value="auto">Auto-Select (Recommended)</option>
//             <option value="parallel">Parallel (Fast, 1-10 pages)</option>
//             <option value="batch">Batch (Balanced, 5-20 pages)</option>
//             <option value="chunked">
//               Chunked (Memory efficient, 20+ pages)
//             </option>
//             <option value="progressive">
//               Progressive (Large files, 50+ pages)
//             </option>
//           </select>
//           <p style={{ fontSize: "12px", color: "#6b7280", margin: 0 }}>
//             Auto-select chooses the best strategy based on file size and page
//             count
//           </p>
//         </div>

//         {/* File Upload */}
//         <div style={{ marginBottom: "24px" }}>
//           <div
//             onDragEnter={handleDragEnter}
//             onDragLeave={handleDragLeave}
//             onDragOver={handleDragOver}
//             onDrop={handleDrop}
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
//               <Upload
//                 size={48}
//                 style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
//               />
//               <input
//                 type="file"
//                 accept=".pdf"
//                 onChange={handleFileUpload}
//                 style={{ display: "none" }}
//                 id="file-upload"
//               />
//               <label htmlFor="file-upload" style={baseStyles.button}>
//                 Choose PDF File
//               </label>
//               <p style={{ color: "#6b7280", margin: 0 }}>
//                 {isDragOver
//                   ? "Drop your PDF file here!"
//                   : "Or drag and drop a PDF file here"}
//               </p>
//               {file && (
//                 <div style={{ textAlign: "center" }}>
//                   <p style={{ color: "#059669", fontWeight: "500", margin: 0 }}>
//                     Selected: {file.name}
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
//               <>
//                 <FileText size={20} />
//                 Extract Text (Optimized)
//               </>
//             </button>
//           </div>
//         )}

//         {/* Processing Statistics - Show current progress while processing */}
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
//                 {processingStats.totalPages} pages
//               </div>
//             </div>
//             <div
//               style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}
//             >
//               Memory Usage: {memoryUsage.toFixed(0)} MB • Strategy:{" "}
//               {processingStrategy === "auto"
//                 ? "Auto-selected"
//                 : processingStrategy}
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
//                   width: `${
//                     processingStats.totalPages > 0
//                       ? (processingStats.completedPages /
//                           processingStats.totalPages) *
//                         100
//                       : 0
//                   }%`,
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
//               }}
//             >
//               <h3 style={baseStyles.sectionTitle}>
//                 Extracted Text ({pageResults.size} pages):
//               </h3>
//               <div style={{ display: "flex", gap: "8px" }}>
//                 <button
//                   onClick={copyToClipboard}
//                   style={{
//                     ...baseStyles.button,
//                     backgroundColor: "#6b7280",
//                   }}
//                 >
//                   <Copy size={16} />
//                   Copy
//                 </button>
//                 <button
//                   onClick={downloadText}
//                   style={{
//                     ...baseStyles.button,
//                     backgroundColor: "#3b82f6",
//                   }}
//                 >
//                   <Download size={16} />
//                   Download
//                 </button>
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

// import React, { useState, useCallback, useEffect } from "react";
// import {
//   Upload,
//   FileText,
//   Download,
//   Copy,
//   Loader2,
//   AlertCircle,
// } from "lucide-react";

// const HebrewPDFConverter = () => {
//   const [file, setFile] = useState(null);
//   const [processing, setProcessing] = useState(false);
//   const [extractedText, setExtractedText] = useState("");
//   const [progress, setProgress] = useState(0);
//   const [error, setError] = useState("");
//   const [selectedFont, setSelectedFont] = useState("noto");
//   const [isDragOver, setIsDragOver] = useState(false);

//   // Font options for Hebrew text
//   const hebrewFonts = {
//     noto: {
//       name: "Noto Sans Hebrew (Clean)",
//       fontFamily:
//         "'Noto Sans Hebrew', 'Arial Hebrew', 'Times New Roman', sans-serif",
//     },
//     frank: {
//       name: "Frank Ruhl Libre (Traditional)",
//       fontFamily:
//         "'Frank Ruhl Libre', 'Times New Roman Hebrew', 'Arial Hebrew', serif",
//     },
//     rubik: {
//       name: "Rubik (Modern)",
//       fontFamily: "'Rubik', 'Arial Hebrew', 'Helvetica Neue', sans-serif",
//     },
//     heebo: {
//       name: "Heebo (Readable)",
//       fontFamily: "'Heebo', 'Arial Hebrew', 'Segoe UI', sans-serif",
//     },
//     system: {
//       name: "System Hebrew (Default)",
//       fontFamily: "'Arial Hebrew', 'David', 'Times New Roman', sans-serif",
//     },
//   };

//   // Load Hebrew fonts from Google Fonts
//   useEffect(() => {
//     const loadHebrewFonts = () => {
//       const link = document.createElement("link");
//       link.href =
//         "https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Frank+Ruhl+Libre:wght@400;700&family=Rubik:wght@400;700&family=Heebo:wght@400;700&display=swap";
//       link.rel = "stylesheet";

//       const existingLink = document.querySelector(`link[href="${link.href}"]`);
//       if (!existingLink) {
//         document.head.appendChild(link);
//       }
//     };

//     loadHebrewFonts();
//   }, []);

//   // Load required libraries dynamically
//   const loadLibraries = useCallback(async () => {
//     // Load Tesseract for OCR
//     if (!window.Tesseract) {
//       const script = document.createElement("script");
//       script.src =
//         "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
//       document.head.appendChild(script);
//       await new Promise((resolve) => (script.onload = resolve));
//     }

//     // Load PDF.js for PDF processing
//     if (!window.pdfjsLib) {
//       const script = document.createElement("script");
//       script.src =
//         "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
//       document.head.appendChild(script);
//       await new Promise((resolve) => (script.onload = resolve));
//       window.pdfjsLib.GlobalWorkerOptions.workerSrc =
//         "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
//     }
//   }, []);

//   const validateAndSetFile = (selectedFile) => {
//     if (selectedFile && selectedFile.type === "application/pdf") {
//       setFile(selectedFile);
//       setError("");
//       setExtractedText("");
//       return true;
//     } else {
//       setError("Please select a valid PDF file");
//       return false;
//     }
//   };

//   const handleFileUpload = (event) => {
//     const selectedFile = event.target.files[0];
//     validateAndSetFile(selectedFile);
//   };

//   const handleDragEnter = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setIsDragOver(true);
//   };

//   const handleDragLeave = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     if (!e.currentTarget.contains(e.relatedTarget)) {
//       setIsDragOver(false);
//     }
//   };

//   const handleDragOver = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//   };

//   const handleDrop = (e) => {
//     e.preventDefault();
//     e.stopPropagation();
//     setIsDragOver(false);

//     const files = e.dataTransfer.files;
//     if (files.length > 0) {
//       validateAndSetFile(files[0]);
//     }
//   };

//   const performOCR = async (pdf) => {
//     let allText = "";
//     const totalPages = pdf.numPages;
//     const canvas = document.createElement("canvas");
//     const context = canvas.getContext("2d");

//     for (let i = 1; i <= totalPages; i++) {
//       try {
//         const page = await pdf.getPage(i);
//         const viewport = page.getViewport({ scale: 2.0 });
//         canvas.width = viewport.width;
//         canvas.height = viewport.height;

//         await page.render({
//           canvasContext: context,
//           viewport: viewport,
//         }).promise;

//         const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);
//         page.cleanup();

//         const result = await window.Tesseract.recognize(imageDataUrl, "heb", {
//           logger: (m) => {
//             if (m.status === "recognizing text") {
//               const pageProgress = (m.progress * 50) / totalPages;
//               setProgress(50 + ((i - 1) * 50) / totalPages + pageProgress);
//             }
//           },
//         });

//         allText += `--- Page ${i} ---\n${result.data.text}\n\n`;
//         context.clearRect(0, 0, canvas.width, canvas.height);
//       } catch (err) {
//         console.error(`Error processing page ${i}:`, err);
//         allText += `--- Page ${i} ---\n[Error processing page]\n\n`;
//       }
//     }
//     return allText;
//   };

//   const processFile = async () => {
//     if (!file) return;

//     setProcessing(true);
//     setProgress(0);
//     setError("");

//     try {
//       await loadLibraries();

//       const arrayBuffer = await file.arrayBuffer();
//       const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
//         .promise;

//       setProgress(5);
//       const text = await performOCR(pdf);
//       setExtractedText(text);
//       setProgress(100);
//     } catch (err) {
//       setError(`Error processing file: ${err.message}`);
//       console.error("Processing error:", err);
//     } finally {
//       setProcessing(false);
//     }
//   };

//   const copyToClipboard = () => {
//     navigator.clipboard.writeText(extractedText).then(() => {
//       alert("Text copied to clipboard");
//     });
//   };

//   const downloadText = () => {
//     const blob = new Blob([extractedText], {
//       type: "text/plain; charset=utf-8",
//     });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = `${file.name.replace(".pdf", "")}_extracted_text.txt`;
//     a.click();
//     URL.revokeObjectURL(url);
//   };

//   const baseStyles = {
//     container: {
//       minHeight: "100vh",
//       backgroundColor: "#f8fafc",
//       padding: "20px",
//     },
//     card: {
//       maxWidth: "800px",
//       margin: "0 auto",
//       backgroundColor: "white",
//       borderRadius: "12px",
//       padding: "32px",
//       boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
//     },
//     title: {
//       fontSize: "2rem",
//       fontWeight: "bold",
//       textAlign: "center",
//       marginBottom: "2rem",
//       color: "#1f2937",
//     },
//     sectionTitle: {
//       fontSize: "1.125rem",
//       fontWeight: "600",
//       marginBottom: "12px",
//       color: "#374151",
//     },
//     button: {
//       backgroundColor: "#3b82f6",
//       color: "white",
//       padding: "12px 24px",
//       borderRadius: "8px",
//       border: "none",
//       fontSize: "14px",
//       fontWeight: "500",
//       cursor: "pointer",
//       display: "flex",
//       alignItems: "center",
//       gap: "8px",
//     },
//     dropzone: {
//       border: `2px dashed ${isDragOver ? "#3b82f6" : "#d1d5db"}`,
//       borderRadius: "8px",
//       padding: "48px 24px",
//       textAlign: "center",
//       backgroundColor: isDragOver ? "#eff6ff" : "#f9fafb",
//       cursor: "pointer",
//       transition: "all 0.2s",
//     },
//     textarea: {
//       width: "100%",
//       height: "400px",
//       padding: "16px",
//       border: "1px solid #d1d5db",
//       borderRadius: "8px",
//       fontSize: "16px",
//       lineHeight: "1.6",
//       fontFamily: hebrewFonts[selectedFont].fontFamily,
//       direction: "rtl",
//       resize: "vertical",
//       backgroundColor: "#ffffff",
//     },
//   };

//   return (
//     <div style={baseStyles.container}>
//       <div style={baseStyles.card}>
//         <h1 style={baseStyles.title}>Hebrew PDF Text Extractor</h1>

//         <div style={{ marginBottom: "24px" }}>
//           <div
//             onDragEnter={handleDragEnter}
//             onDragLeave={handleDragLeave}
//             onDragOver={handleDragOver}
//             onDrop={handleDrop}
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
//               <Upload
//                 size={48}
//                 style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
//               />
//               <input
//                 type="file"
//                 accept=".pdf"
//                 onChange={handleFileUpload}
//                 style={{ display: "none" }}
//                 id="file-upload"
//               />
//               <label htmlFor="file-upload" style={baseStyles.button}>
//                 Choose PDF File
//               </label>
//               <p style={{ color: "#6b7280", margin: 0 }}>
//                 {isDragOver
//                   ? "Drop your PDF file here!"
//                   : "Or drag and drop a PDF file here"}
//               </p>
//               {file && (
//                 <p style={{ color: "#059669", fontWeight: "500", margin: 0 }}>
//                   Selected file: {file.name}
//                 </p>
//               )}
//             </div>
//           </div>
//         </div>

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
//               {processing ? (
//                 <>
//                   <Loader2
//                     size={20}
//                     style={{ animation: "spin 1s linear infinite" }}
//                   />
//                   Processing... {Math.round(progress)}%
//                 </>
//               ) : (
//                 <>
//                   <FileText size={20} />
//                   Extract Text
//                 </>
//               )}
//             </button>
//           </div>
//         )}

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
//               Progress: {Math.round(progress)}%
//               {progress <= 50
//                 ? " - Converting PDF to images"
//                 : " - Running OCR on text"}
//             </p>
//           </div>
//         )}

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

//         {extractedText && (
//           <div style={{ marginBottom: "24px" }}>
//             <div
//               style={{
//                 display: "flex",
//                 justifyContent: "space-between",
//                 alignItems: "center",
//                 marginBottom: "16px",
//               }}
//             >
//               <h3 style={baseStyles.sectionTitle}>Extracted Text:</h3>
//               <div style={{ display: "flex", gap: "8px" }}>
//                 <button
//                   onClick={copyToClipboard}
//                   style={{
//                     ...baseStyles.button,
//                     backgroundColor: "#6b7280",
//                   }}
//                 >
//                   <Copy size={16} />
//                   Copy
//                 </button>
//                 <button
//                   onClick={downloadText}
//                   style={{
//                     ...baseStyles.button,
//                     backgroundColor: "#3b82f6",
//                   }}
//                 >
//                   <Download size={16} />
//                   Download
//                 </button>
//               </div>
//             </div>

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

//         <div>
//           <h3 style={baseStyles.sectionTitle}>How it works:</h3>
//           <ul
//             style={{
//               margin: 0,
//               paddingLeft: "20px",
//               color: "#6b7280",
//               lineHeight: "1.6",
//             }}
//           >
//             <li>
//               Upload a PDF file with clear Hebrew text (click or drag & drop)
//             </li>
//             <li>Click "Extract Text" and wait for completion</li>
//             <li>Select your preferred Hebrew font from the dropdown</li>
//             <li>Copy the extracted text or download as a text file</li>
//           </ul>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default HebrewPDFConverter;
