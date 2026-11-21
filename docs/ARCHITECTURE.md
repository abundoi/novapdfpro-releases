# Technical Architecture: Enterprise PDF Pro (Windows Offline Edition)

## 1. System Overview
**Enterprise PDF Pro** is a standalone, offline-first desktop software application for Windows 10 and Windows 11 (64-bit). It provides commercial-grade PDF editing, optical character recognition (OCR), electronic & digital signatures, multi-format conversion, and role-based access control without any external internet or cloud dependencies.

```
+-------------------------------------------------------------------------+
|                  Enterprise PDF Pro Desktop Application                 |
+------------------------------------+------------------------------------+
|         Native Host / OS           |      Electron Runtime (Chromium)   |
|   - EnterprisePDFPro.exe           |   - Multi-process architecture     |
|   - EnterprisePDFPro-Setup-x64.exe |   - Context isolation & sandboxing |
|   - EnterprisePDFPro-Portable.exe  |   - Restrictive Content Security   |
+------------------------------------+------------------------------------+
|                          Electron Main Process                          |
|   - Window Lifecycle               - Secure IPC Handlers                |
|   - Native Windows File Dialogs    - Atomic Storage & Recovery          |
|   - Local Ollama AI Client (11434) - Local Audit Trail Logger           |
+-------------------------------------------------------------------------+
|                       Preload Security Bridge                           |
|   - contextBridge.exposeInMainWorld('electronAPI', { ... })             |
+-------------------------------------------------------------------------+
|                        React Renderer Layer                             |
|   - Acrobat-style Ribbon Toolbar   - Multi-page Thumbnails Strip        |
|   - Properties Inspector           - Interactive Canvas Viewport        |
|   - Zustand Reactive Store         - Local Offline Database Layer       |
+------------------------------------+------------------------------------+
|                     Core Offline Engine Adapters                        |
|   - PDF.js: High-DPI Rendering     - PDF-Lib: In-place PDF Manipulation|
|   - Tesseract.js: Offline OCR      - Local Converter: PNG/JPG/TXT/HTML  |
|   - SQLite / Local Storage DB      - SHA-256 Digital Verification Seal  |
+-------------------------------------------------------------------------+
```

---

## 2. Process Separation & Security Boundary
- **Main Process (`electron/main.cjs`)**:
  - Direct access to Windows filesystem, local directories (`%LOCALAPPDATA%\EnterprisePDFPro`), and native dialogs.
  - Enforces atomic save operations (writes to `.tmp.[timestamp]` first, creates recoverable backup `.bak.[timestamp]`, then atomically renames).
- **Preload Script (`electron/preload.cjs`)**:
  - Strictly exposes whitelisted asynchronous functions via `contextBridge`.
  - Disallows arbitrary Node.js primitive execution from renderer.
- **Renderer (`src/App.tsx`, `src/components/*`)**:
  - Clean React 19 + TypeScript + Vite + Tailwind CSS architecture.
  - Operates completely offline with CSP allowing only `'self'`, `'unsafe-inline'`, and local origins (`localhost:*`, `127.0.0.1:*`).

---

## 3. PDF Editing Engine Adapter
PDF manipulation is performed using `pdfEngine.ts`:
- **Existing Text Modification**:
  - PDF text objects are extracted with exact bounding boxes, font heights, and transformations from PDF.js.
  - When modified, the original text is authentic-sanitized via an opaque whiteout underlay and replacement text is drawn in-stream using standard embedded fonts (`Helvetica`, `TimesRoman`, `Courier`) with specified font size, style (bold/italic/underline), color, and alignment.
- **Image Manipulation**:
  - Embedded PNG and JPEG image byte streams are scaled, rotated, positioned, and rendered with custom opacity.
- **Annotations & Vector Drawing**:
  - Highlights, underlines, strikethroughs, freehand ink vectors, rectangles, circles, lines, arrows, sticky notes, and stamps (e.g. APPROVED, CONFIDENTIAL) are composited directly into the PDF content stream.
- **Permanent Redaction**:
  - Solid opaque burn-in rectangles physically occlude underlying content, destroying underlying pixels and text vectors upon save.
- **Security & Watermarks**:
  - Watermarks with customizable text, angle, opacity, and font are drawn across all pages.
  - Pagination headers and footers (`Page {page} of {total}`) are computed dynamically.
  - Password encryption options guard against unauthorized viewing, printing, or copying.

---

## 4. Local Database & Storage Architecture
All application states, documents, versions, and security audit logs are managed locally:
- **Default Storage Directories**:
  - `%LOCALAPPDATA%\EnterprisePDFPro\documents`
  - `%LOCALAPPDATA%\EnterprisePDFPro\backups`
  - `%LOCALAPPDATA%\EnterprisePDFPro\thumbnails`
  - `%LOCALAPPDATA%\EnterprisePDFPro\logs`
- **Portable Edition**:
  - Automatically checks for `./data` or `portable.flag`. All files, databases, and logs remain in the portable folder, enabling self-contained USB execution.
- **Audit Logs**:
  - Every document open, save, deletion, user profile switch, and security permission change is written to a local tamper-evident log table with timestamp, user ID, role, and details.
