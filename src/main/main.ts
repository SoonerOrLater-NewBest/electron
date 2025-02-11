import path from 'path';
import { app, BrowserWindow, session, protocol } from 'electron';
import fs from 'fs';
import { parse } from 'url';
import crypto from 'crypto';

let mainWindow: BrowserWindow | null = null;

// **1. 缓存目录**
const CACHE_DIR = path.join(app.getPath('userData'), 'image_cache');

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`📁 Created image cache directory: ${CACHE_DIR}`);
}

// **2. 生成唯一 cache key**
const generateCacheKey = (url: string) => {
  return crypto.createHash('md5').update(url).digest('hex') + path.extname(url);
};

// **3. Electron 窗口**
const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webSecurity: false, // **调试时可禁用安全策略**
    },
  });

  mainWindow.loadURL('https://www.baidu.com');

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      console.error('❌ Navigation failed:', validatedURL, errorDescription);
    },
  );

  // **注册 file:// 协议**
  protocol.registerFileProtocol('file', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('file:///', ''));
    console.log(`📄 Serving local file: ${filePath}`);
    callback({ path: filePath });
  });

  // **4. 拦截并缓存图片**
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const { url, resourceType } = details;

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        callback({});
        return;
      }

      // **仅拦截图片请求**
      if (
        resourceType === 'image' ||
        /\.(png|jpe?g|gif|svg|webp)$/i.test(url)
      ) {
        const cacheKey = generateCacheKey(url);
        const cachePath = path.join(CACHE_DIR, cacheKey);

        if (fs.existsSync(cachePath)) {
          console.log(`✅ Cache HIT for image: ${url}`);
          callback({ cancel: true, redirectURL: `file://${cachePath}` });
          return;
        } else {
          console.log(`🚀 Cache MISS for image: ${url}`);
        }
      }

      callback({});
    },
  );

  // **5. 在请求完成后缓存图片**
  session.defaultSession.webRequest.onCompleted(
    { urls: ['*://*/*'] },
    async (details) => {
      const { url, statusCode, responseHeaders, resourceType } = details;

      if (!url || statusCode !== 200) return;

      // **只缓存图片**
      if (
        resourceType === 'image' ||
        /\.(png|jpe?g|gif|svg|webp)$/i.test(url)
      ) {
        const cacheKey = generateCacheKey(url);
        const cachePath = path.join(CACHE_DIR, cacheKey);

        // **如果文件已存在，则不重复下载**
        if (fs.existsSync(cachePath)) {
          console.log(`🔹 Image already cached, skipping download: ${url}`);
          return;
        }

        console.log(`⬇️ Fetching and caching image: ${url}`);

        try {
          const res = await fetch(url);
          const buffer = await res.arrayBuffer();
          fs.writeFileSync(cachePath, Buffer.from(buffer));
          console.log(`✅ Image cached at: ${cachePath}`);
        } catch (error) {
          console.error(`❌ Failed to cache image ${url}:`, error);
        }
      }
    },
  );
};

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
