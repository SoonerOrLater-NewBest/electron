import path from 'path';
import { app, BrowserWindow, session, protocol } from 'electron';
import Datastore from 'nedb';
import { parse } from 'url';
import fs from 'fs';
import fetch from 'node-fetch'; // 确保你已经安装了 node-fetch 模块

let mainWindow: BrowserWindow | null = null;

// 初始化缓存数据库
const cacheDb = new Datastore<{
  key: string;
  data: { headers: Record<string, string>; body: string };
}>({
  filename: path.join(app.getPath('userData'), 'cache.db'),
  autoload: true,
});

// 缓存文件目录
const CACHE_DIR = path.join(app.getPath('userData'), 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 生成缓存键
const generateCacheKey = (url: string) => {
  return encodeURIComponent(url.replace(/[^\w\s]/gi, '_')); // URL 编码并清理非法字符
};

// 从 URL 获取扩展名
const getFileExtensionFromUrl = (url: string): string => {
  return path.extname(url).toLowerCase() || '.jpg'; // 默认使用 .jpg 扩展名，如果 URL 没有扩展名
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // 加载 URL
  mainWindow.loadURL('http://www.baidu.com');

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 注册 file:// 协议
  protocol.registerFileProtocol('file', (request, callback) => {
    const filePath = decodeURIComponent(request.url.substr(7)); // 去掉 "file://"
    callback({ path: filePath });
  });

  // 设置网络拦截器
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const { url, resourceType } = details;

      // 忽略非 HTTP/HTTPS 请求
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        callback({});
        return;
      }

      // 仅拦截图片请求
      if (
        resourceType === 'image' ||
        /\.(png|jpe?g|gif|svg|webp)$/i.test(url)
      ) {
        const cacheKey = generateCacheKey(url);
        const fileExtension = getFileExtensionFromUrl(url); // 从 URL 中提取扩展名
        const cachePath = path.join(CACHE_DIR, `${cacheKey}${fileExtension}`);

        // 检查缓存
        if (fs.existsSync(cachePath)) {
          console.log(`✅ Cache hit for image: ${url}`);
          callback({ cancel: true, redirectURL: `file://${cachePath}` });
        } else {
          console.log(`🚀 Cache miss for image: ${url}`);
          callback({});
        }
      } else {
        callback({});
      }
    },
  );

  // 在请求完成后缓存数据
  session.defaultSession.webRequest.onCompleted((details) => {
    const { url, responseHeaders, statusCode, resourceType } = details;

    if (!url || statusCode !== 200) return;

    // 仅缓存图片
    if (resourceType === 'image' || /\.(png|jpe?g|gif|svg|webp)$/i.test(url)) {
      const cacheKey = generateCacheKey(url);
      const contentType = responseHeaders['content-type'] || '';
      const fileExtension = getFileExtensionFromUrl(url); // 从 URL 提取扩展名
      const cachePath = path.join(CACHE_DIR, `${cacheKey}${fileExtension}`);

      // 如果文件已存在，则不重复下载
      if (fs.existsSync(cachePath)) {
        console.log(`🔹 Image already cached, skipping download: ${url}`);
        return;
      }

      console.log(`⬇️ Fetching and caching image: ${url}`);

      // 缓存图片
      fetch(url)
        .then((res) => res.arrayBuffer())
        .then((buffer) => {
          fs.writeFileSync(cachePath, Buffer.from(buffer)); // 写入缓存
          console.log(`✅ Image cached at: ${cachePath}`);
        })
        .catch((err) => {
          console.error(`❌ Failed to cache image ${url}:`, err);
        });
    }
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow).catch(console.log);
