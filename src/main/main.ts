import path from 'path';
import { app, BrowserWindow, session, protocol } from 'electron';
import Datastore from 'nedb';
import { parse } from 'url';
import { stringify } from 'querystring';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

// 初始化缓存数据库
const cacheDb = new Datastore<{
  key: string;
  data: { headers: Record<string, string>; body: string };
}>({
  filename: path.join(app.getPath('userData'), 'cache.db'),
  autoload: true,
});

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // webSecurity: false, // 禁用安全限制，允许跨域导航（开发时可用，生产环境慎用）
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
  // 监听导航事件
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    console.log('Navigating to:', navigationUrl);
    event.preventDefault(); // 如果需要完全控制导航，可以取消默认行为

    // 手动让窗口加载目标 URL
    mainWindow?.loadURL(navigationUrl);
  });

  // 处理跨域导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('External link:', url);

    // 允许外部链接跳转，直接使用系统浏览器打开
    require('electron').shell.openExternal(url);

    // 或者，加载到当前窗口
    // mainWindow?.loadURL(url);

    return { action: 'deny' }; // 默认阻止窗口创建行为
  });

  // 调试导航行为
  mainWindow.webContents.on('will-navigate', (event, url) => {
    console.log('will-navigate:', url);
  });

  mainWindow.webContents.on('did-navigate', (event, url) => {
    console.log('did-navigate:', url);
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL) => {
      console.error('Navigation failed:', validatedURL, errorDescription);
    },
  );
  // 注册 file:// 协议拦截器
  protocol.registerFileProtocol('file', (request, callback) => {
    const url = request.url.substr(7); // 去掉 "file://"
    const filePath = path.normalize(decodeURIComponent(url)); // 解码路径并标准化
    console.log('Serving file:', filePath);

    callback({ path: filePath });
  });

  // 缓存文件目录
  const CACHE_DIR = path.join(app.getPath('userData'), 'cache');
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // 生成缓存键
  const generateCacheKey = (pathname: string, query: Record<string, any>) =>
    `${pathname}?${new URLSearchParams(query).toString()}`;

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

      // 不拦截主页面加载请求
      if (resourceType === 'mainFrame') {
        callback({});
        return;
      }

      const parsedUrl = parse(url || '', true);
      if (!parsedUrl.pathname) {
        callback({});
        return;
      }

      const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);
      const cachePath = path.join(
        CACHE_DIR,
        `${cacheKey.replace(/[^a-z0-9]/gi, '_')}`,
      );

      // 检查缓存
      if (fs.existsSync(cachePath)) {
        console.log('Cache hit:', url);
        callback({ cancel: true, redirectURL: `file://${cachePath}` }); // 使用本地缓存文件
      } else {
        console.log('Cache miss:', url);
        callback({});
      }
    },
  );

  // 在请求完成后缓存数据
  session.defaultSession.webRequest.onCompleted((details) => {
    const { url, responseHeaders, statusCode } = details;

    // 仅缓存成功的请求
    if (!url || statusCode !== 200) {
      return;
    }

    const parsedUrl = parse(url, true);
    const cacheKey = generateCacheKey(
      parsedUrl.pathname || '',
      parsedUrl.query,
    );
    const cachePath = path.join(
      CACHE_DIR,
      `${cacheKey.replace(/[^a-z0-9]/gi, '_')}`,
    );

    // 自定义网络请求获取响应体
    fetch(url)
      .then((res) => {
        const contentType = res.headers.get('content-type');

        if (contentType?.includes('application/json')) {
          return res
            .json()
            .then((body) => ({ body: JSON.stringify(body), contentType }));
        }
        if (contentType?.includes('text')) {
          return res.text().then((body) => ({ body, contentType }));
        }
        if (contentType?.includes('image') || contentType?.includes('font')) {
          return res.arrayBuffer().then((body) => ({
            body: Buffer.from(body),
            contentType,
          }));
        }

        throw new Error('Unsupported content type');
      })
      .then(({ body, contentType }) => {
        if (body) {
          fs.writeFileSync(cachePath, body); // 缓存内容写入文件
          console.log('Response cached:', url);
        }
      })
      .catch((err) => {
        console.error('Error caching response:', err);
      });
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow).catch(console.log);
