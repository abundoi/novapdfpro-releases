
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Require the actual production main script so all IPC handlers and setup run
require('./electron/main.cjs');

app.whenReady().then(() => {
  setTimeout(async () => {
    try {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        console.error('FAIL: No BrowserWindow opened');
        app.exit(1);
        return;
      }
      const win = windows[0];
      const title = win.getTitle();
      console.log('Window Title:', title);

      // Verify DOM content
      const innerHtml = await win.webContents.executeJavaScript('document.getElementById("root").innerHTML');
      console.log('Root HTML length:', innerHtml.length);

      // Check key UI components
      const hasHeader = await win.webContents.executeJavaScript('document.body.innerText.includes("NovaPDFPro")');
      console.log('Contains App Name:', hasHeader);

      if (innerHtml.length > 50 && hasHeader) {
        console.log('PASS: End-to-end Electron Desktop App launch verified successfully!');
        app.exit(0);
      } else {
        console.error('FAIL: UI did not render properly');
        app.exit(1);
      }
    } catch (err) {
      console.error('Error during verification:', err);
      app.exit(1);
    }
  }, 2500);
});
