// src/utils/columnOcrUtils.js
import { preprocessForHebrewOCR, forceMemoryCleanup } from "./ocrUtils.js";

// Column detection and processing utilities for Hebrew sefarim

export const detectColumns = (canvas, sensitivity = "medium") => {
  const context = canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Create vertical projection (count dark pixels in each column)
  const verticalProjection = new Array(canvas.width).fill(0);

  for (let x = 0; x < canvas.width; x++) {
    for (let y = 0; y < canvas.height; y++) {
      const index = (y * canvas.width + x) * 4;
      const gray =
        0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

      // Count dark pixels (text)
      if (gray < 128) {
        verticalProjection[x]++;
      }
    }
  }

  // Adjust parameters based on sensitivity
  let searchStartX, searchEndX, minGapWidth, maxDarkPixelsThreshold;

  switch (sensitivity) {
    case "high":
      searchStartX = Math.floor(canvas.width * 0.25); // Wider search area
      searchEndX = Math.floor(canvas.width * 0.75);
      minGapWidth = Math.floor(canvas.width * 0.005); // Much smaller minimum gap (0.5%)
      maxDarkPixelsThreshold = canvas.height * 0.02; // Allow slightly more dark pixels (2%)
      break;
    case "low":
      searchStartX = Math.floor(canvas.width * 0.35); // Narrower search area
      searchEndX = Math.floor(canvas.width * 0.65);
      minGapWidth = Math.floor(canvas.width * 0.05); // Larger minimum gap (5%)
      maxDarkPixelsThreshold = canvas.height * 0.005; // Stricter dark pixel threshold (0.5%)
      break;
    default: // medium
      searchStartX = Math.floor(canvas.width * 0.3);
      searchEndX = Math.floor(canvas.width * 0.7);
      minGapWidth = Math.floor(canvas.width * 0.015); // Reduced from 3% to 1.5%
      maxDarkPixelsThreshold = canvas.height * 0.015; // Slightly more lenient (1.5%)
  }

  let bestGapStart = -1;
  let bestGapWidth = 0;
  let currentGapStart = -1;
  let currentGapWidth = 0;

  // Debug info
  console.log(`Column detection settings - Sensitivity: ${sensitivity}`);
  console.log(
    `Search area: ${searchStartX} to ${searchEndX} (${Math.round(
      ((searchEndX - searchStartX) / canvas.width) * 100
    )}% of width)`
  );
  console.log(
    `Min gap width: ${minGapWidth}px (${Math.round(
      (minGapWidth / canvas.width) * 100
    )}% of width)`
  );
  console.log(
    `Max dark pixels per column: ${Math.round(
      maxDarkPixelsThreshold
    )} (${Math.round(
      (maxDarkPixelsThreshold / canvas.height) * 100
    )}% of height)`
  );

  for (let x = searchStartX; x < searchEndX; x++) {
    if (verticalProjection[x] < maxDarkPixelsThreshold) {
      // Found a potential gap
      if (currentGapStart === -1) {
        currentGapStart = x;
        currentGapWidth = 1;
      } else {
        currentGapWidth++;
      }
    } else {
      // End of gap
      if (
        currentGapStart !== -1 &&
        currentGapWidth > bestGapWidth &&
        currentGapWidth >= minGapWidth
      ) {
        bestGapStart = currentGapStart;
        bestGapWidth = currentGapWidth;
      }
      currentGapStart = -1;
      currentGapWidth = 0;
    }
  }

  // Check final gap if it extends to the end
  if (
    currentGapStart !== -1 &&
    currentGapWidth > bestGapWidth &&
    currentGapWidth >= minGapWidth
  ) {
    bestGapStart = currentGapStart;
    bestGapWidth = currentGapWidth;
  }

  // Debug the best gap found
  if (bestGapStart !== -1) {
    const separatorX = bestGapStart + Math.floor(bestGapWidth / 2);
    const confidence = Math.min(bestGapWidth / minGapWidth, 5) / 5; // 0-1 confidence, max at 5x minimum

    console.log(`✅ Column gap detected:`);
    console.log(
      `  Gap location: ${bestGapStart}-${
        bestGapStart + bestGapWidth
      } (width: ${bestGapWidth}px)`
    );
    console.log(
      `  Separator at: ${separatorX}px (${Math.round(
        (separatorX / canvas.width) * 100
      )}% from left)`
    );
    console.log(`  Confidence: ${Math.round(confidence * 100)}%`);
    console.log(`  Right column: 0 to ${separatorX}px`);
    console.log(`  Left column: ${separatorX} to ${canvas.width}px`);

    return {
      hasColumns: true,
      rightColumn: { x: 0, width: separatorX },
      leftColumn: { x: separatorX, width: canvas.width - separatorX },
      confidence: confidence,
      gapInfo: {
        start: bestGapStart,
        width: bestGapWidth,
        separator: separatorX,
      },
    };
  }

  console.log(`❌ No suitable column gap found`);
  console.log(
    `  Largest gap found: ${bestGapWidth}px (minimum required: ${minGapWidth}px)`
  );

  return {
    hasColumns: false,
    confidence: 0,
  };
};

export const extractColumnImage = (canvas, columnBounds, padding = 10) => {
  const context = canvas.getContext("2d");

  // Add padding and ensure bounds are valid
  const startX = Math.max(0, columnBounds.x - padding);
  const endX = Math.min(
    canvas.width,
    columnBounds.x + columnBounds.width + padding
  );
  const width = endX - startX;
  const height = canvas.height;

  // Create new canvas for this column
  const columnCanvas = document.createElement("canvas");
  const columnContext = columnCanvas.getContext("2d");
  columnCanvas.width = width;
  columnCanvas.height = height;

  // Copy the column area
  const imageData = context.getImageData(startX, 0, width, height);
  columnContext.putImageData(imageData, 0, 0);

  return columnCanvas;
};

export const processWithColumnDetection = async (
  canvas,
  processingMode = "auto",
  sensitivity = "medium"
) => {
  const results = {
    mode: processingMode,
    columns: [],
    fullText: "",
    confidence: 0,
  };

  if (processingMode === "single" || processingMode === "force_single") {
    // Process as single column
    const optimizedImage = preprocessForHebrewOCR(
      canvas,
      canvas.getContext("2d")
    );
    const result = await window.Tesseract.recognize(optimizedImage, "heb", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(
            `Single column OCR progress: ${(m.progress * 100).toFixed(1)}%`
          );
        }
      },
      tessedit_pageseg_mode: "1", // Automatic page segmentation with OSD
    });

    results.columns.push({
      type: "single",
      text: result.data.text,
      confidence: result.data.confidence,
    });
    results.fullText = result.data.text;
    results.confidence = result.data.confidence;

    return results;
  }

  // Detect columns automatically with adjustable sensitivity
  const columnDetection = detectColumns(canvas, sensitivity);

  if (
    processingMode === "auto" &&
    (!columnDetection.hasColumns || columnDetection.confidence < 0.3) // Lowered threshold
  ) {
    console.log("🔄 Auto mode falling back to single column processing");
    // Fall back to single column processing
    return await processWithColumnDetection(canvas, "single", sensitivity);
  }

  if (processingMode === "force_columns" || columnDetection.hasColumns) {
    // Process as two columns
    let rightColumnBounds, leftColumnBounds;

    if (columnDetection.hasColumns) {
      rightColumnBounds = columnDetection.rightColumn;
      leftColumnBounds = columnDetection.leftColumn;
      results.confidence = columnDetection.confidence;
      console.log("📊 Using detected column boundaries");
    } else {
      // Force split in half if no automatic detection
      const halfWidth = Math.floor(canvas.width / 2);
      // Fix: Right column is on the right side, left column on left side
      rightColumnBounds = { x: halfWidth, width: halfWidth };
      leftColumnBounds = { x: 0, width: halfWidth };
      results.confidence = 0.3; // Low confidence for forced split
      console.log("🔧 Using forced 50/50 column split");
    }

    console.log(
      `Processing right column: ${rightColumnBounds.x} to ${
        rightColumnBounds.x + rightColumnBounds.width
      }`
    );
    console.log(
      `Processing left column: ${leftColumnBounds.x} to ${
        leftColumnBounds.x + leftColumnBounds.width
      }`
    );

    // Extract and process right column first (Hebrew reading order)
    const rightCanvas = extractColumnImage(canvas, rightColumnBounds);
    const rightOptimizedImage = preprocessForHebrewOCR(
      rightCanvas,
      rightCanvas.getContext("2d")
    );

    const rightResult = await window.Tesseract.recognize(
      rightOptimizedImage,
      "heb",
      {
        logger: (m) => {
          if (m.status === "recognizing text") {
            console.log(
              `Right column OCR progress: ${(m.progress * 100).toFixed(1)}%`
            );
          }
        },
        tessedit_pageseg_mode: "6", // Single uniform block of text
      }
    );

    // Extract and process left column
    const leftCanvas = extractColumnImage(canvas, leftColumnBounds);
    const leftOptimizedImage = preprocessForHebrewOCR(
      leftCanvas,
      leftCanvas.getContext("2d")
    );

    const leftResult = await window.Tesseract.recognize(
      leftOptimizedImage,
      "heb",
      {
        logger: (m) => {
          if (m.status === "recognizing text") {
            console.log(
              `Left column OCR progress: ${(m.progress * 100).toFixed(1)}%`
            );
          }
        },
        tessedit_pageseg_mode: "6", // Single uniform block of text
      }
    );

    // Store results for both columns
    results.columns.push({
      type: "right",
      text: rightResult.data.text,
      confidence: rightResult.data.confidence,
      bounds: rightColumnBounds,
    });

    results.columns.push({
      type: "left",
      text: leftResult.data.text,
      confidence: leftResult.data.confidence,
      bounds: leftColumnBounds,
    });

    // Combine text in correct reading order (right column first, then left)
    results.fullText = `--- עמוד ימין ---\n${leftResult.data.text}\n\n--- עמוד שמאל ---\n${rightResult.data.text}`;

    // Cleanup canvases
    rightCanvas.remove();
    leftCanvas.remove();

    return results;
  }

  // Fallback to single column
  console.log("🔄 Falling back to single column processing");
  return await processWithColumnDetection(canvas, "single", sensitivity);
};

// Enhanced processing for Hebrew sefer pages
export const processHebrewSeferPage = async (
  pdf,
  pageNum,
  columnMode = "auto",
  callbacks
) => {
  const { updateProcessingStats, setMemoryUsage } = callbacks;

  updateProcessingStats(pageNum, false);

  try {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    // Use higher resolution for column detection
    const scale = Math.min(
      2.5,
      Math.max(1.5, 2000 / Math.max(viewport.width, viewport.height))
    );
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // Track memory usage
    const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
    setMemoryUsage((prev) => prev + memUsage);

    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
    }).promise;

    // Process with column detection (using 'high' sensitivity for better detection)
    const results = await processWithColumnDetection(
      canvas,
      columnMode,
      "high"
    );

    // Cleanup
    page.cleanup();
    canvas.remove();
    setMemoryUsage((prev) => prev - memUsage);

    updateProcessingStats(pageNum, true);

    return {
      pageNum,
      text: results.fullText,
      confidence: results.confidence,
      columnData: results.columns,
      processingMode: results.mode,
    };
  } catch (error) {
    console.error(`Error processing page ${pageNum}:`, error);
    updateProcessingStats(pageNum, true);
    return {
      pageNum,
      text: `[Error processing page ${pageNum}: ${error.message}]`,
      confidence: 0,
      columnData: [],
      processingMode: "error",
    };
  }
};

// Process image with column detection
export const processHebrewSeferImage = async (
  file,
  columnMode = "auto",
  callbacks
) => {
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
    // Load image to canvas
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    context.drawImage(img, 0, 0);

    // Track memory usage
    const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
    setMemoryUsage(memUsage);

    // Process with column detection (using 'high' sensitivity for better detection)
    setProgress(20);
    const results = await processWithColumnDetection(
      canvas,
      columnMode,
      "high"
    );

    // Cleanup
    canvas.remove();
    setMemoryUsage(0);

    updateProcessingStats(1, true);

    return new Map([
      [
        1,
        {
          pageNum: 1,
          text: results.fullText,
          confidence: results.confidence,
          columnData: results.columns,
          processingMode: results.mode,
        },
      ],
    ]);
  } catch (error) {
    console.error("Error processing Hebrew sefer image:", error);
    updateProcessingStats(1, true);
    return new Map([
      [
        1,
        {
          pageNum: 1,
          text: `[Error processing image: ${error.message}]`,
          confidence: 0,
          columnData: [],
          processingMode: "error",
        },
      ],
    ]);
  }
};

// Parallel processing for Hebrew sefer pages with column detection
export const processParallelHebrewSefer = async (
  pdf,
  maxConcurrency = 3,
  columnMode = "auto",
  callbacks
) => {
  const { storeIntermediateResults } = callbacks;
  const results = new Map();
  const semaphore = Array(maxConcurrency)
    .fill()
    .map(() => Promise.resolve());
  let semIndex = 0;

  const processPage = async (pageNum) => {
    await semaphore[semIndex];
    semaphore[semIndex] = processHebrewSeferPage(
      pdf,
      pageNum,
      columnMode,
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

// Chunked processing for Hebrew sefer pages with column detection
export const processChunkedHebrewSefer = async (
  pdf,
  chunkSize = 5,
  columnMode = "auto",
  callbacks
) => {
  const { storeIntermediateResults, memoryUsage, forceMemoryCleanup } =
    callbacks;
  const results = new Map();
  const totalPages = pdf.numPages;

  for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
    const endPage = Math.min(startPage + chunkSize - 1, totalPages);

    console.log(
      `Processing Hebrew sefer chunk: pages ${startPage}-${endPage} with column mode: ${columnMode}`
    );

    // Check memory usage
    if (memoryUsage > 800) {
      console.log("Memory cleanup triggered...");
      await forceMemoryCleanup(callbacks.setMemoryUsage);
    }

    // Process chunk in parallel
    const chunkPromises = [];
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      chunkPromises.push(
        processHebrewSeferPage(pdf, pageNum, columnMode, callbacks)
      );
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
        console.log(
          `Saved intermediate Hebrew sefer results: ${results.size} pages`
        );
      }
    } catch (error) {
      console.error(
        `Hebrew sefer chunk ${startPage}-${endPage} failed:`,
        error
      );
    }
  }

  return results;
};

// // src/utils/columnOcrUtils.js
// import { preprocessForHebrewOCR, forceMemoryCleanup } from "./ocrUtils.js";

// // Column detection and processing utilities for Hebrew sefarim

// export const detectColumns = (canvas, sensitivity = "medium") => {
//   const context = canvas.getContext("2d");
//   const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
//   const data = imageData.data;

//   // Create vertical projection (count dark pixels in each column)
//   const verticalProjection = new Array(canvas.width).fill(0);

//   for (let x = 0; x < canvas.width; x++) {
//     for (let y = 0; y < canvas.height; y++) {
//       const index = (y * canvas.width + x) * 4;
//       const gray =
//         0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

//       // Count dark pixels (text)
//       if (gray < 128) {
//         verticalProjection[x]++;
//       }
//     }
//   }

//   // Adjust parameters based on sensitivity
//   let searchStartX, searchEndX, minGapWidth, maxDarkPixelsThreshold;

//   switch (sensitivity) {
//     case "high":
//       searchStartX = Math.floor(canvas.width * 0.25); // Wider search area
//       searchEndX = Math.floor(canvas.width * 0.75);
//       minGapWidth = Math.floor(canvas.width * 0.005); // Much smaller minimum gap (0.5%)
//       maxDarkPixelsThreshold = canvas.height * 0.02; // Allow slightly more dark pixels (2%)
//       break;
//     case "low":
//       searchStartX = Math.floor(canvas.width * 0.35); // Narrower search area
//       searchEndX = Math.floor(canvas.width * 0.65);
//       minGapWidth = Math.floor(canvas.width * 0.05); // Larger minimum gap (5%)
//       maxDarkPixelsThreshold = canvas.height * 0.005; // Stricter dark pixel threshold (0.5%)
//       break;
//     default: // medium
//       searchStartX = Math.floor(canvas.width * 0.3);
//       searchEndX = Math.floor(canvas.width * 0.7);
//       minGapWidth = Math.floor(canvas.width * 0.015); // Reduced from 3% to 1.5%
//       maxDarkPixelsThreshold = canvas.height * 0.015; // Slightly more lenient (1.5%)
//   }

//   let bestGapStart = -1;
//   let bestGapWidth = 0;
//   let currentGapStart = -1;
//   let currentGapWidth = 0;

//   // Debug info
//   console.log(`Column detection settings - Sensitivity: ${sensitivity}`);
//   console.log(
//     `Search area: ${searchStartX} to ${searchEndX} (${Math.round(
//       ((searchEndX - searchStartX) / canvas.width) * 100
//     )}% of width)`
//   );
//   console.log(
//     `Min gap width: ${minGapWidth}px (${Math.round(
//       (minGapWidth / canvas.width) * 100
//     )}% of width)`
//   );
//   console.log(
//     `Max dark pixels per column: ${Math.round(
//       maxDarkPixelsThreshold
//     )} (${Math.round(
//       (maxDarkPixelsThreshold / canvas.height) * 100
//     )}% of height)`
//   );

//   for (let x = searchStartX; x < searchEndX; x++) {
//     if (verticalProjection[x] < maxDarkPixelsThreshold) {
//       // Found a potential gap
//       if (currentGapStart === -1) {
//         currentGapStart = x;
//         currentGapWidth = 1;
//       } else {
//         currentGapWidth++;
//       }
//     } else {
//       // End of gap
//       if (
//         currentGapStart !== -1 &&
//         currentGapWidth > bestGapWidth &&
//         currentGapWidth >= minGapWidth
//       ) {
//         bestGapStart = currentGapStart;
//         bestGapWidth = currentGapWidth;
//       }
//       currentGapStart = -1;
//       currentGapWidth = 0;
//     }
//   }

//   // Check final gap if it extends to the end
//   if (
//     currentGapStart !== -1 &&
//     currentGapWidth > bestGapWidth &&
//     currentGapWidth >= minGapWidth
//   ) {
//     bestGapStart = currentGapStart;
//     bestGapWidth = currentGapWidth;
//   }

//   // Debug the best gap found
//   if (bestGapStart !== -1) {
//     const separatorX = bestGapStart + Math.floor(bestGapWidth / 2);
//     const confidence = Math.min(bestGapWidth / minGapWidth, 5) / 5; // 0-1 confidence, max at 5x minimum

//     console.log(`✅ Column gap detected:`);
//     console.log(
//       `  Gap location: ${bestGapStart}-${
//         bestGapStart + bestGapWidth
//       } (width: ${bestGapWidth}px)`
//     );
//     console.log(
//       `  Separator at: ${separatorX}px (${Math.round(
//         (separatorX / canvas.width) * 100
//       )}% from left)`
//     );
//     console.log(`  Confidence: ${Math.round(confidence * 100)}%`);
//     console.log(`  Right column: 0 to ${separatorX}px`);
//     console.log(`  Left column: ${separatorX} to ${canvas.width}px`);

//     return {
//       hasColumns: true,
//       rightColumn: { x: 0, width: separatorX },
//       leftColumn: { x: separatorX, width: canvas.width - separatorX },
//       confidence: confidence,
//       gapInfo: {
//         start: bestGapStart,
//         width: bestGapWidth,
//         separator: separatorX,
//       },
//     };
//   }

//   console.log(`❌ No suitable column gap found`);
//   console.log(
//     `  Largest gap found: ${bestGapWidth}px (minimum required: ${minGapWidth}px)`
//   );

//   return {
//     hasColumns: false,
//     confidence: 0,
//   };
// };

// export const extractColumnImage = (canvas, columnBounds, padding = 10) => {
//   const context = canvas.getContext("2d");

//   // Add padding and ensure bounds are valid
//   const startX = Math.max(0, columnBounds.x - padding);
//   const endX = Math.min(
//     canvas.width,
//     columnBounds.x + columnBounds.width + padding
//   );
//   const width = endX - startX;
//   const height = canvas.height;

//   // Create new canvas for this column
//   const columnCanvas = document.createElement("canvas");
//   const columnContext = columnCanvas.getContext("2d");
//   columnCanvas.width = width;
//   columnCanvas.height = height;

//   // Copy the column area
//   const imageData = context.getImageData(startX, 0, width, height);
//   columnContext.putImageData(imageData, 0, 0);

//   return columnCanvas;
// };

// export const processWithColumnDetection = async (
//   canvas,
//   processingMode = "auto",
//   sensitivity = "medium"
// ) => {
//   const results = {
//     mode: processingMode,
//     columns: [],
//     fullText: "",
//     confidence: 0,
//   };

//   if (processingMode === "single" || processingMode === "force_single") {
//     // Process as single column
//     const optimizedImage = preprocessForHebrewOCR(
//       canvas,
//       canvas.getContext("2d")
//     );
//     const result = await window.Tesseract.recognize(optimizedImage, "heb", {
//       logger: (m) => {
//         if (m.status === "recognizing text") {
//           console.log(
//             `Single column OCR progress: ${(m.progress * 100).toFixed(1)}%`
//           );
//         }
//       },
//       tessedit_pageseg_mode: "1", // Automatic page segmentation with OSD
//     });

//     results.columns.push({
//       type: "single",
//       text: result.data.text,
//       confidence: result.data.confidence,
//     });
//     results.fullText = result.data.text;
//     results.confidence = result.data.confidence;

//     return results;
//   }

//   // Detect columns automatically with adjustable sensitivity
//   const columnDetection = detectColumns(canvas, sensitivity);

//   if (
//     processingMode === "auto" &&
//     (!columnDetection.hasColumns || columnDetection.confidence < 0.3) // Lowered threshold
//   ) {
//     console.log("🔄 Auto mode falling back to single column processing");
//     // Fall back to single column processing
//     return await processWithColumnDetection(canvas, "single", sensitivity);
//   }

//   if (processingMode === "force_columns" || columnDetection.hasColumns) {
//     // Process as two columns
//     let rightColumnBounds, leftColumnBounds;

//     if (columnDetection.hasColumns) {
//       rightColumnBounds = columnDetection.rightColumn;
//       leftColumnBounds = columnDetection.leftColumn;
//       results.confidence = columnDetection.confidence;
//       console.log("📊 Using detected column boundaries");
//     } else {
//       // Force split in half if no automatic detection
//       rightColumnBounds = { x: 0, width: Math.floor(canvas.width / 2) };
//       leftColumnBounds = {
//         x: Math.floor(canvas.width / 2),
//         width: Math.floor(canvas.width / 2),
//       };
//       results.confidence = 0.3; // Low confidence for forced split
//       console.log("🔧 Using forced 50/50 column split");
//     }

//     console.log(
//       `Processing right column: ${rightColumnBounds.x} to ${
//         rightColumnBounds.x + rightColumnBounds.width
//       }`
//     );
//     console.log(
//       `Processing left column: ${leftColumnBounds.x} to ${
//         leftColumnBounds.x + leftColumnBounds.width
//       }`
//     );

//     // Extract and process right column first (Hebrew reading order)
//     const rightCanvas = extractColumnImage(canvas, rightColumnBounds);
//     const rightOptimizedImage = preprocessForHebrewOCR(
//       rightCanvas,
//       rightCanvas.getContext("2d")
//     );

//     const rightResult = await window.Tesseract.recognize(
//       rightOptimizedImage,
//       "heb",
//       {
//         logger: (m) => {
//           if (m.status === "recognizing text") {
//             console.log(
//               `Right column OCR progress: ${(m.progress * 100).toFixed(1)}%`
//             );
//           }
//         },
//         tessedit_pageseg_mode: "6", // Single uniform block of text
//       }
//     );

//     // Extract and process left column
//     const leftCanvas = extractColumnImage(canvas, leftColumnBounds);
//     const leftOptimizedImage = preprocessForHebrewOCR(
//       leftCanvas,
//       leftCanvas.getContext("2d")
//     );

//     const leftResult = await window.Tesseract.recognize(
//       leftOptimizedImage,
//       "heb",
//       {
//         logger: (m) => {
//           if (m.status === "recognizing text") {
//             console.log(
//               `Left column OCR progress: ${(m.progress * 100).toFixed(1)}%`
//             );
//           }
//         },
//         tessedit_pageseg_mode: "6", // Single uniform block of text
//       }
//     );

//     // Store results for both columns
//     results.columns.push({
//       type: "right",
//       text: rightResult.data.text,
//       confidence: rightResult.data.confidence,
//       bounds: rightColumnBounds,
//     });

//     results.columns.push({
//       type: "left",
//       text: leftResult.data.text,
//       confidence: leftResult.data.confidence,
//       bounds: leftColumnBounds,
//     });

//     // Combine text in correct reading order (right column first, then left)
//     results.fullText = `--- עמוד ימין ---\n${rightResult.data.text}\n\n--- עמוד שמאל ---\n${leftResult.data.text}`;

//     // Cleanup canvases
//     rightCanvas.remove();
//     leftCanvas.remove();

//     return results;
//   }

//   // Fallback to single column
//   console.log("🔄 Falling back to single column processing");
//   return await processWithColumnDetection(canvas, "single", sensitivity);
// };

// // Enhanced processing for Hebrew sefer pages
// export const processHebrewSeferPage = async (
//   pdf,
//   pageNum,
//   columnMode = "auto",
//   callbacks
// ) => {
//   const { updateProcessingStats, setMemoryUsage } = callbacks;

//   updateProcessingStats(pageNum, false);

//   try {
//     const page = await pdf.getPage(pageNum);
//     const viewport = page.getViewport({ scale: 1.0 });

//     // Use higher resolution for column detection
//     const scale = Math.min(
//       2.5,
//       Math.max(1.5, 2000 / Math.max(viewport.width, viewport.height))
//     );
//     const scaledViewport = page.getViewport({ scale });

//     const canvas = document.createElement("canvas");
//     const context = canvas.getContext("2d");
//     canvas.width = scaledViewport.width;
//     canvas.height = scaledViewport.height;

//     // Track memory usage
//     const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
//     setMemoryUsage((prev) => prev + memUsage);

//     await page.render({
//       canvasContext: context,
//       viewport: scaledViewport,
//     }).promise;

//     // Process with column detection (using 'high' sensitivity for better detection)
//     const results = await processWithColumnDetection(
//       canvas,
//       columnMode,
//       "high"
//     );

//     // Cleanup
//     page.cleanup();
//     canvas.remove();
//     setMemoryUsage((prev) => prev - memUsage);

//     updateProcessingStats(pageNum, true);

//     return {
//       pageNum,
//       text: results.fullText,
//       confidence: results.confidence,
//       columnData: results.columns,
//       processingMode: results.mode,
//     };
//   } catch (error) {
//     console.error(`Error processing page ${pageNum}:`, error);
//     updateProcessingStats(pageNum, true);
//     return {
//       pageNum,
//       text: `[Error processing page ${pageNum}: ${error.message}]`,
//       confidence: 0,
//       columnData: [],
//       processingMode: "error",
//     };
//   }
// };

// // Process image with column detection
// export const processHebrewSeferImage = async (
//   file,
//   columnMode = "auto",
//   callbacks
// ) => {
//   const {
//     setProcessingStats,
//     updateProcessingStats,
//     setMemoryUsage,
//     setProgress,
//   } = callbacks;

//   setProcessingStats({
//     totalPages: 1,
//     completedPages: 0,
//     averageTimePerPage: 0,
//     estimatedTimeRemaining: 0,
//   });

//   updateProcessingStats(1, false);

//   try {
//     // Load image to canvas
//     const img = new Image();
//     await new Promise((resolve, reject) => {
//       img.onload = resolve;
//       img.onerror = reject;
//       img.src = URL.createObjectURL(file);
//     });

//     const canvas = document.createElement("canvas");
//     const context = canvas.getContext("2d");
//     canvas.width = img.naturalWidth;
//     canvas.height = img.naturalHeight;

//     context.drawImage(img, 0, 0);

//     // Track memory usage
//     const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
//     setMemoryUsage(memUsage);

//     // Process with column detection (using 'high' sensitivity for better detection)
//     setProgress(20);
//     const results = await processWithColumnDetection(
//       canvas,
//       columnMode,
//       "high"
//     );

//     // Cleanup
//     canvas.remove();
//     setMemoryUsage(0);

//     updateProcessingStats(1, true);

//     return new Map([
//       [
//         1,
//         {
//           pageNum: 1,
//           text: results.fullText,
//           confidence: results.confidence,
//           columnData: results.columns,
//           processingMode: results.mode,
//         },
//       ],
//     ]);
//   } catch (error) {
//     console.error("Error processing Hebrew sefer image:", error);
//     updateProcessingStats(1, true);
//     return new Map([
//       [
//         1,
//         {
//           pageNum: 1,
//           text: `[Error processing image: ${error.message}]`,
//           confidence: 0,
//           columnData: [],
//           processingMode: "error",
//         },
//       ],
//     ]);
//   }
// };

// // Parallel processing for Hebrew sefer pages with column detection
// export const processParallelHebrewSefer = async (
//   pdf,
//   maxConcurrency = 3,
//   columnMode = "auto",
//   callbacks
// ) => {
//   const { storeIntermediateResults } = callbacks;
//   const results = new Map();
//   const semaphore = Array(maxConcurrency)
//     .fill()
//     .map(() => Promise.resolve());
//   let semIndex = 0;

//   const processPage = async (pageNum) => {
//     await semaphore[semIndex];
//     semaphore[semIndex] = processHebrewSeferPage(
//       pdf,
//       pageNum,
//       columnMode,
//       callbacks
//     );
//     const result = await semaphore[semIndex];
//     results.set(pageNum, result);

//     // Store intermediate results without showing final UI
//     storeIntermediateResults(results);

//     semIndex = (semIndex + 1) % maxConcurrency;
//   };

//   const promises = [];
//   for (let i = 1; i <= pdf.numPages; i++) {
//     promises.push(processPage(i));
//   }

//   await Promise.all(promises);
//   return results;
// };

// // Chunked processing for Hebrew sefer pages with column detection
// export const processChunkedHebrewSefer = async (
//   pdf,
//   chunkSize = 5,
//   columnMode = "auto",
//   callbacks
// ) => {
//   const { storeIntermediateResults, memoryUsage, forceMemoryCleanup } =
//     callbacks;
//   const results = new Map();
//   const totalPages = pdf.numPages;

//   for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
//     const endPage = Math.min(startPage + chunkSize - 1, totalPages);

//     console.log(
//       `Processing Hebrew sefer chunk: pages ${startPage}-${endPage} with column mode: ${columnMode}`
//     );

//     // Check memory usage
//     if (memoryUsage > 800) {
//       console.log("Memory cleanup triggered...");
//       await forceMemoryCleanup(callbacks.setMemoryUsage);
//     }

//     // Process chunk in parallel
//     const chunkPromises = [];
//     for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
//       chunkPromises.push(
//         processHebrewSeferPage(pdf, pageNum, columnMode, callbacks)
//       );
//     }

//     try {
//       const chunkResults = await Promise.all(chunkPromises);
//       chunkResults.forEach((result) => {
//         results.set(result.pageNum, result);
//       });

//       // Store intermediate results without showing final UI
//       storeIntermediateResults(results);

//       // Save intermediate results every 20 pages
//       if (startPage % 20 === 1 && results.size > 0) {
//         console.log(
//           `Saved intermediate Hebrew sefer results: ${results.size} pages`
//         );
//       }
//     } catch (error) {
//       console.error(
//         `Hebrew sefer chunk ${startPage}-${endPage} failed:`,
//         error
//       );
//     }
//   }

//   return results;
// };

// // // src/utils/columnOcrUtils.js
// // import { preprocessForHebrewOCR, forceMemoryCleanup } from "./ocrUtils.js";

// // // Column detection and processing utilities for Hebrew sefarim

// // export const detectColumns = (canvas) => {
// //   const context = canvas.getContext("2d");
// //   const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
// //   const data = imageData.data;

// //   // Create vertical projection (count dark pixels in each column)
// //   const verticalProjection = new Array(canvas.width).fill(0);

// //   for (let x = 0; x < canvas.width; x++) {
// //     for (let y = 0; y < canvas.height; y++) {
// //       const index = (y * canvas.width + x) * 4;
// //       const gray =
// //         0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

// //       // Count dark pixels (text)
// //       if (gray < 128) {
// //         verticalProjection[x]++;
// //       }
// //     }
// //   }

// //   // Find the column separator (the largest gap in the middle third of the page)
// //   const startX = Math.floor(canvas.width * 0.3);
// //   const endX = Math.floor(canvas.width * 0.7);
// //   const minGapWidth = Math.floor(canvas.width * 0.03); // Minimum 3% of page width

// //   let bestGapStart = -1;
// //   let bestGapWidth = 0;
// //   let currentGapStart = -1;
// //   let currentGapWidth = 0;

// //   for (let x = startX; x < endX; x++) {
// //     if (verticalProjection[x] < canvas.height * 0.01) {
// //       // Very few dark pixels
// //       if (currentGapStart === -1) {
// //         currentGapStart = x;
// //         currentGapWidth = 1;
// //       } else {
// //         currentGapWidth++;
// //       }
// //     } else {
// //       if (
// //         currentGapStart !== -1 &&
// //         currentGapWidth > bestGapWidth &&
// //         currentGapWidth >= minGapWidth
// //       ) {
// //         bestGapStart = currentGapStart;
// //         bestGapWidth = currentGapWidth;
// //       }
// //       currentGapStart = -1;
// //       currentGapWidth = 0;
// //     }
// //   }

// //   // If we found a good gap, use it as column separator
// //   if (bestGapStart !== -1) {
// //     const separatorX = bestGapStart + Math.floor(bestGapWidth / 2);
// //     return {
// //       hasColumns: true,
// //       rightColumn: { x: 0, width: separatorX },
// //       leftColumn: { x: separatorX, width: canvas.width - separatorX },
// //       confidence: Math.min(bestGapWidth / minGapWidth, 3) / 3, // 0-1 confidence
// //     };
// //   }

// //   return {
// //     hasColumns: false,
// //     confidence: 0,
// //   };
// // };

// // export const extractColumnImage = (canvas, columnBounds, padding = 10) => {
// //   const context = canvas.getContext("2d");

// //   // Add padding and ensure bounds are valid
// //   const startX = Math.max(0, columnBounds.x - padding);
// //   const endX = Math.min(
// //     canvas.width,
// //     columnBounds.x + columnBounds.width + padding
// //   );
// //   const width = endX - startX;
// //   const height = canvas.height;

// //   // Create new canvas for this column
// //   const columnCanvas = document.createElement("canvas");
// //   const columnContext = columnCanvas.getContext("2d");
// //   columnCanvas.width = width;
// //   columnCanvas.height = height;

// //   // Copy the column area
// //   const imageData = context.getImageData(startX, 0, width, height);
// //   columnContext.putImageData(imageData, 0, 0);

// //   return columnCanvas;
// // };

// // export const processWithColumnDetection = async (
// //   canvas,
// //   processingMode = "auto"
// // ) => {
// //   const results = {
// //     mode: processingMode,
// //     columns: [],
// //     fullText: "",
// //     confidence: 0,
// //   };

// //   if (processingMode === "single" || processingMode === "force_single") {
// //     // Process as single column
// //     const optimizedImage = preprocessForHebrewOCR(
// //       canvas,
// //       canvas.getContext("2d")
// //     );
// //     const result = await window.Tesseract.recognize(optimizedImage, "heb", {
// //       logger: (m) => {
// //         if (m.status === "recognizing text") {
// //           console.log(
// //             `Single column OCR progress: ${(m.progress * 100).toFixed(1)}%`
// //           );
// //         }
// //       },
// //       tessedit_pageseg_mode: "1", // Automatic page segmentation with OSD
// //     });

// //     results.columns.push({
// //       type: "single",
// //       text: result.data.text,
// //       confidence: result.data.confidence,
// //     });
// //     results.fullText = result.data.text;
// //     results.confidence = result.data.confidence;

// //     return results;
// //   }

// //   // Detect columns automatically
// //   const columnDetection = detectColumns(canvas);

// //   if (
// //     processingMode === "auto" &&
// //     (!columnDetection.hasColumns || columnDetection.confidence < 0.5)
// //   ) {
// //     // Fall back to single column processing
// //     return await processWithColumnDetection(canvas, "single");
// //   }

// //   if (processingMode === "force_columns" || columnDetection.hasColumns) {
// //     // Process as two columns
// //     let rightColumnBounds, leftColumnBounds;

// //     if (columnDetection.hasColumns) {
// //       rightColumnBounds = columnDetection.rightColumn;
// //       leftColumnBounds = columnDetection.leftColumn;
// //       results.confidence = columnDetection.confidence;
// //     } else {
// //       // Force split in half if no automatic detection
// //       rightColumnBounds = { x: 0, width: Math.floor(canvas.width / 2) };
// //       leftColumnBounds = {
// //         x: Math.floor(canvas.width / 2),
// //         width: Math.floor(canvas.width / 2),
// //       };
// //       results.confidence = 0.3; // Low confidence for forced split
// //     }

// //     // Extract and process right column first (Hebrew reading order)
// //     const rightCanvas = extractColumnImage(canvas, rightColumnBounds);
// //     const rightOptimizedImage = preprocessForHebrewOCR(
// //       rightCanvas,
// //       rightCanvas.getContext("2d")
// //     );

// //     const rightResult = await window.Tesseract.recognize(
// //       rightOptimizedImage,
// //       "heb",
// //       {
// //         logger: (m) => {
// //           if (m.status === "recognizing text") {
// //             console.log(
// //               `Right column OCR progress: ${(m.progress * 100).toFixed(1)}%`
// //             );
// //           }
// //         },
// //         tessedit_pageseg_mode: "6", // Single uniform block of text
// //       }
// //     );

// //     // Extract and process left column
// //     const leftCanvas = extractColumnImage(canvas, leftColumnBounds);
// //     const leftOptimizedImage = preprocessForHebrewOCR(
// //       leftCanvas,
// //       leftCanvas.getContext("2d")
// //     );

// //     const leftResult = await window.Tesseract.recognize(
// //       leftOptimizedImage,
// //       "heb",
// //       {
// //         logger: (m) => {
// //           if (m.status === "recognizing text") {
// //             console.log(
// //               `Left column OCR progress: ${(m.progress * 100).toFixed(1)}%`
// //             );
// //           }
// //         },
// //         tessedit_pageseg_mode: "6", // Single uniform block of text
// //       }
// //     );

// //     // Store results for both columns
// //     results.columns.push({
// //       type: "right",
// //       text: rightResult.data.text,
// //       confidence: rightResult.data.confidence,
// //       bounds: rightColumnBounds,
// //     });

// //     results.columns.push({
// //       type: "left",
// //       text: leftResult.data.text,
// //       confidence: leftResult.data.confidence,
// //       bounds: leftColumnBounds,
// //     });

// //     // Combine text in correct reading order (right column first, then left)
// //     results.fullText = `--- עמוד ימין ---\n${rightResult.data.text}\n\n--- עמוד שמאל ---\n${leftResult.data.text}`;

// //     // Cleanup canvases
// //     rightCanvas.remove();
// //     leftCanvas.remove();

// //     return results;
// //   }

// //   // Fallback to single column
// //   return await processWithColumnDetection(canvas, "single");
// // };

// // // Enhanced processing for Hebrew sefer pages
// // export const processHebrewSeferPage = async (
// //   pdf,
// //   pageNum,
// //   columnMode = "auto",
// //   callbacks
// // ) => {
// //   const { updateProcessingStats, setMemoryUsage } = callbacks;

// //   updateProcessingStats(pageNum, false);

// //   try {
// //     const page = await pdf.getPage(pageNum);
// //     const viewport = page.getViewport({ scale: 1.0 });

// //     // Use higher resolution for column detection
// //     const scale = Math.min(
// //       2.5,
// //       Math.max(1.5, 2000 / Math.max(viewport.width, viewport.height))
// //     );
// //     const scaledViewport = page.getViewport({ scale });

// //     const canvas = document.createElement("canvas");
// //     const context = canvas.getContext("2d");
// //     canvas.width = scaledViewport.width;
// //     canvas.height = scaledViewport.height;

// //     // Track memory usage
// //     const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
// //     setMemoryUsage((prev) => prev + memUsage);

// //     await page.render({
// //       canvasContext: context,
// //       viewport: scaledViewport,
// //     }).promise;

// //     // Process with column detection
// //     const results = await processWithColumnDetection(canvas, columnMode);

// //     // Cleanup
// //     page.cleanup();
// //     canvas.remove();
// //     setMemoryUsage((prev) => prev - memUsage);

// //     updateProcessingStats(pageNum, true);

// //     return {
// //       pageNum,
// //       text: results.fullText,
// //       confidence: results.confidence,
// //       columnData: results.columns,
// //       processingMode: results.mode,
// //     };
// //   } catch (error) {
// //     console.error(`Error processing page ${pageNum}:`, error);
// //     updateProcessingStats(pageNum, true);
// //     return {
// //       pageNum,
// //       text: `[Error processing page ${pageNum}: ${error.message}]`,
// //       confidence: 0,
// //       columnData: [],
// //       processingMode: "error",
// //     };
// //   }
// // };

// // // Process image with column detection
// // export const processHebrewSeferImage = async (
// //   file,
// //   columnMode = "auto",
// //   callbacks
// // ) => {
// //   const {
// //     setProcessingStats,
// //     updateProcessingStats,
// //     setMemoryUsage,
// //     setProgress,
// //   } = callbacks;

// //   setProcessingStats({
// //     totalPages: 1,
// //     completedPages: 0,
// //     averageTimePerPage: 0,
// //     estimatedTimeRemaining: 0,
// //   });

// //   updateProcessingStats(1, false);

// //   try {
// //     // Load image to canvas
// //     const img = new Image();
// //     await new Promise((resolve, reject) => {
// //       img.onload = resolve;
// //       img.onerror = reject;
// //       img.src = URL.createObjectURL(file);
// //     });

// //     const canvas = document.createElement("canvas");
// //     const context = canvas.getContext("2d");
// //     canvas.width = img.naturalWidth;
// //     canvas.height = img.naturalHeight;

// //     context.drawImage(img, 0, 0);

// //     // Track memory usage
// //     const memUsage = (canvas.width * canvas.height * 4) / (1024 * 1024);
// //     setMemoryUsage(memUsage);

// //     // Process with column detection
// //     setProgress(20);
// //     const results = await processWithColumnDetection(canvas, columnMode);

// //     // Cleanup
// //     canvas.remove();
// //     setMemoryUsage(0);

// //     updateProcessingStats(1, true);

// //     return new Map([
// //       [
// //         1,
// //         {
// //           pageNum: 1,
// //           text: results.fullText,
// //           confidence: results.confidence,
// //           columnData: results.columns,
// //           processingMode: results.mode,
// //         },
// //       ],
// //     ]);
// //   } catch (error) {
// //     console.error("Error processing Hebrew sefer image:", error);
// //     updateProcessingStats(1, true);
// //     return new Map([
// //       [
// //         1,
// //         {
// //           pageNum: 1,
// //           text: `[Error processing image: ${error.message}]`,
// //           confidence: 0,
// //           columnData: [],
// //           processingMode: "error",
// //         },
// //       ],
// //     ]);
// //   }
// // };

// // // Parallel processing for Hebrew sefer pages with column detection
// // export const processParallelHebrewSefer = async (
// //   pdf,
// //   maxConcurrency = 3,
// //   columnMode = "auto",
// //   callbacks
// // ) => {
// //   const { storeIntermediateResults } = callbacks;
// //   const results = new Map();
// //   const semaphore = Array(maxConcurrency)
// //     .fill()
// //     .map(() => Promise.resolve());
// //   let semIndex = 0;

// //   const processPage = async (pageNum) => {
// //     await semaphore[semIndex];
// //     semaphore[semIndex] = processHebrewSeferPage(
// //       pdf,
// //       pageNum,
// //       columnMode,
// //       callbacks
// //     );
// //     const result = await semaphore[semIndex];
// //     results.set(pageNum, result);

// //     // Store intermediate results without showing final UI
// //     storeIntermediateResults(results);

// //     semIndex = (semIndex + 1) % maxConcurrency;
// //   };

// //   const promises = [];
// //   for (let i = 1; i <= pdf.numPages; i++) {
// //     promises.push(processPage(i));
// //   }

// //   await Promise.all(promises);
// //   return results;
// // };

// // // Chunked processing for Hebrew sefer pages with column detection
// // export const processChunkedHebrewSefer = async (
// //   pdf,
// //   chunkSize = 5,
// //   columnMode = "auto",
// //   callbacks
// // ) => {
// //   const { storeIntermediateResults, memoryUsage, forceMemoryCleanup } =
// //     callbacks;
// //   const results = new Map();
// //   const totalPages = pdf.numPages;

// //   for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
// //     const endPage = Math.min(startPage + chunkSize - 1, totalPages);

// //     console.log(
// //       `Processing Hebrew sefer chunk: pages ${startPage}-${endPage} with column mode: ${columnMode}`
// //     );

// //     // Check memory usage
// //     if (memoryUsage > 800) {
// //       console.log("Memory cleanup triggered...");
// //       await forceMemoryCleanup(callbacks.setMemoryUsage);
// //     }

// //     // Process chunk in parallel
// //     const chunkPromises = [];
// //     for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
// //       chunkPromises.push(
// //         processHebrewSeferPage(pdf, pageNum, columnMode, callbacks)
// //       );
// //     }

// //     try {
// //       const chunkResults = await Promise.all(chunkPromises);
// //       chunkResults.forEach((result) => {
// //         results.set(result.pageNum, result);
// //       });

// //       // Store intermediate results without showing final UI
// //       storeIntermediateResults(results);

// //       // Save intermediate results every 20 pages
// //       if (startPage % 20 === 1 && results.size > 0) {
// //         console.log(
// //           `Saved intermediate Hebrew sefer results: ${results.size} pages`
// //         );
// //       }
// //     } catch (error) {
// //       console.error(
// //         `Hebrew sefer chunk ${startPage}-${endPage} failed:`,
// //         error
// //       );
// //     }
// //   }

// //   return results;
// // };
