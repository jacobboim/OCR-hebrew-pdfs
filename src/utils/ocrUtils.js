// src/utils/ocrUtils.js
import { TESSERACT_CDN, PDFJS_CDN, PDFJS_WORKER_CDN } from "./constants.js";

// Load required libraries
export const loadLibraries = async (fileType) => {
  if (!window.Tesseract) {
    const script = document.createElement("script");
    script.src = TESSERACT_CDN;
    document.head.appendChild(script);
    await new Promise((resolve) => (script.onload = resolve));
  }

  // Only load PDF.js if we're processing a PDF
  if (fileType === "pdf" && !window.pdfjsLib) {
    const script = document.createElement("script");
    script.src = PDFJS_CDN;
    document.head.appendChild(script);
    await new Promise((resolve) => (script.onload = resolve));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  }
};

// Memory management utilities
export const estimateMemoryUsage = (canvas) => {
  return (canvas.width * canvas.height * 4) / (1024 * 1024); // MB
};

export const forceMemoryCleanup = async (setMemoryUsage) => {
  if (window.gc) {
    window.gc();
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  setMemoryUsage((prev) => prev * 0.7);
};

// Adaptive scaling based on page size and complexity
export const getOptimalScale = (viewport, pageComplexity = "medium") => {
  const area = viewport.width * viewport.height;
  const baseScale = area > 2000000 ? 1.2 : area > 1000000 ? 1.5 : 2.0;

  // Adjust for complexity and strategy
  const complexityMultiplier =
    pageComplexity === "high" ? 1.2 : pageComplexity === "low" ? 0.8 : 1.0;
  return Math.min(baseScale * complexityMultiplier, 2.5);
};

// Hebrew character validation and text cleaning
export const validateHebrewText = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  // Hebrew character ranges
  const hebrewRegex = /[\u0590-\u05FF]/; // Hebrew block
  const hebrewLettersRegex = /[\u05D0-\u05EA]/; // Main Hebrew letters
  const hebrewVowelsRegex = /[\u05B0-\u05BD\u05BF-\u05C7]/; // Hebrew vowels and marks
  const hebrewPunctuationRegex = /[\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4]/; // Hebrew punctuation
  
  // Split text into lines for processing
  const lines = text.split('\n');
  const cleanedLines = [];
  
  for (const line of lines) {
    const words = line.trim().split(/\s+/);
    const validWords = [];
    
    for (const word of words) {
      if (!word.trim()) continue;
      
      // Check if word contains Hebrew characters
      const hasHebrew = hebrewRegex.test(word);
      
      if (!hasHebrew) {
        // Skip words with no Hebrew characters (likely symbols/noise)
        continue;
      }
      
      // Clean the word of non-Hebrew characters except essential punctuation
      let cleanedWord = '';
      for (const char of word) {
        if (hebrewLettersRegex.test(char) || 
            hebrewVowelsRegex.test(char) || 
            hebrewPunctuationRegex.test(char) ||
            /[\s.,;:!?()"'-]/.test(char)) { // Keep common punctuation
          cleanedWord += char;
        }
        // Skip other characters (decorative symbols, stars, etc.)
      }
      
      // Only include if it has meaningful Hebrew content
      if (cleanedWord.trim() && hebrewLettersRegex.test(cleanedWord)) {
        validWords.push(cleanedWord.trim());
      }
    }
    
    // Only include lines that have valid Hebrew words
    if (validWords.length > 0) {
      cleanedLines.push(validWords.join(' '));
    }
  }
  
  return cleanedLines.join('\n').trim();
};

// Hebrew-specific image preprocessing
export const preprocessForHebrewOCR = (canvas, context) => {
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
export const loadImageToCanvas = (file) => {
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
export const selectProcessingStrategy = (
  processingStrategy,
  pageCount,
  fileSizeMB
) => {
  if (processingStrategy !== "auto") return processingStrategy;

  if (pageCount <= 5) return "parallel";
  if (pageCount <= 15) return "batch";
  if (pageCount <= 50) return "chunked";
  return "progressive";
};

// Single page processing with optimizations (for PDFs)
export const processSinglePage = async (
  pdf,
  pageNum,
  strategy = "default",
  callbacks
) => {
  const { updateProcessingStats, setMemoryUsage } = callbacks;

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

    // Apply Hebrew text validation to filter out non-Hebrew symbols
    const cleanedText = validateHebrewText(result.data.text);
    
    return {
      pageNum,
      text: cleanedText,
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

// Process a single image file
export const processImageFile = async (file, callbacks) => {
  const {
    setProcessingStats,
    updateProcessingStats,
    setMemoryUsage,
    setProgress,
  } = callbacks;

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

    // Apply Hebrew text validation to filter out non-Hebrew symbols
    const cleanedText = validateHebrewText(result.data.text);

    return new Map([
      [
        1,
        {
          pageNum: 1,
          text: cleanedText,
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

// Parallel processing strategy
export const processParallel = async (pdf, maxConcurrency = 3, callbacks) => {
  const { storeIntermediateResults } = callbacks;
  const results = new Map();
  const semaphore = Array(maxConcurrency)
    .fill()
    .map(() => Promise.resolve());
  let semIndex = 0;

  const processPage = async (pageNum) => {
    await semaphore[semIndex];
    semaphore[semIndex] = processSinglePage(
      pdf,
      pageNum,
      "parallel",
      callbacks
    );
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
export const processChunked = async (pdf, chunkSize = 5, callbacks) => {
  const { storeIntermediateResults, memoryUsage, forceMemoryCleanup } =
    callbacks;
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
      chunkPromises.push(processSinglePage(pdf, pageNum, "chunked", callbacks));
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
