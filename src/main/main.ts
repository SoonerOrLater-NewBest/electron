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

// 生成唯一缓存键
const generateCacheKey = (
  pathname: string,
  queryParams: Record<string, string>,
): string => {
  const queryString = stringify(queryParams);
  return `${pathname}?${queryString}`;
};

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

    // 返回文件路径
    callback({ path: filePath });
  });
  const filter = {
    urls: ['*://*/*'], // 过滤所有请求
  };

  // 设置网络拦截器
  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      const { url } = details;
      // 忽略非 http/https 请求
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        callback({});
        return;
      }
      // 不拦截主页面加载请求（通常是 HTML 文档）
      if (details.resourceType === 'mainFrame') {
        callback({}); // 允许直接加载
        return;
      }
      const parsedUrl = parse(url || '', true);

      if (!parsedUrl.pathname) {
        callback({});
        return;
      }
      // // 拦截接口请求（例如以 /api 开头）
      // if (url.includes('/api')) {
      //   console.log('Intercepting API request:', url);
      //   // 自定义逻辑（缓存、重定向等）
      //   callback({});
      //   return;
      // }

      // // 拦截静态资源请求（CSS、图片等）
      // if (/\.(css|js|png|jpe?g|gif|svg|woff2?|ttf|eot|ico)$/i.test(url)) {
      //   console.log('Intercepting static resource:', url);
      //   // 自定义逻辑（缓存、重定向等）
      //   callback({});
      //   return;
      // }

      const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);

      // 查找缓存
      cacheDb.findOne({ key: cacheKey }, (err, doc) => {
        if (err) {
          console.error('Cache query error:', err);
          callback({});
          return;
        }

        if (doc) {
          // 缓存命中 - 伪造响应
          console.log('Cache hit:', url);

          const localPath = path.join(
            app.getPath('userData'),
            `${cacheKey.replace(/[^a-z0-9]/gi, '_')}.html`,
          );
          fs.writeFileSync(localPath, doc.data.body); // 写入缓存到本地文件

          callback({ cancel: true, redirectURL: `file://${localPath}` }); // 使用本地文件作为响应
        } else {
          console.log('Cache miss:', url);
          callback({});
        }
      });
    },
  );

  // 在请求完成后缓存数据
  session.defaultSession.webRequest.onCompleted((details) => {
    const { url, responseHeaders, statusCode } = details;

    if (!url || statusCode !== 200) {
      return;
    }

    const parsedUrl = parse(url, true);
    const cacheKey = generateCacheKey(
      parsedUrl.pathname || '',
      parsedUrl.query,
    );

    // 自定义网络请求获取响应体
    fetch(url)
      .then((res) => res.text())
      .then((body) => {
        // 存入缓存
        cacheDb.insert(
          { key: cacheKey, data: { headers: responseHeaders || {}, body } },
          (err) => {
            if (err) console.error('Cache insert error:', err);
            else console.log('Response cached:', url);
          },
        );
      })
      .catch((err) => {
        console.error('Error fetching response body:', err);
      });
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow).catch(console.log);
