// Desktop wrapper (Windows installer via electron-builder).
// Loads the production build. Not part of the web app; `npm start` ignores this file.
//
// The page is served from file://, so its origin is "null". Start Ollama with
// OLLAMA_ORIGINS=* (and the image engine with --cors-allow-origins=*) so it
// accepts requests from the desktop app. See README.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#0a0a0f",
    title: "AISynth",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "..", "build", "index.html"));
  // Links that leave the app open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
