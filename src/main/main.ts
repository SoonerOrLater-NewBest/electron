const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const https = require('https');
const http = require('http');
const mime = require('mime'); // 用于 MIME 类型检测
const imageCacheServer = require('./imageCacheServer'); // 引入自定义的缓存服务器

const userDataPath = app.getPath('userData');
const imageCacheDir = path.join(userDataPath, 'imageCache');

// 创建目录（如果不存在）
if (!fs.existsSync(imageCacheDir)) {
  fs.mkdirSync(imageCacheDir);
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // 加载指定的网页
  win.loadURL('http://www.aizzc.top');

  // 拦截图片请求
  const filter = {
    urls: ['*://*/*.jpg', '*://*/*.jpeg', '*://*/*.png', '*://*/*.gif'],
  };

  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      // 如果是本地 HTTP 请求，不再拦截
      if (details.url.startsWith('http://localhost:3000/')) {
        return callback({ cancel: false });
      }

      const requestedUrl = details.url;
      const fileName = path.basename(url.parse(requestedUrl).pathname);
      const localPath = path.resolve(imageCacheDir, fileName); // 生成绝对路径

      // 如果路径中有 URL 编码的字符，需要解码
      const decodedLocalPath = decodeURIComponent(localPath);

      // 检查是否本地已有图片缓存
      if (fs.existsSync(decodedLocalPath)) {
        // 本地存在，返回通过 HTTP 服务器加载的图片
        const localFileUrl = `http://localhost:3000/${fileName}`;
        callback({ cancel: false, redirectURL: localFileUrl });
      } else {
        // 本地不存在，允许请求并下载图片到本地
        downloadImage(requestedUrl, decodedLocalPath, () => {
          // 下载完成后，再次尝试加载
          const localFileUrl = `http://localhost:3000/${fileName}`;
          callback({ cancel: false, redirectURL: localFileUrl });
        });
      }
    },
  );
}

// 下载图片
function downloadImage(imageUrl, localPath, callback) {
  const fileStream = fs.createWriteStream(localPath);

  const protocol = imageUrl.startsWith('https') ? https : http;

  protocol
    .get(imageUrl, (res) => {
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        callback(); // 下载完成后回调
      });
    })
    .on('error', (err) => {
      console.error('下载图片失败:', err);
    });
}

app.whenReady().then(() => {
  createWindow();

  // 在退出应用时关闭窗口
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});
