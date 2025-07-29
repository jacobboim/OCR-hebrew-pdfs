// src/utils/fileUtils.js
import { supportedImageTypes } from "./constants.js";
import { trackFileUpload } from "./analytics.js";

export const validateAndSetFile = (selectedFile, callbacks) => {
  const {
    setFile,
    setFileType,
    setError,
    setExtractedText,
    setPageResults,
    setIntermediateResults,
    setProcessingComplete,
  } = callbacks;

  if (!selectedFile) {
    setError("Please select a file");
    return false;
  }

  const isPdf = selectedFile.type === "application/pdf";
  const isImage = supportedImageTypes.includes(selectedFile.type);

  if (isPdf || isImage) {
    const newFileType = isPdf ? "pdf" : "image";
    const fileSizeMB = selectedFile.size / (1024 * 1024);

    setFile(selectedFile);
    setFileType(newFileType);
    setError("");
    setExtractedText("");
    setPageResults(new Map());
    setIntermediateResults(new Map());
    setProcessingComplete(false);

    // Track file upload
    trackFileUpload(newFileType, fileSizeMB);

    return true;
  } else {
    setError(
      "Please select a valid PDF file or image (JPG, PNG, WebP, BMP, TIFF, GIF)"
    );
    return false;
  }
};

export const createDragDropHandlers = (setIsDragOver, onFileSelect) => {
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
      onFileSelect(files[0]);
    }
  };

  return {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
};

export const getAcceptedFileTypes = () => {
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

export const downloadTextFile = (text, fileName) => {
  const blob = new Blob([text], {
    type: "text/plain; charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cleanFileName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension
  a.download = `${cleanFileName}_extracted_text.txt`;
  a.click();
  URL.revokeObjectURL(url);
};
