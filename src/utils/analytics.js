// src/utils/analytics.js - Enhanced version with Claude tracking

// Helper function to categorize file sizes
const getFileSizeCategory = (fileSizeMB) => {
  if (fileSizeMB < 1) return "Small (< 1MB)";
  if (fileSizeMB < 5) return "Medium (1-5MB)";
  if (fileSizeMB < 20) return "Large (5-20MB)";
  return "Very Large (> 20MB)";
};

// Helper function to categorize page counts
const getPageCountRange = (pageCount) => {
  if (pageCount === 1) return "Single Page";
  if (pageCount <= 5) return "2-5 Pages";
  if (pageCount <= 20) return "6-20 Pages";
  if (pageCount <= 50) return "21-50 Pages";
  return "50+ Pages";
};

// Helper function to categorize processing time
const getProcessingTimeRange = (seconds) => {
  if (seconds < 10) return "Very Fast (< 10s)";
  if (seconds < 30) return "Fast (10-30s)";
  if (seconds < 60) return "Medium (30s-1m)";
  if (seconds < 300) return "Slow (1-5m)";
  return "Very Slow (> 5m)";
};

export const trackEvent = (eventName, parameters = {}) => {
  if (window.gtag) {
    // Add timestamp for better tracking
    const enhancedParams = {
      ...parameters,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop",
    };

    console.log("Analytics Event:", eventName, enhancedParams);
    window.gtag("event", eventName, enhancedParams);
  }
};

export const trackFileUpload = (fileType, fileSizeMB) => {
  trackEvent("file_upload", {
    // Standard parameters
    file_type: fileType,
    file_size_mb: parseFloat(fileSizeMB.toFixed(2)),

    // Custom dimensions for better segmentation
    custom_file_type: fileType.toUpperCase(),
    custom_file_size_category: getFileSizeCategory(fileSizeMB),

    // GA4 standard parameters
    event_category: "File Management",
    event_label: `${fileType}_upload`,
    value: Math.round(fileSizeMB * 100), // Convert to integer for GA4
  });

  // Also track as a conversion for funnel analysis
  trackEvent("begin_checkout", {
    currency: "USD",
    value: 1,
    items: [
      {
        item_id: `file_${fileType}`,
        item_name: `${fileType.toUpperCase()} File Upload`,
        item_category: "File Processing",
        quantity: 1,
        price: 1,
      },
    ],
  });
};

export const trackExtraction = (
  fileType,
  pageCount,
  processingTime,
  success = true
) => {
  const eventName = success ? "extraction_success" : "extraction_error";

  trackEvent(eventName, {
    // Standard parameters
    file_type: fileType,
    page_count: pageCount,
    processing_time_seconds: parseFloat(processingTime.toFixed(2)),
    success: success,

    // Custom dimensions
    custom_file_type: fileType.toUpperCase(),
    custom_page_count_range: getPageCountRange(pageCount),
    custom_processing_time_range: getProcessingTimeRange(processingTime),
    custom_success_status: success ? "Success" : "Error",

    // GA4 standard parameters
    event_category: "Text Extraction",
    event_label: `${fileType}_${success ? "success" : "error"}`,
    value: success ? pageCount : 0,

    // Performance metrics
    pages_per_second:
      pageCount > 0 ? parseFloat((pageCount / processingTime).toFixed(2)) : 0,
  });

  // Track as conversion if successful
  if (success) {
    trackEvent("purchase", {
      transaction_id: `extraction_${Date.now()}`,
      currency: "USD",
      value: pageCount,
      items: [
        {
          item_id: `extraction_${fileType}`,
          item_name: `${fileType.toUpperCase()} Text Extraction`,
          item_category: "Successful Extraction",
          quantity: pageCount,
          price: 1,
        },
      ],
    });
  }
};

export const trackTextAction = (action, fileType, textLength) => {
  // Handle different action types including Claude-specific ones
  const actionCategory = action.includes("claude")
    ? "Claude Integration"
    : "Text Management";
  const actionType = action.toUpperCase();

  trackEvent("text_action", {
    // Standard parameters
    action: action,
    file_type: fileType,
    text_length: textLength,

    // Custom dimensions
    custom_action_type: actionType,
    custom_file_type: fileType.toUpperCase(),
    custom_text_length_range:
      textLength < 1000
        ? "Short"
        : textLength < 5000
        ? "Medium"
        : textLength < 20000
        ? "Long"
        : "Very Long",

    // GA4 standard parameters
    event_category: actionCategory,
    event_label: `${action}_${fileType}`,
    value: Math.min(textLength, 100000), // Cap for GA4
  });

  // Special tracking for Claude-related actions
  if (action === "copy_for_claude") {
    trackEvent("claude_integration_start", {
      file_type: fileType,
      text_length: textLength,
      event_category: "Claude Integration",
      step: "copy_prompt",
    });
  }
};

// Track user engagement and session quality
export const trackUserEngagement = (sessionDuration, actionsCount) => {
  trackEvent("user_engagement", {
    session_duration_seconds: sessionDuration,
    actions_count: actionsCount,
    engagement_level:
      actionsCount > 3 ? "High" : actionsCount > 1 ? "Medium" : "Low",
    event_category: "User Behavior",
  });
};

// Track errors for debugging
export const trackError = (errorType, errorMessage, context = {}) => {
  trackEvent("app_error", {
    error_type: errorType,
    error_message: errorMessage.substring(0, 100), // Limit length
    error_context: JSON.stringify(context).substring(0, 100),
    event_category: "Errors",
  });
};

// Track performance metrics
export const trackPerformance = (metric, value, context = {}) => {
  trackEvent("performance_metric", {
    metric_name: metric,
    metric_value: value,
    context: JSON.stringify(context).substring(0, 100),
    event_category: "Performance",
  });

  // Special handling for Claude-related performance metrics
  if (metric === "claude_opened") {
    trackEvent("claude_integration_continue", {
      event_category: "Claude Integration",
      step: "open_claude",
      has_extracted_text: context.hasExtractedText || false,
    });
  }

  if (metric === "claude_copy_action") {
    trackEvent("claude_integration_progress", {
      event_category: "Claude Integration",
      step: "copy_completed",
      text_length: value,
      file_type: context.fileType,
    });
  }
};

// NEW: Track Claude workflow completion (call this if user returns with translation)
export const trackClaudeWorkflowComplete = (
  originalLength,
  translatedLength,
  fileType
) => {
  trackEvent("claude_integration_complete", {
    original_text_length: originalLength,
    translated_text_length: translatedLength,
    file_type: fileType,
    success: true,
    event_category: "Claude Integration",
    step: "workflow_complete",
  });
};

// NEW: Track Claude workflow abandonment (call this if appropriate)
export const trackClaudeWorkflowAbandoned = (step, fileType, textLength) => {
  trackEvent("claude_integration_abandoned", {
    abandoned_step: step, // "copy_prompt", "open_claude", or "return_translation"
    file_type: fileType,
    text_length: textLength,
    event_category: "Claude Integration",
  });
};
