// src/utils/rashiOcrUtils.js
// Enhanced Hebrew OCR with Rashi script detection and processing

// Rashi script detection utilities
export const detectScriptType = (canvas, context) => {
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Convert to grayscale and create binary image
  const grayData = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grayData[i / 4] = gray < 128 ? 0 : 255; // Binary threshold
  }

  // Analyze character patterns to detect script type
  const features = analyzeTextFeatures(grayData, canvas.width, canvas.height);

  return classifyScriptType(features);
};

const analyzeTextFeatures = (binaryData, width, height) => {
  const features = {
    avgCharWidth: 0,
    avgCharHeight: 0,
    densityRatio: 0,
    angularityScore: 0,
    strokeThickness: 0,
    hasSerifs: false,
    aspectRatio: 0,
  };

  // Find connected components (characters)
  const components = findConnectedComponents(binaryData, width, height);

  if (components.length === 0) return features;

  let totalWidth = 0,
    totalHeight = 0,
    totalDensity = 0,
    totalAngularity = 0;

  components.forEach((component) => {
    const bounds = component.bounds;
    const charWidth = bounds.right - bounds.left;
    const charHeight = bounds.bottom - bounds.top;

    totalWidth += charWidth;
    totalHeight += charHeight;

    // Calculate density (pixel density within bounding box)
    const area = charWidth * charHeight;
    const density = component.pixels.length / area;
    totalDensity += density;

    // Calculate angularity (measure of sharp corners vs curves)
    const angularity = calculateAngularity(component.pixels, bounds);
    totalAngularity += angularity;
  });

  features.avgCharWidth = totalWidth / components.length;
  features.avgCharHeight = totalHeight / components.length;
  features.densityRatio = totalDensity / components.length;
  features.angularityScore = totalAngularity / components.length;
  features.aspectRatio = features.avgCharWidth / features.avgCharHeight;

  return features;
};

const findConnectedComponents = (binaryData, width, height) => {
  const visited = new Array(width * height).fill(false);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (!visited[index] && binaryData[index] === 0) {
        // Dark pixel (text)
        const component = floodFill(binaryData, visited, width, height, x, y);
        if (component.pixels.length > 20) {
          // Filter out noise
          components.push(component);
        }
      }
    }
  }

  return components;
};

const floodFill = (binaryData, visited, width, height, startX, startY) => {
  const stack = [{ x: startX, y: startY }];
  const pixels = [];
  let bounds = {
    left: startX,
    right: startX,
    top: startY,
    bottom: startY,
  };

  while (stack.length > 0) {
    const { x, y } = stack.pop();
    const index = y * width + x;

    if (
      x < 0 ||
      x >= width ||
      y < 0 ||
      y >= height ||
      visited[index] ||
      binaryData[index] !== 0
    ) {
      continue;
    }

    visited[index] = true;
    pixels.push({ x, y });

    // Update bounds
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);

    // Add neighbors
    stack.push(
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    );
  }

  return { pixels, bounds };
};

const calculateAngularity = (pixels, bounds) => {
  // Simple angularity measure based on edge direction changes
  let angularityScore = 0;
  const edgePixels = pixels.filter((p) => isEdgePixel(p, pixels));

  for (let i = 1; i < edgePixels.length - 1; i++) {
    const prev = edgePixels[i - 1];
    const curr = edgePixels[i];
    const next = edgePixels[i + 1];

    const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    const angleDiff = Math.abs(angle1 - angle2);

    if (angleDiff > Math.PI / 4) {
      // Sharp turn
      angularityScore++;
    }
  }

  return edgePixels.length > 0 ? angularityScore / edgePixels.length : 0;
};

const isEdgePixel = (pixel, allPixels) => {
  // Check if pixel is on the edge of the character
  const neighbors = [
    { x: pixel.x + 1, y: pixel.y },
    { x: pixel.x - 1, y: pixel.y },
    { x: pixel.x, y: pixel.y + 1 },
    { x: pixel.x, y: pixel.y - 1 },
  ];

  return neighbors.some(
    (neighbor) =>
      !allPixels.some((p) => p.x === neighbor.x && p.y === neighbor.y)
  );
};

const classifyScriptType = (features) => {
  // Classification based on typical characteristics
  const {
    avgCharWidth,
    avgCharHeight,
    densityRatio,
    angularityScore,
    aspectRatio,
  } = features;

  // Rashi script characteristics:
  // - More angular (higher angularity score)
  // - Generally narrower characters
  // - Higher density due to thicker strokes
  // - Different aspect ratio

  let score = {
    regular: 0,
    rashi: 0,
    mixed: 0,
  };

  // Angularity check (Rashi is more angular)
  if (angularityScore > 0.3) {
    score.rashi += 2;
  } else {
    score.regular += 1;
  }

  // Aspect ratio check (Rashi tends to be narrower)
  if (aspectRatio < 0.7) {
    score.rashi += 1;
  } else if (aspectRatio > 1.0) {
    score.regular += 1;
  }

  // Density check (Rashi has different stroke characteristics)
  if (densityRatio > 0.4) {
    score.rashi += 1;
  } else {
    score.regular += 1;
  }

  // Character size patterns
  if (avgCharHeight > avgCharWidth * 1.5) {
    score.rashi += 1;
  }

  // Determine result
  const maxScore = Math.max(score.regular, score.rashi);
  const confidence = maxScore / (score.regular + score.rashi);

  if (Math.abs(score.regular - score.rashi) < 1) {
    return {
      scriptType: "mixed",
      confidence: 0.5,
      scores: score,
    };
  } else if (score.rashi > score.regular) {
    return {
      scriptType: "rashi",
      confidence: confidence,
      scores: score,
    };
  } else {
    return {
      scriptType: "regular",
      confidence: confidence,
      scores: score,
    };
  }
};

// Enhanced OCR preprocessing for different script types
export const preprocessForScriptType = (
  canvas,
  context,
  scriptType = "regular"
) => {
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  switch (scriptType) {
    case "rashi":
      return preprocessForRashi(canvas, context, data);
    case "mixed":
      return preprocessForMixed(canvas, context, data);
    default:
      return preprocessForRegularHebrew(canvas, context, data);
  }
};

const preprocessForRashi = (canvas, context, data) => {
  // Rashi-specific preprocessing
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // More aggressive binarization for Rashi (which can be lighter)
    const threshold = 140; // Higher threshold for Rashi
    let enhanced = gray < threshold ? 0 : 255;

    // Apply morphological operations to connect broken characters
    // (Rashi script often has thin connections that break easily)

    // Enhanced contrast specifically for angular characters
    const contrast = 1.4;
    const brightness = 15;
    enhanced = Math.min(255, Math.max(0, enhanced * contrast + brightness));

    data[i] = enhanced; // Red
    data[i + 1] = enhanced; // Green
    data[i + 2] = enhanced; // Blue
  }

  context.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);

  // Apply slight blur to smooth angular edges for better OCR
  context.filter = "blur(0.5px)";
  context.drawImage(canvas, 0, 0);
  context.filter = "none";

  return canvas.toDataURL("image/png", 1.0);
};

const preprocessForMixed = (canvas, context, data) => {
  // Balanced preprocessing for mixed scripts
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Adaptive threshold
    const threshold = 130;
    let enhanced = gray < threshold ? 0 : 255;

    // Moderate enhancement
    const contrast = 1.3;
    const brightness = 12;
    enhanced = Math.min(255, Math.max(0, enhanced * contrast + brightness));

    data[i] = enhanced;
    data[i + 1] = enhanced;
    data[i + 2] = enhanced;
  }

  context.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  return canvas.toDataURL("image/png", 1.0);
};

const preprocessForRegularHebrew = (canvas, context, data) => {
  // Standard Hebrew preprocessing (existing logic)
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    const threshold = 128;
    let enhanced = gray < threshold ? 0 : 255;

    const contrast = 1.3;
    const brightness = 10;
    enhanced = Math.min(255, Math.max(0, enhanced * contrast + brightness));

    data[i] = enhanced;
    data[i + 1] = enhanced;
    data[i + 2] = enhanced;
  }

  context.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  return canvas.toDataURL("image/webp", 0.85);
};

// Enhanced OCR with script-specific parameters
export const performScriptAwareOCR = async (imageData, scriptType, logger) => {
  const baseConfig = {
    logger: logger,
    tessedit_pageseg_mode: "6", // Single uniform block
  };

  let ocrConfig;

  switch (scriptType) {
    case "rashi":
      ocrConfig = {
        ...baseConfig,
        // Rashi-specific Tesseract parameters
        tessedit_char_whitelist: "", // Allow all Hebrew characters
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6", // Single block
        // Note: Tesseract doesn't have native Rashi support,
        // so we use Hebrew with adjusted parameters
      };
      break;

    case "mixed":
      ocrConfig = {
        ...baseConfig,
        tessedit_pageseg_mode: "3", // Fully automatic page segmentation
        preserve_interword_spaces: "1",
      };
      break;

    default: // regular
      ocrConfig = {
        ...baseConfig,
        tessedit_pageseg_mode: "6",
      };
  }

  // For now, use Hebrew language model as base
  // In the future, this could be enhanced with custom Rashi models
  return await window.Tesseract.recognize(imageData, "heb", ocrConfig);
};

// Auto-detect and process with appropriate method
export const processWithScriptDetection = async (
  canvas,
  context,
  columnMode = "auto"
) => {
  console.log("🔍 Detecting Hebrew script type...");

  // Detect script type
  const scriptDetection = detectScriptType(canvas, context);
  console.log(
    `📝 Detected script: ${scriptDetection.scriptType} (confidence: ${(
      scriptDetection.confidence * 100
    ).toFixed(1)}%)`
  );

  // Preprocess based on detected script
  const optimizedImage = preprocessForScriptType(
    canvas,
    context,
    scriptDetection.scriptType
  );

  // Perform OCR with script-aware parameters
  const result = await performScriptAwareOCR(
    optimizedImage,
    scriptDetection.scriptType,
    (m) => {
      if (m.status === "recognizing text" && m.progress) {
        console.log(
          `${scriptDetection.scriptType} OCR progress: ${(
            m.progress * 100
          ).toFixed(1)}%`
        );
      }
    }
  );

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    scriptType: scriptDetection.scriptType,
    scriptConfidence: scriptDetection.confidence,
    scriptScores: scriptDetection.scores,
  };
};
