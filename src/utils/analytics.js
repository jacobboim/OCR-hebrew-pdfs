// src/utils/analytics.js - Enhanced version

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
  trackEvent("text_action", {
    // Standard parameters
    action: action,
    file_type: fileType,
    text_length: textLength,

    // Custom dimensions
    custom_action_type: action.toUpperCase(),
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
    event_category: "Text Management",
    event_label: `${action}_${fileType}`,
    value: Math.min(textLength, 100000), // Cap for GA4
  });
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
};

// // src/utils/analytics.js

// export const trackEvent = (eventName, parameters = {}) => {
//   if (window.gtag) {
//     window.gtag("event", eventName, parameters);
//   }
// };

// export const trackFileUpload = (fileType, fileSizeMB) => {
//   trackEvent("file_upload", {
//     file_type: fileType,
//     file_size_mb: fileSizeMB,
//     event_category: "File Management",
//   });
// };

// export const trackExtraction = (
//   fileType,
//   pageCount,
//   processingTime,
//   success = true
// ) => {
//   trackEvent(success ? "extraction_success" : "extraction_error", {
//     file_type: fileType,
//     page_count: pageCount,
//     processing_time_seconds: processingTime,
//     event_category: "Text Extraction",
//   });
// };

// export const trackTextAction = (action, fileType, textLength) => {
//   trackEvent("text_action", {
//     action: action, // 'copy' or 'download'
//     file_type: fileType,
//     text_length: textLength,
//     event_category: "Text Management",
//   });
// };
