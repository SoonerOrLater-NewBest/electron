const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const NeDB = require('nedb');
const url = require('url');
const querystring = require('querystring');

// 创建一个 nedb 数据库实例
const db = new NeDB({ filename: 'cache.db', autoload: true });

let mainWindow;

// 创建窗口函数
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false, // 保持安全性
      contextIsolation: true, // 保持安全性
    },
  });

  // 加载 React 打包后的应用或直接加载线上 URL
  mainWindow.loadURL('https://example.com'); // 假设你的 React 应用在线上
}

// 生成缓存的唯一键：使用 URL 路径和查询参数组合
function generateCacheKey(pathname, queryParams) {
  const queryString = querystring.stringify(queryParams);
  return `${pathname}?${queryString}`; // 组合路径和查询参数生成唯一的键
}

const interceptRequest = () => {
  // 拦截请求
  const currentSession = session.defaultSession;
  currentSession.webRequest.onBeforeRequest((details, callback) => {
    const { url: requestUrl } = details;

    // 解析请求 URL 和查询参数，生成一个唯一的缓存键
    const parsedUrl = url.parse(requestUrl);
    const queryParams = querystring.parse(parsedUrl.query);
    const cacheKey = generateCacheKey(parsedUrl.pathname, queryParams);

    // 尝试从缓存中查找数据
    db.findOne({ key: cacheKey }, (err, doc) => {
      if (err) {
        console.error('查询缓存失败:', err);
      }

      if (doc) {
        // 如果缓存存在，直接返回缓存数据
        console.log('命中缓存:', requestUrl);
        callback({
          cancel: true,
          responseHeaders: doc.data.headers, // 返回缓存的响应头
          response: doc.data.body, // 返回缓存的响应体
        });
      } else {
        // 如果没有缓存，继续请求并在返回后缓存
        console.log('未命中缓存:', requestUrl);
        callback({}); // 继续请求

        // 拦截请求的响应，缓存返回的数据
        currentSession.webRequest.onCompleted((responseDetails) => {
          if (
            responseDetails.url === requestUrl &&
            responseDetails.statusCode === 200
          ) {
            // 假设响应内容可以直接存储为 body 数据
            db.insert(
              {
                key: cacheKey,
                data: {
                  headers: responseDetails.responseHeaders, // 响应头
                  body: responseDetails.responseBody, // 响应体
                },
              },
              (err) => {
                if (err) {
                  console.error('缓存失败:', err);
                } else {
                  console.log('缓存成功:', requestUrl);
                }
              },
            );
          }
        });
      }
    });
  });
};

// 等待 Electron 应用准备好后启动
app.whenReady().then(() => {
  createWindow();
  interceptRequest();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
