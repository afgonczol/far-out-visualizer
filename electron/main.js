// Electron wrapper: hears ALL system audio via WASAPI loopback (no tab-sharing picker),
// and keeps rendering even when other windows cover it.
const { app, BrowserWindow, session, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');

// Windows pauses rendering for windows that are fully covered; a visualizer must not.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });   // 'loopback' = everything the PC is playing
    }).catch(() => callback({}));
  }, { useSystemPicker: false });

  const win = new BrowserWindow({
    width: 1280, height: 720, backgroundColor: '#000000', autoHideMenuBar: true, title: 'Far Out',
    webPreferences: { backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // simulate a user gesture so getDisplayMedia is allowed to start on its own
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('window.__autoStart && window.__autoStart()', true).catch(() => {});
  });

  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
