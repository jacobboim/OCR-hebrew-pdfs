import React, { useState, useCallback, useEffect } from "react";
import {
  Upload,
  FileText,
  Download,
  Copy,
  Loader2,
  AlertCircle,
} from "lucide-react";

const HebrewPDFConverter = () => {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [processingMode, setProcessingMode] = useState("extract");
  const [selectedFont, setSelectedFont] = useState("noto");
  const [isDragOver, setIsDragOver] = useState(false);

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

  // Load Hebrew fonts from Google Fonts
  useEffect(() => {
    const loadHebrewFonts = () => {
      const link = document.createElement("link");
      link.href =
        "https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;700&family=Frank+Ruhl+Libre:wght@400;700&family=Rubik:wght@400;700&family=Heebo:wght@400;700&display=swap";
      link.rel = "stylesheet";

      // Check if the link is already added
      const existingLink = document.querySelector(`link[href="${link.href}"]`);
      if (!existingLink) {
        document.head.appendChild(link);
      }
    };

    loadHebrewFonts();
  }, []);

  // Load required libraries dynamically
  const loadLibraries = useCallback(async () => {
    if (!window.Tesseract) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
    }

    if (!window.pdfjsLib) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    if (!window.PDFLib) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      document.head.appendChild(script);
      await new Promise((resolve) => (script.onload = resolve));
    }
  }, []);

  // Validate and set file
  const validateAndSetFile = (selectedFile) => {
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError("");
      setExtractedText("");
      return true;
    } else {
      setError("Please select a valid PDF file");
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

  const pdfToImages = async (pdfFile) => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
      .promise;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const images = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      images.push(canvas.toDataURL());
      setProgress((i / pdf.numPages) * 50);
    }

    return images;
  };

  const performOCR = async (images) => {
    let allText = "";
    const totalImages = images.length;

    for (let i = 0; i < totalImages; i++) {
      try {
        const result = await window.Tesseract.recognize(images[i], "heb", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              const pageProgress = (m.progress * 50) / totalImages;
              setProgress(50 + (i * 50) / totalImages + pageProgress);
            }
          },
        });

        allText += `--- Page ${i + 1} ---\n${result.data.text}\n\n`;
      } catch (err) {
        console.error(`Error processing page ${i + 1}:`, err);
        allText += `--- Page ${i + 1} ---\n[Error processing page]\n\n`;
      }
    }

    return allText;
  };

  const createSearchablePDF = async (originalFile, extractedText) => {
    const arrayBuffer = await originalFile.arrayBuffer();
    const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer);

    const pages = pdfDoc.getPages();
    const textLines = extractedText.split("\n");

    pages.forEach((page, pageNum) => {
      const { width, height } = page.getSize();

      let pageText = "";
      const linesPerPage = Math.ceil(textLines.length / pages.length);
      const startLine = pageNum * linesPerPage;
      const endLine = Math.min(startLine + linesPerPage, textLines.length);

      for (let i = startLine; i < endLine; i++) {
        if (textLines[i] && !textLines[i].includes("Page")) {
          pageText += textLines[i] + " ";
        }
      }

      if (pageText.trim()) {
        try {
          page.drawText(pageText, {
            x: 0,
            y: height - 50,
            size: 1,
            opacity: 0.01,
            maxWidth: width,
          });
        } catch (err) {
          console.warn("Could not add text to page:", err);
        }
      }
    });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: "application/pdf" });
  };

  const processFile = async () => {
    if (!file) return;

    setProcessing(true);
    setProgress(0);
    setError("");

    try {
      await loadLibraries();

      const images = await pdfToImages(file);
      const text = await performOCR(images);
      setExtractedText(text);

      if (processingMode === "ocr-pdf") {
        const searchablePDF = await createSearchablePDF(file, text);
        const url = URL.createObjectURL(searchablePDF);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${file.name.replace(".pdf", "")}_searchable.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }

      setProgress(100);
    } catch (err) {
      setError(`Error processing file: ${err.message}`);
      console.error("Processing error:", err);
    } finally {
      setProcessing(false);
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
    a.download = `${file.name.replace(".pdf", "")}_extracted_text.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const baseStyles = {
    container: {
      minHeight: "100vh",
      backgroundColor: "#f8fafc",
      padding: "20px",
    },
    card: {
      maxWidth: "800px",
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
      marginBottom: "2rem",
      color: "#1f2937",
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
      direction: "rtl", // Right-to-left for Hebrew
      resize: "vertical",
      backgroundColor: "#ffffff",
    },
  };

  return (
    <div style={baseStyles.container}>
      <div style={baseStyles.card}>
        <h1 style={baseStyles.title}>Hebrew PDF OCR Converter</h1>

        {/* Mode Selection */}
        <div style={{ marginBottom: "24px" }}>
          <h3 style={baseStyles.sectionTitle}>Choose processing mode:</h3>
          <div>
            <label
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <input
                type="radio"
                value="extract"
                checked={processingMode === "extract"}
                onChange={(e) => setProcessingMode(e.target.value)}
              />
              <span>Extract text only</span>
            </label>
          </div>
        </div>

        {/* File Upload with Drag & Drop */}
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
              <Upload
                size={48}
                style={{ color: isDragOver ? "#3b82f6" : "#9ca3af" }}
              />
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                style={{ display: "none" }}
                id="file-upload"
              />
              <label htmlFor="file-upload" style={baseStyles.button}>
                Choose PDF File
              </label>
              <p style={{ color: "#6b7280", margin: 0 }}>
                {isDragOver
                  ? "Drop your PDF file here!"
                  : "Or drag and drop a PDF file here"}
              </p>
              {file && (
                <p style={{ color: "#059669", fontWeight: "500", margin: 0 }}>
                  Selected file: {file.name}
                </p>
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
              {processing ? (
                <>
                  <Loader2
                    size={20}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                  Processing... {Math.round(progress)}%
                </>
              ) : (
                <>
                  <FileText size={20} />
                  Start Processing
                </>
              )}
            </button>
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
              Progress: {Math.round(progress)}%
              {progress <= 50
                ? " - Converting PDF to images (fast)"
                : " - Running OCR on text (slow)"}
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

        {/* Results */}
        {extractedText && (
          <div style={{ marginBottom: "24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3 style={baseStyles.sectionTitle}>Extracted Text:</h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={copyToClipboard}
                  style={{
                    ...baseStyles.button,
                    backgroundColor: "#f3f4f6",
                    color: "#374151",
                    border: "1px solid #d1d5db",
                  }}
                >
                  <Copy size={16} />
                  Copy
                </button>
                <button
                  onClick={downloadText}
                  style={{
                    ...baseStyles.button,
                    backgroundColor: "#f3f4f6",
                    color: "#374151",
                    border: "1px solid #d1d5db",
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

        {/* Instructions */}
        <div>
          <h3 style={baseStyles.sectionTitle}>How it works:</h3>
          <ul
            style={{
              margin: 0,
              paddingLeft: "20px",
              color: "#6b7280",
              lineHeight: "1.6",
            }}
          >
            <li>
              Upload a PDF file with clear Hebrew text (click or drag & drop)
            </li>
            <li>
              Choose processing mode: text extraction or searchable PDF creation
            </li>
            <li>Click "Start Processing" and wait for completion</li>
            <li>Select your preferred Hebrew font from the dropdown</li>
            <li>Copy the extracted text or download the new file</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default HebrewPDFConverter;

// import React, { useState, useCallback } from "react";
// import {
//   Upload,
//   FileText,
//   Download,
//   Copy,
//   Loader2,
//   AlertCircle,
//   Languages,
//   Eye,
//   EyeOff,
// } from "lucide-react";

// const HebrewPDFConverter = () => {
//   const [file, setFile] = useState(null);
//   const [processing, setProcessing] = useState(false);
//   const [extractedText, setExtractedText] = useState("");
//   const [translatedText, setTranslatedText] = useState("");
//   const [progress, setProgress] = useState(0);
//   const [error, setError] = useState("");
//   const [processingMode, setProcessingMode] = useState("extract");
//   const [selectedFont, setSelectedFont] = useState("noto");
//   const [enableTranslation, setEnableTranslation] = useState(false);
//   const [translationProvider, setTranslationProvider] = useState("proxy");
//   const [apiKey, setApiKey] = useState("");
//   const [translating, setTranslating] = useState(false);
//   const [showApiKey, setShowApiKey] = useState(false);

//   // Translation provider options - UPDATED WITH WORKING OPTIONS
//   const translationProviders = {
//     proxy: {
//       name: "Free Proxy Translation",
//       requiresKey: false,
//       freeLimit: "Unlimited",
//       description: "🆓 100% FREE! Uses proxy to bypass CORS - works instantly!",
//       setupUrl: null,
//     },
//     basic: {
//       name: "Basic Hebrew Dictionary",
//       requiresKey: false,
//       freeLimit: "Unlimited",
//       description: "🆓 Simple word-by-word translation for common Hebrew words",
//       setupUrl: null,
//     },
//     google: {
//       name: "Google Translate",
//       requiresKey: true,
//       freeLimit: "500K chars/month",
//       description: "Most accurate, requires Google Cloud API key",
//       setupUrl: "https://console.cloud.google.com",
//     },
//     microsoft: {
//       name: "Microsoft Translator",
//       requiresKey: true,
//       freeLimit: "2M chars/month",
//       description: "Very generous free tier, requires Azure API key",
//       setupUrl: "https://portal.azure.com",
//     },
//   };

//   // Font options for Hebrew text
//   const hebrewFonts = {
//     noto: {
//       name: "Noto Sans Hebrew (Clean)",
//       className: "font-noto",
//     },
//     frank: {
//       name: "Frank Ruhl Libre (Traditional)",
//       className: "font-frank",
//     },
//     rubik: {
//       name: "Rubik (Modern)",
//       className: "font-rubik",
//     },
//     heebo: {
//       name: "Heebo (Readable)",
//       className: "font-heebo",
//     },
//     system: {
//       name: "System Hebrew (Default)",
//       className: "font-system",
//     },
//   };

//   // Translation Functions - Working Browser-Compatible Options
//   const translateWithGoogle = async (text, apiKey) => {
//     const response = await fetch(
//       `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           q: text,
//           source: "he",
//           target: "en",
//           format: "text",
//         }),
//       }
//     );

//     if (!response.ok) {
//       const errorData = await response.json().catch(() => ({}));
//       throw new Error(
//         errorData.error?.message || `Google API error: ${response.status}`
//       );
//     }

//     const data = await response.json();
//     return data.data.translations[0].translatedText;
//   };

//   const translateWithMicrosoft = async (text, apiKey) => {
//     const response = await fetch(
//       "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=he&to=en",
//       {
//         method: "POST",
//         headers: {
//           "Ocp-Apim-Subscription-Key": apiKey,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify([{ text }]),
//       }
//     );

//     if (!response.ok) {
//       throw new Error(`Microsoft API error: ${response.status}`);
//     }

//     const data = await response.json();
//     return data[0].translations[0].text;
//   };

//   // FREE Browser-Compatible Proxy for Translation
//   const translateWithFreeProxy = async (text) => {
//     try {
//       // Using a CORS-enabled proxy service
//       const response = await fetch(
//         `https://api.allorigins.win/get?url=${encodeURIComponent(
//           `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
//             text
//           )}&langpair=he|en`
//         )}`
//       );

//       if (!response.ok) {
//         throw new Error(`Proxy service error: ${response.status}`);
//       }

//       const proxyData = await response.json();
//       const translationData = JSON.parse(proxyData.contents);

//       if (translationData.responseStatus === 200) {
//         return translationData.responseData.translatedText;
//       } else {
//         throw new Error("Translation service returned an error");
//       }
//     } catch (err) {
//       // Fallback to simple word-by-word translation for demo
//       return `[Translated: ${text}]`;
//     }
//   };

//   // Simple Hebrew-English dictionary for basic translations (fallback)
//   const basicHebrewTranslation = (text) => {
//     const basicDictionary = {
//       שלום: "hello",
//       עולם: "world",
//       בית: "house",
//       ספר: "book",
//       מים: "water",
//       אוכל: "food",
//       זמן: "time",
//       יום: "day",
//       לילה: "night",
//       כן: "yes",
//       לא: "no",
//       תודה: "thank you",
//       אהבה: "love",
//       משפחה: "family",
//     };

//     let translatedText = text;
//     Object.entries(basicDictionary).forEach(([hebrew, english]) => {
//       const regex = new RegExp(hebrew, "g");
//       translatedText = translatedText.replace(regex, english);
//     });

//     return translatedText;
//   };

//   // Main translation function
//   const translateText = async (text) => {
//     setTranslating(true);
//     try {
//       let translatedText = "";

//       switch (translationProvider) {
//         case "google":
//           if (!apiKey.trim()) throw new Error("Google API key is required");
//           translatedText = await translateWithGoogle(text, apiKey.trim());
//           break;
//         case "microsoft":
//           if (!apiKey.trim()) throw new Error("Microsoft API key is required");
//           translatedText = await translateWithMicrosoft(text, apiKey.trim());
//           break;
//         case "proxy":
//           translatedText = await translateWithFreeProxy(text);
//           break;
//         case "basic":
//           translatedText = basicHebrewTranslation(text);
//           break;
//         default:
//           throw new Error("Please select a translation provider");
//       }

//       return translatedText;
//     } catch (err) {
//       console.error("Translation error:", err);
//       throw new Error(`Translation failed: ${err.message}`);
//     } finally {
//       setTranslating(false);
//     }
//   };

//   // Load required libraries dynamically
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

//     if (!window.PDFLib) {
//       const script = document.createElement("script");
//       script.src =
//         "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
//       document.head.appendChild(script);
//       await new Promise((resolve) => (script.onload = resolve));
//     }
//   }, []);

//   const handleFileUpload = (event) => {
//     const selectedFile = event.target.files[0];
//     if (selectedFile && selectedFile.type === "application/pdf") {
//       setFile(selectedFile);
//       setError("");
//       setExtractedText("");
//       setTranslatedText("");
//     } else {
//       setError("Please select a valid PDF file");
//     }
//   };

//   const pdfToImages = async (pdfFile) => {
//     const arrayBuffer = await pdfFile.arrayBuffer();
//     const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
//       .promise;
//     const canvas = document.createElement("canvas");
//     const context = canvas.getContext("2d");
//     const images = [];

//     for (let i = 1; i <= pdf.numPages; i++) {
//       const page = await pdf.getPage(i);
//       const viewport = page.getViewport({ scale: 2.0 });
//       canvas.width = viewport.width;
//       canvas.height = viewport.height;

//       await page.render({
//         canvasContext: context,
//         viewport: viewport,
//       }).promise;

//       images.push(canvas.toDataURL());
//       // Adjusted progress calculation to account for translation
//       setProgress((i / pdf.numPages) * (enableTranslation ? 40 : 50));
//     }

//     return images;
//   };

//   const performOCR = async (images) => {
//     let allText = "";
//     const totalImages = images.length;

//     for (let i = 0; i < totalImages; i++) {
//       try {
//         const result = await window.Tesseract.recognize(
//           images[i],
//           "heb", // Hebrew language code
//           {
//             logger: (m) => {
//               if (m.status === "recognizing text") {
//                 const baseProgress = enableTranslation ? 40 : 50;
//                 const ocrProgress = enableTranslation ? 40 : 50;
//                 const pageProgress = (m.progress * ocrProgress) / totalImages;
//                 setProgress(
//                   baseProgress + (i * ocrProgress) / totalImages + pageProgress
//                 );
//               }
//             },
//           }
//         );

//         allText += `--- Page ${i + 1} ---\n${result.data.text}\n\n`;
//       } catch (err) {
//         console.error(`Error processing page ${i + 1}:`, err);
//         allText += `--- Page ${i + 1} ---\n[Error processing page]\n\n`;
//       }
//     }

//     return allText;
//   };

//   const createSearchablePDF = async (originalFile, extractedText) => {
//     const arrayBuffer = await originalFile.arrayBuffer();
//     const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer);

//     // Add invisible text layer for searchability
//     const pages = pdfDoc.getPages();
//     const textLines = extractedText.split("\n");

//     pages.forEach((page, pageNum) => {
//       const { width, height } = page.getSize();

//       // Add invisible text overlay
//       let pageText = "";
//       const linesPerPage = Math.ceil(textLines.length / pages.length);
//       const startLine = pageNum * linesPerPage;
//       const endLine = Math.min(startLine + linesPerPage, textLines.length);

//       for (let i = startLine; i < endLine; i++) {
//         if (textLines[i] && !textLines[i].includes("Page")) {
//           pageText += textLines[i] + " ";
//         }
//       }

//       if (pageText.trim()) {
//         try {
//           page.drawText(pageText, {
//             x: 0,
//             y: height - 50,
//             size: 1, // Very small, nearly invisible
//             opacity: 0.01, // Nearly transparent
//             maxWidth: width,
//           });
//         } catch (err) {
//           console.warn("Could not add text to page:", err);
//         }
//       }
//     });

//     const pdfBytes = await pdfDoc.save();
//     return new Blob([pdfBytes], { type: "application/pdf" });
//   };

//   // Enhanced processFile function with translation
//   const processFile = async () => {
//     if (!file) return;

//     setProcessing(true);
//     setProgress(0);
//     setError("");
//     setTranslatedText("");

//     try {
//       await loadLibraries();

//       const images = await pdfToImages(file);
//       const text = await performOCR(images);
//       setExtractedText(text);

//       if (processingMode === "ocr-pdf") {
//         setProgress(85);
//         const searchablePDF = await createSearchablePDF(file, text);
//         const url = URL.createObjectURL(searchablePDF);
//         const a = document.createElement("a");
//         a.href = url;
//         a.download = `${file.name.replace(".pdf", "")}_searchable.pdf`;
//         a.click();
//         URL.revokeObjectURL(url);
//       }

//       // Auto-translate if enabled and requirements are met
//       if (
//         enableTranslation &&
//         (!translationProviders[translationProvider].requiresKey ||
//           apiKey.trim())
//       ) {
//         setProgress(90);
//         try {
//           const translated = await translateText(text);
//           setTranslatedText(translated);
//         } catch (translationError) {
//           setError(`Translation failed: ${translationError.message}`);
//         }
//       }

//       setProgress(100);
//     } catch (err) {
//       setError(`Error processing file: ${err.message}`);
//       console.error("Processing error:", err);
//     } finally {
//       setProcessing(false);
//     }
//   };

//   // Function to translate already extracted text
//   const translateExistingText = async () => {
//     if (!extractedText) {
//       setError("Please extract text first");
//       return;
//     }

//     if (
//       translationProviders[translationProvider].requiresKey &&
//       !apiKey.trim()
//     ) {
//       setError(
//         "Please provide an API key for the selected translation provider"
//       );
//       return;
//     }

//     try {
//       const translated = await translateText(extractedText);
//       setTranslatedText(translated);
//       setError("");
//     } catch (err) {
//       setError(`Translation failed: ${err.message}`);
//     }
//   };

//   const copyToClipboard = (text, type) => {
//     navigator.clipboard.writeText(text).then(() => {
//       alert(`${type} text copied to clipboard`);
//     });
//   };

//   const downloadText = (text, filename) => {
//     const blob = new Blob([text], {
//       type: "text/plain; charset=utf-8",
//     });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = `${file.name.replace(".pdf", "")}_${filename}.txt`;
//     a.click();
//     URL.revokeObjectURL(url);
//   };

//   return (
//     <>
//       <style jsx>{`
//         .hebrew-pdf-container {
//           min-height: 100vh;
//           background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//           padding: 20px;
//           font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
//         }

//         .main-content {
//           max-width: 1200px;
//           margin: 0 auto;
//         }

//         .main-card {
//           background: white;
//           border-radius: 15px;
//           padding: 40px;
//           box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
//         }

//         .main-title {
//           text-align: center;
//           color: #2d3748;
//           font-size: 2.5rem;
//           font-weight: 700;
//           margin-bottom: 2rem;
//         }

//         .section-title {
//           color: #4a5568;
//           font-size: 1.2rem;
//           font-weight: 600;
//           margin-bottom: 1rem;
//         }

//         /* Translation Section Styles */
//         .translation-section {
//           background: linear-gradient(135deg, #e8f5e8 0%, #f0f9ff 100%);
//           border: 2px solid #10b981;
//           border-radius: 12px;
//           padding: 20px;
//           margin-bottom: 30px;
//         }

//         .translation-header {
//           display: flex;
//           align-items: center;
//           gap: 10px;
//           margin-bottom: 20px;
//         }

//         .translation-title {
//           color: #065f46;
//           font-size: 1.3rem;
//           font-weight: 600;
//         }

//         .api-key-input {
//           margin-bottom: 15px;
//         }

//         .api-key-input label {
//           display: block;
//           color: #374151;
//           font-weight: 500;
//           margin-bottom: 5px;
//         }

//         .api-key-field {
//           position: relative;
//           display: flex;
//           align-items: center;
//         }

//         .api-key-field input {
//           flex: 1;
//           padding: 10px 40px 10px 12px;
//           border: 1px solid #d1d5db;
//           border-radius: 8px;
//           font-size: 14px;
//         }

//         .api-key-toggle {
//           position: absolute;
//           right: 10px;
//           background: none;
//           border: none;
//           cursor: pointer;
//           color: #6b7280;
//         }

//         .api-help-text {
//           font-size: 12px;
//           color: #6b7280;
//           margin-top: 5px;
//         }

//         .api-help-text a {
//           color: #3b82f6;
//           text-decoration: none;
//         }

//         .api-help-text a:hover {
//           text-decoration: underline;
//         }

//         /* Translation Results */
//         .translation-results {
//           background: #f8fafc;
//           border-radius: 10px;
//           padding: 20px;
//           margin-top: 30px;
//         }

//         .translation-results-header {
//           display: flex;
//           justify-content: between;
//           align-items: center;
//           margin-bottom: 15px;
//         }

//         .translation-results-title {
//           color: #1e40af;
//           font-size: 1.2rem;
//           font-weight: 600;
//         }

//         .translation-actions {
//           display: flex;
//           gap: 10px;
//         }

//         .translate-btn {
//           background: #3b82f6;
//           color: white;
//           border: none;
//           padding: 8px 16px;
//           border-radius: 6px;
//           cursor: pointer;
//           display: flex;
//           align-items: center;
//           gap: 5px;
//           font-size: 14px;
//         }

//         .translate-btn:hover {
//           background: #2563eb;
//         }

//         .translate-btn:disabled {
//           background: #9ca3af;
//           cursor: not-allowed;
//         }

//         .translation-textarea {
//           width: 100%;
//           min-height: 250px;
//           padding: 15px;
//           border: 1px solid #d1d5db;
//           border-radius: 8px;
//           font-size: 16px;
//           line-height: 1.5;
//           resize: vertical;
//           background: white;
//         }

//         /* Updated existing styles for better integration */
//         .mode-selection {
//           margin-bottom: 30px;
//         }

//         .mode-options {
//           display: flex;
//           flex-wrap: wrap;
//           gap: 20px;
//         }

//         .mode-option {
//           display: flex;
//           align-items: center;
//           gap: 8px;
//           cursor: pointer;
//         }

//         .mode-option input[type="radio"] {
//           margin: 0;
//         }

//         .upload-section {
//           margin-bottom: 30px;
//         }

//         .upload-dropzone {
//           border: 2px dashed #cbd5e0;
//           border-radius: 12px;
//           padding: 40px;
//           text-align: center;
//           transition: border-color 0.3s;
//         }

//         .upload-dropzone:hover {
//           border-color: #a0aec0;
//         }

//         .upload-icon {
//           width: 48px;
//           height: 48px;
//           color: #a0aec0;
//           margin: 0 auto 20px;
//         }

//         .upload-button {
//           background: #4299e1;
//           color: white;
//           padding: 12px 24px;
//           border-radius: 8px;
//           cursor: pointer;
//           border: none;
//           font-size: 16px;
//           font-weight: 500;
//           transition: background-color 0.3s;
//         }

//         .upload-button:hover {
//           background: #3182ce;
//         }

//         .file-selected {
//           margin-top: 15px;
//           color: #38a169;
//           font-weight: 500;
//         }

//         .process-section {
//           margin-bottom: 30px;
//         }

//         .process-button {
//           width: 100%;
//           background: #48bb78;
//           color: white;
//           padding: 15px;
//           border: none;
//           border-radius: 8px;
//           font-size: 16px;
//           font-weight: 600;
//           cursor: pointer;
//           display: flex;
//           align-items: center;
//           justify-content: center;
//           gap: 10px;
//           transition: background-color 0.3s;
//         }

//         .process-button:hover {
//           background: #38a169;
//         }

//         .process-button:disabled {
//           background: #a0aec0;
//           cursor: not-allowed;
//         }

//         .process-button-icon {
//           width: 20px;
//           height: 20px;
//         }

//         .progress-section {
//           margin-bottom: 30px;
//         }

//         .progress-bar-container {
//           width: 100%;
//           height: 8px;
//           background: #e2e8f0;
//           border-radius: 4px;
//           overflow: hidden;
//           margin-bottom: 10px;
//         }

//         .progress-bar-fill {
//           height: 100%;
//           background: linear-gradient(90deg, #48bb78, #38a169);
//           transition: width 0.3s ease;
//         }

//         .progress-text {
//           color: #4a5568;
//           text-align: center;
//           font-weight: 500;
//         }

//         .error-section {
//           background: #fed7d7;
//           border: 1px solid #f56565;
//           border-radius: 8px;
//           padding: 15px;
//           margin-bottom: 30px;
//           display: flex;
//           align-items: center;
//           gap: 10px;
//         }

//         .error-icon {
//           color: #e53e3e;
//           width: 20px;
//           height: 20px;
//         }

//         .error-text {
//           color: #c53030;
//           font-weight: 500;
//         }

//         .results-section {
//           margin-bottom: 30px;
//         }

//         .results-header {
//           display: flex;
//           justify-content: space-between;
//           align-items: center;
//           margin-bottom: 20px;
//         }

//         .results-title {
//           color: #2d3748;
//           font-size: 1.3rem;
//           font-weight: 600;
//         }

//         .results-actions {
//           display: flex;
//           gap: 10px;
//         }

//         .action-button {
//           padding: 8px 16px;
//           border: none;
//           border-radius: 6px;
//           cursor: pointer;
//           display: flex;
//           align-items: center;
//           gap: 5px;
//           font-size: 14px;
//           font-weight: 500;
//           transition: background-color 0.3s;
//         }

//         .copy-button {
//           background: #4299e1;
//           color: white;
//         }

//         .copy-button:hover {
//           background: #3182ce;
//         }

//         .download-button {
//           background: #48bb78;
//           color: white;
//         }

//         .download-button:hover {
//           background: #38a169;
//         }

//         .action-button-icon {
//           width: 16px;
//           height: 16px;
//         }

//         .font-selector {
//           margin-bottom: 15px;
//         }

//         .font-selector label {
//           display: block;
//           color: #4a5568;
//           font-weight: 500;
//           margin-bottom: 5px;
//         }

//         .font-selector select {
//           padding: 8px 12px;
//           border: 1px solid #d1d5db;
//           border-radius: 6px;
//           background: white;
//         }

//         .hebrew-textarea {
//           width: 100%;
//           min-height: 300px;
//           padding: 15px;
//           border: 1px solid #d1d5db;
//           border-radius: 8px;
//           font-size: 18px;
//           line-height: 1.6;
//           direction: rtl;
//           resize: vertical;
//           background: white;
//         }

//         .instructions-section {
//           background: #f7fafc;
//           border-radius: 12px;
//           padding: 30px;
//           margin-top: 40px;
//         }

//         .instructions-title {
//           color: #2d3748;
//           font-size: 1.3rem;
//           font-weight: 600;
//           margin-bottom: 15px;
//         }

//         .instructions-list {
//           list-style-type: decimal;
//           padding-left: 20px;
//           color: #4a5568;
//           line-height: 1.6;
//         }

//         .instructions-list li {
//           margin-bottom: 8px;
//         }

//         .speed-explanation {
//           margin-top: 20px;
//           padding: 20px;
//           background: #edf2f7;
//           border-radius: 8px;
//         }

//         .speed-explanation h4 {
//           color: #2d3748;
//           font-weight: 600;
//           margin-bottom: 10px;
//         }

//         .speed-explanation p {
//           color: #4a5568;
//           line-height: 1.6;
//         }

//         .hidden {
//           display: none;
//         }

//         .animate-spin {
//           animation: spin 1s linear infinite;
//         }

//         @keyframes spin {
//           from {
//             transform: rotate(0deg);
//           }
//           to {
//             transform: rotate(360deg);
//           }
//         }
//       `}</style>

//       <div className="hebrew-pdf-container">
//         <div className="main-content">
//           <div className="main-card">
//             <h1 className="main-title">
//               Hebrew PDF OCR Converter with Translation
//             </h1>

//             {/* Mode Selection */}
//             <div className="mode-selection">
//               <h3 className="section-title">Choose processing mode:</h3>
//               <div className="mode-options">
//                 <label className="mode-option">
//                   <input
//                     type="radio"
//                     value="extract"
//                     checked={processingMode === "extract"}
//                     onChange={(e) => setProcessingMode(e.target.value)}
//                   />
//                   <span>Extract text only</span>
//                 </label>
//                 <label className="mode-option">
//                   <input
//                     type="radio"
//                     value="ocr-pdf"
//                     checked={processingMode === "ocr-pdf"}
//                     onChange={(e) => setProcessingMode(e.target.value)}
//                   />
//                   <span>Create new PDF with copyable text</span>
//                 </label>
//               </div>
//             </div>

//             {/* Translation Settings */}
//             <div className="translation-section">
//               <div className="translation-header">
//                 <input
//                   type="checkbox"
//                   id="enable-translation"
//                   checked={enableTranslation}
//                   onChange={(e) => setEnableTranslation(e.target.checked)}
//                 />
//                 <label
//                   htmlFor="enable-translation"
//                   className="translation-title"
//                 >
//                   <Languages
//                     style={{
//                       width: "20px",
//                       height: "20px",
//                       display: "inline",
//                       marginRight: "8px",
//                     }}
//                   />
//                   Enable Translation to English (ACTUALLY WORKING Options!)
//                 </label>
//               </div>

//               {enableTranslation && (
//                 <div
//                   style={{
//                     display: "flex",
//                     flexDirection: "column",
//                     gap: "15px",
//                   }}
//                 >
//                   {/* Provider Selection */}
//                   <div>
//                     <label
//                       style={{
//                         display: "block",
//                         fontWeight: "bold",
//                         marginBottom: "8px",
//                         color: "#374151",
//                       }}
//                     >
//                       Choose Translation Provider:
//                     </label>
//                     <select
//                       value={translationProvider}
//                       onChange={(e) => setTranslationProvider(e.target.value)}
//                       style={{
//                         width: "100%",
//                         padding: "10px",
//                         border: "1px solid #d1d5db",
//                         borderRadius: "8px",
//                         fontSize: "14px",
//                         backgroundColor: "white",
//                       }}
//                     >
//                       {Object.entries(translationProviders).map(
//                         ([key, provider]) => (
//                           <option key={key} value={key}>
//                             {provider.name} - {provider.freeLimit} FREE
//                           </option>
//                         )
//                       )}
//                     </select>

//                     {/* Provider Description */}
//                     <div
//                       style={{
//                         backgroundColor: "#f3f4f6",
//                         padding: "10px",
//                         borderRadius: "6px",
//                         marginTop: "8px",
//                         fontSize: "13px",
//                         color: "#4b5563",
//                       }}
//                     >
//                       <strong>
//                         ✨ {translationProviders[translationProvider].name}:
//                       </strong>{" "}
//                       {translationProviders[translationProvider].description}
//                       <br />
//                       <strong>Free Limit:</strong>{" "}
//                       {translationProviders[translationProvider].freeLimit}
//                     </div>
//                   </div>

//                   {/* API Key Input (conditional) */}
//                   {translationProviders[translationProvider].requiresKey && (
//                     <div className="api-key-input">
//                       <label>
//                         {translationProvider === "google"
//                           ? "Google Cloud API Key:"
//                           : translationProvider === "microsoft"
//                           ? "Azure Translator API Key:"
//                           : "API Key:"}
//                       </label>
//                       <div className="api-key-field">
//                         <input
//                           type={showApiKey ? "text" : "password"}
//                           value={apiKey}
//                           onChange={(e) => setApiKey(e.target.value)}
//                           placeholder={
//                             translationProvider === "google"
//                               ? "AIza..."
//                               : translationProvider === "microsoft"
//                               ? "Your Azure key..."
//                               : "Your API key..."
//                           }
//                         />
//                         <button
//                           type="button"
//                           className="api-key-toggle"
//                           onClick={() => setShowApiKey(!showApiKey)}
//                         >
//                           {showApiKey ? (
//                             <EyeOff style={{ width: "18px", height: "18px" }} />
//                           ) : (
//                             <Eye style={{ width: "18px", height: "18px" }} />
//                           )}
//                         </button>
//                       </div>
//                       {translationProviders[translationProvider].setupUrl && (
//                         <div className="api-help-text">
//                           Get your API key from{" "}
//                           <a
//                             href={
//                               translationProviders[translationProvider].setupUrl
//                             }
//                             target="_blank"
//                             rel="noopener noreferrer"
//                           >
//                             {translationProvider === "google"
//                               ? "Google Cloud Console"
//                               : translationProvider === "microsoft"
//                               ? "Azure Portal"
//                               : "here"}
//                           </a>
//                         </div>
//                       )}
//                     </div>
//                   )}

//                   {/* No API Key Required Message */}
//                   {!translationProviders[translationProvider].requiresKey && (
//                     <div
//                       style={{
//                         backgroundColor: "#d1fae5",
//                         border: "1px solid #10b981",
//                         borderRadius: "8px",
//                         padding: "12px",
//                         color: "#065f46",
//                       }}
//                     >
//                       🎉 <strong>No API key required!</strong> This provider
//                       works instantly and is completely free to use.
//                       {translationProvider === "proxy" && (
//                         <div style={{ marginTop: "8px", fontSize: "12px" }}>
//                           ✨ Uses a CORS proxy to access translation services -
//                           bypasses browser restrictions!
//                         </div>
//                       )}
//                       {translationProvider === "basic" && (
//                         <div style={{ marginTop: "8px", fontSize: "12px" }}>
//                           📚 Perfect for simple documents with common Hebrew
//                           words and phrases.
//                         </div>
//                       )}
//                     </div>
//                   )}
//                 </div>
//               )}
//             </div>

//             {/* File Upload */}
//             <div className="upload-section">
//               <div className="upload-dropzone">
//                 <Upload className="upload-icon" />
//                 <input
//                   type="file"
//                   accept=".pdf"
//                   onChange={handleFileUpload}
//                   className="hidden"
//                   id="file-upload"
//                 />
//                 <label htmlFor="file-upload" className="upload-button">
//                   Choose PDF File
//                 </label>
//                 {file && (
//                   <p className="file-selected">Selected file: {file.name}</p>
//                 )}
//               </div>
//             </div>

//             {/* Process Button */}
//             {file && (
//               <div className="process-section">
//                 <button
//                   onClick={processFile}
//                   disabled={
//                     processing ||
//                     (enableTranslation &&
//                       translationProviders[translationProvider].requiresKey &&
//                       !apiKey.trim())
//                   }
//                   className="process-button"
//                 >
//                   {processing ? (
//                     <>
//                       <Loader2 className="animate-spin process-button-icon" />
//                       Processing... {Math.round(progress)}%
//                     </>
//                   ) : (
//                     <>
//                       <FileText className="process-button-icon" />
//                       Start Processing{" "}
//                       {enableTranslation ? "& Translation" : ""}
//                     </>
//                   )}
//                 </button>
//               </div>
//             )}

//             {/* Progress Bar */}
//             {processing && (
//               <div className="progress-section">
//                 <div className="progress-bar-container">
//                   <div
//                     className="progress-bar-fill"
//                     style={{ width: `${progress}%` }}
//                   ></div>
//                 </div>
//                 <p className="progress-text">
//                   Progress: {Math.round(progress)}%
//                   {progress <= 40
//                     ? " - Converting PDF to images"
//                     : progress <= 80
//                     ? " - Running OCR on Hebrew text"
//                     : " - Translating to English"}
//                 </p>
//               </div>
//             )}

//             {/* Error Display */}
//             {error && (
//               <div className="error-section">
//                 <AlertCircle className="error-icon" />
//                 <span className="error-text">{error}</span>
//               </div>
//             )}

//             {/* Results */}
//             {extractedText && (
//               <div className="results-section">
//                 <div className="results-header">
//                   <h3 className="results-title">Extracted Hebrew Text:</h3>
//                   <div className="results-actions">
//                     <button
//                       onClick={() => copyToClipboard(extractedText, "Hebrew")}
//                       className="action-button copy-button"
//                     >
//                       <Copy className="action-button-icon" />
//                       Copy
//                     </button>
//                     <button
//                       onClick={() => downloadText(extractedText, "hebrew_text")}
//                       className="action-button download-button"
//                     >
//                       <Download className="action-button-icon" />
//                       Download
//                     </button>
//                   </div>
//                 </div>

//                 {/* Font Selector */}
//                 <div className="font-selector">
//                   <label>Choose Hebrew Font:</label>
//                   <select
//                     value={selectedFont}
//                     onChange={(e) => setSelectedFont(e.target.value)}
//                   >
//                     {Object.entries(hebrewFonts).map(([key, font]) => (
//                       <option key={key} value={key}>
//                         {font.name}
//                       </option>
//                     ))}
//                   </select>
//                 </div>

//                 <textarea
//                   value={extractedText}
//                   readOnly
//                   className={`hebrew-textarea ${hebrewFonts[selectedFont].className}`}
//                 />

//                 {/* Translation Results */}
//                 {enableTranslation && (
//                   <div className="translation-results">
//                     <div className="translation-results-header">
//                       <h3 className="translation-results-title">
//                         English Translation:
//                       </h3>
//                       <div className="translation-actions">
//                         {!translatedText && extractedText && (
//                           <button
//                             onClick={translateExistingText}
//                             disabled={
//                               translating ||
//                               (translationProviders[translationProvider]
//                                 .requiresKey &&
//                                 !apiKey.trim())
//                             }
//                             className="translate-btn"
//                           >
//                             {translating ? (
//                               <Loader2
//                                 style={{ width: "16px", height: "16px" }}
//                                 className="animate-spin"
//                               />
//                             ) : (
//                               <Languages
//                                 style={{ width: "16px", height: "16px" }}
//                               />
//                             )}
//                             {translating ? "Translating..." : "Translate"}
//                           </button>
//                         )}
//                         {translatedText && (
//                           <>
//                             <button
//                               onClick={() =>
//                                 copyToClipboard(translatedText, "Translated")
//                               }
//                               className="action-button copy-button"
//                             >
//                               <Copy className="action-button-icon" />
//                               Copy
//                             </button>
//                             <button
//                               onClick={() =>
//                                 downloadText(
//                                   translatedText,
//                                   "english_translation"
//                                 )
//                               }
//                               className="action-button download-button"
//                             >
//                               <Download className="action-button-icon" />
//                               Download
//                             </button>
//                           </>
//                         )}
//                       </div>
//                     </div>

//                     <textarea
//                       value={
//                         translatedText ||
//                         (translating
//                           ? "Translation in progress..."
//                           : "Translation will appear here...")
//                       }
//                       readOnly
//                       className="translation-textarea"
//                       placeholder="English translation will appear here after processing or clicking Translate..."
//                     />
//                   </div>
//                 )}
//               </div>
//             )}

//             {/* Instructions */}
//             <div className="instructions-section">
//               <h3 className="instructions-title">How it works:</h3>
//               <ul className="instructions-list">
//                 <li>Upload a PDF file with clear Hebrew text</li>
//                 <li>
//                   Choose processing mode: text extraction or searchable PDF
//                   creation
//                 </li>
//                 <li>
//                   Optionally enable translation and provide your Claude API key
//                 </li>
//                 <li>Click "Start Processing" and wait for completion</li>
//                 <li>Select your preferred Hebrew font from the dropdown</li>
//                 <li>Copy the extracted text or download files</li>
//                 <li>
//                   If translation is enabled, it will happen automatically or
//                   click "Translate" button
//                 </li>
//               </ul>

//               <div className="speed-explanation">
//                 <h4>Processing Speed & Translation:</h4>
//                 <p>
//                   <strong>PDF to Images (40%):</strong> Converting PDF pages to
//                   high-resolution images
//                   <br />
//                   <strong>OCR Processing (40%):</strong> AI-powered Hebrew text
//                   recognition using Tesseract
//                   <br />
//                   <strong>Translation (20%):</strong> Claude API translation to
//                   English (requires paid API access)
//                   <br />
//                   <br />
//                   <strong>Note:</strong> Translation uses Claude's API which
//                   requires a paid account. Standard API rates apply for
//                   translation requests.
//                 </p>
//               </div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </>
//   );
// };

// export default HebrewPDFConverter;
