# User Manual: Enterprise PDF Pro (Windows Offline Edition)

## Table of Contents
1. [Introduction](#1-introduction)
2. [Installation & Deployment](#2-installation--deployment)
3. [Document Navigation & Viewing](#3-document-navigation--viewing)
4. [Editing Existing PDF Text](#4-editing-existing-pdf-text)
5. [Inserting Images & Graphics](#5-inserting-images--graphics)
6. [Annotations, Shapes & Stamps](#6-annotations-shapes--stamps)
7. [Organizing, Merging & Splitting Pages](#7-organizing-merging--splitting-pages)
8. [Electronic Signatures & Digital Seals](#8-electronic-signatures--digital-seals)
9. [Fillable PDF Form Designer](#9-fillable-pdf-form-designer)
10. [Document Security & Permanent Redaction](#10-document-security--permanent-redaction)
11. [Offline OCR Engine](#11-offline-ocr-engine)
12. [Conversion Center](#12-conversion-center)
13. [Local AI Assistant (Ollama)](#13-local-ai-assistant-ollama)
14. [User Profiles & Role-Based Access Control](#14-user-profiles--role-based-access-control)

---

## 1. Introduction
Enterprise PDF Pro is a high-performance Windows desktop application designed to provide commercial-grade PDF editing without relying on external cloud APIs or online servers. All document processing, text recognition, and cryptographic operations occur locally on your PC.

---

## 2. Installation & Deployment

### Edition A: Windows Installer
1. Double-click `EnterprisePDFPro-Setup-x64.exe`.
2. Follow the setup wizard to choose your installation directory (default: `%LOCALAPPDATA%\Programs\EnterprisePDFPro`).
3. Select whether to create a Desktop Shortcut and Start Menu folder.
4. Click **Install Now**. The installer will extract application resources, register the uninstaller in Windows Control Panel, and launch the editor.

### Edition B: Portable Edition
1. Copy `EnterprisePDFPro-Portable-x64.exe` to any folder or USB flash drive.
2. Double-click to run immediately without requiring administrative privileges.
3. All document files, cache, and audit history will be stored in the adjacent `data` directory.

---

## 3. Document Navigation & Viewing
- **Opening a File**: Click **Open** on the top toolbar or dashboard to select any `.pdf` document.
- **Zoom Controls**: Use the Zoom In (`+`), Zoom Out (`-`), or percentage dropdown to adjust page scale from 40% to 300%.
- **Pan Tool**: Click the **Pan** (Hand icon) tool on the toolbar to click and drag across the page.
- **Thumbnails Strip**: View all page previews in the left sidebar. Click any thumbnail to jump to that page.

---

## 4. Editing Existing PDF Text
1. Click the **Edit Existing Text** button on the top toolbar.
2. Hover over any text block on the document page; an interactive bounding box will highlight the detected line.
3. Click the text block to open the in-place editor.
4. Modify the text, font family (`Helvetica`, `Times New Roman`, or `Courier`), font size, color, and formatting (Bold, Italic, Underline) in the right-hand **Properties Inspector**.
5. Press **Enter** or click outside to confirm. When you click **Save**, Enterprise PDF Pro performs authentic content whiteout and draws the modified text.

---

## 5. Inserting Images & Graphics
1. Click **Insert Image** on the toolbar.
2. Select any local `PNG` or `JPG` image file.
3. The image appears on the page. Use the cursor to drag, position, or resize the image.
4. Adjust opacity and rotation in the right-hand Properties Inspector.

---

## 6. Annotations, Shapes & Stamps
- **Highlight**: Click the **Highlight** tool and drag across text to apply an translucent yellow, green, or custom color highlight.
- **Freehand Ink**: Click **Draw** to write or sketch on the canvas with adjustable stroke width and color.
- **Shapes**: Add Rectangles, Circles, Lines, and Arrows.
- **Stamps**: Click **Stamps ▾** to apply enterprise status stamps such as `APPROVED`, `CONFIDENTIAL`, `DRAFT`, `REVISED`, `FINAL`, `SIGN HERE`, or `VOID`. Each stamp includes a timestamp and author attribution.

---

## 7. Organizing, Merging & Splitting Pages
- Navigate to the **Organize** tab on the left navigation bar.
- **Reorder**: Drag thumbnails or click **Move Up / Move Down** to arrange pages.
- **Rotate**: Select one or multiple pages and click **Rotate Selected (90°)**.
- **Merge**: Click **Merge PDF** to append another local PDF file into the active document.
- **Split**: Click **Split All Pages** to export every page as an individual standalone PDF file.
- **Extract**: Select checkboxes on pages and click **Extract Pages** to export just those pages into a new file.

---

## 8. Electronic Signatures & Digital Seals
1. Open the **Signatures** tab.
2. Choose from three signature creation modes:
   - **Draw**: Sketch your signature on the touchpad or mouse canvas.
   - **Type**: Enter your full name to render an elegant cursive script signature.
   - **Import**: Upload an image of your signature.
3. Check the **Attach SHA-256 Digital Verification Seal** option to append a tamper-evident cryptographic verification badge.
4. Click **Insert on Page** to place the signature directly onto the active PDF.

---

## 9. Fillable PDF Form Designer
- Switch to the **Sign & Forms** category on the toolbar.
- Place interactive **Text Fields**, **Checkboxes**, **Dropdown Selectors**, and **Date Fields** anywhere on the page.
- Configure default values and field labels in the right-hand Properties Inspector.
- Fill values directly inside the document and click **Save** to persist values or flatten them into the PDF stream.

---

## 10. Document Security & Permanent Redaction
- **Permanent Redaction**: Select the **Permanent Redaction** tool and draw a box over confidential text or images. Upon saving, underlying content is burned with solid black pixels and text vectors are destroyed.
- **Password Protection**: Open the **Security** tab and enter a **Document Open Password** and **Owner Password**.
- **Permissions**: Restrict high-resolution printing, copy/paste extraction, and content modification.

---

## 11. Offline OCR Engine
1. Navigate to the **OCR Tools** tab.
2. Choose your language (`English`, `German`, `French`, `Spanish`, `Chinese`).
3. Select whether to process the current page or all pages.
4. Click **Run Local OCR**. The bundled Tesseract engine will preprocess the canvas, detect orientation, extract all text with confidence metrics, and let you copy or download the text.

---

## 12. Conversion Center
- Open the **Convert** tab.
- **PDF to Images**: Convert PDF pages into crisp PNG or JPEG images.
- **PDF to Text / HTML**: Extract full structured text and HTML documents.
- **Images to PDF**: Combine multiple PNG/JPG files into a multi-page PDF.
- **Text to PDF**: Automatically typeset and paginate `.txt` documents into A4 PDF files.

---

## 13. Local AI Assistant (Ollama)
- Click the **Local AI** button in the lower-left sidebar.
- If Ollama is installed on your computer (`http://localhost:11434`), Enterprise PDF Pro connects to local models (e.g. `llama3`, `mistral`).
- Use quick buttons for **Executive Summary**, **Key Dates**, or **Contract Obligations**.
- Zero data leaves your computer.

---

## 14. User Profiles & Role-Based Access Control
- Enterprise PDF Pro provides local role-based access control with four profiles:
  - **Administrator**: Full system access, security management, and audit log inspection.
  - **Manager**: Document organization, review, and export.
  - **Editor**: Text editing, annotations, forms, and signatures.
  - **Viewer**: Read-only document inspection.
- Switch active profiles from the **Security** tab. All actions are logged to the tamper-evident audit history.
