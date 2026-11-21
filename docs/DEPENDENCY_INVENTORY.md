# Third-Party Dependency & Licensing Inventory: Enterprise PDF Pro

This document details all third-party libraries, engines, and runtimes utilized in Enterprise PDF Pro. Every component has been evaluated for commercial distribution compliance. **Zero AGPL or copyleft licensed libraries are included in this distribution.**

---

## 1. Production Runtime Dependencies

| Package | Version | License | Commercial Permissibility | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **pdf-lib** | `1.17.1` | MIT | Permissive (Free for commercial use) | In-place PDF creation, text modification, image embed, form fields, page rotation, merge, split, encryption |
| **pdfjs-dist** | `3.11.174` | Apache-2.0 | Permissive (Free for commercial use) | High-DPI canvas rendering of PDF pages, viewport geometry, text layer extraction |
| **tesseract.js** | `5.1.1` | Apache-2.0 | Permissive (Free for commercial use) | Offline Optical Character Recognition (OCR), client-side WebAssembly worker |
| **sql.js** | `1.12.0` | MIT | Permissive (Free for commercial use) | Pure WebAssembly SQLite database engine for offline persistence |
| **react** | `19.2.4` | MIT | Permissive (Free for commercial use) | UI component runtime |
| **react-dom** | `19.2.4` | MIT | Permissive (Free for commercial use) | DOM rendering layer |
| **zustand** | `5.0.14` | MIT | Permissive (Free for commercial use) | High-performance reactive state management |
| **lucide-react** | `1.17.0` | ISC | Permissive (Free for commercial use) | Vector desktop icons |

---

## 2. Desktop Framework & Build Dependencies

| Tool / Library | Version | License | Commercial Permissibility | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **electron** | `33.2.0` | MIT | Permissive (Free for commercial use) | Cross-platform desktop window runtime, Chromium + Node.js |
| **vite** | `6.0.3` | MIT | Permissive (Free for commercial use) | High-speed ESM bundler and development server |
| **typescript** | `5.7.2` | Apache-2.0 | Permissive (Free for commercial use) | Static type analysis and compilation |
| **tailwindcss** | `3.4.17` | MIT | Permissive (Free for commercial use) | Utility-first CSS styling system |
| **Microsoft C# Compiler (csc.exe)** | .NET 4.0/4.8 | Microsoft Software License | Standard Windows OS component | Native Windows Setup wizard, portable launcher, and uninstaller compilation |

---

## 3. Licensing Compliance Notice
All included packages are licensed under **MIT**, **Apache-2.0**, or **ISC** licenses. These licenses grant full permission for commercial integration, distribution, modification, and private usage without requiring proprietary application source code disclosure (unlike GPL/AGPL).
