// src/utils/constants.js

export const supportedImageTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
];

export const hebrewFonts = {
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

export const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Frank+Ruhl+Libre:wght@400;700&family=Rubik:wght@400;700&family=Heebo:wght@400;700&display=swap";

export const TESSERACT_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
export const PDFJS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
export const PDFJS_WORKER_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
