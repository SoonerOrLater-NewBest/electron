/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import Datastore from 'nedb';
import { parse } from 'url';
import { stringify } from 'querystring';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

// Initialize NeDB database for caching
const cacheDb = new Datastore<{ key: string; data: any }>({
  filename: path.join(app.getPath('userData'), 'cache.db'),
  autoload: true,
});

/**
 * Generate a unique cache key using URL path and query parameters.
 */
const generateCacheKey = (
  pathname: string,
  queryParams: Record<string, string>,
): string => {
  const queryString = stringify(queryParams);
  return `${pathname}?${queryString}`;
};

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL('http://www.baidu.com');

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();

  // Intercept and cache network requests
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const { url: requestUrl } = details;
    const parsedUrl = parse(requestUrl, true);

    if (!parsedUrl.pathname) {
      callback({});
      return;
    }

    const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);

    // Check for cached data
    cacheDb.findOne({ key: cacheKey }, (err, doc) => {
      if (err) {
        console.error('Cache query error:', err);
        callback({});
        return;
      }

      if (doc) {
        console.log('Cache hit:', requestUrl);
        // Respond with cached data
        callback({ cancel: true });

        // Send cached data back to renderer process
        if (mainWindow) {
          mainWindow.webContents.send('cached-response', doc.data);
        }
      } else {
        console.log('Cache miss:', requestUrl);
        callback({});

        session.defaultSession.webRequest.onCompleted((responseDetails) => {
          if (
            responseDetails.url === requestUrl &&
            responseDetails.statusCode === 200
          ) {
            // Cache response data
            const responseBody = Buffer.from(
              responseDetails.uploadData?.[0]?.bytes || '',
            );
            cacheDb.insert(
              {
                key: cacheKey,
                data: {
                  headers: responseDetails.responseHeaders,
                  body: responseBody.toString(),
                },
              },
              (insertErr) => {
                if (insertErr) {
                  console.error('Failed to cache response:', insertErr);
                } else {
                  console.log('Response cached for:', requestUrl);
                }
              },
            );
          }
        });
      }
    });
  });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
