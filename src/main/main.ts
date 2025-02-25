const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const mime = require('mime');
const axios = require('axios'); // 用于请求图片

const userDataPath = app.getPath('userData');
const imageCacheDir = path.join(userDataPath, 'imageCache');

// 创建缓存目录（如果不存在）
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
  win.loadURL('https://www.baidu.com');

  // 拦截图片请求
  const filter = {
    urls: ['*://*/*.jpg', '*://*/*.jpeg', '*://*/*.png', '*://*/*.gif'],
  };

  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      const requestedUrl = details.url;
      const fileName = path.basename(requestedUrl);
      const localPath = path.resolve(imageCacheDir, fileName); // 生成绝对路径

      const decodedLocalPath = decodeURIComponent(localPath);

      console.log(`Requested image: ${requestedUrl}`);
      console.log(`Checking local path: ${decodedLocalPath}`);

      // 检查是否本地已有图片缓存
      if (fs.existsSync(decodedLocalPath)) {
        // 本地缓存存在，直接从本地读取并返回图片
        console.log(`Serving from local cache: ${fileName}`);
        fs.readFile(decodedLocalPath, (err, data) => {
          if (err) {
            console.error('Error reading cached image:', err);
            callback({ cancel: true });
            return;
          }

          // 将图片数据直接返回给浏览器
          callback({
            cancel: false,
            responseHeaders: {
              'Content-Type': mime.getType(decodedLocalPath),
            },
            data: data, // 直接传递图片数据
          });
        });
      } else {
        // 本地没有缓存，下载图片
        console.log(`Downloading image: ${requestedUrl}`);
        downloadImage(requestedUrl, decodedLocalPath, () => {
          // 下载完成后，再次读取并返回图片
          console.log(`Serving newly downloaded image: ${fileName}`);
          fs.readFile(decodedLocalPath, (err, data) => {
            if (err) {
              console.error('Error reading downloaded image:', err);
              callback({ cancel: true });
              return;
            }

            // 将图片数据直接返回给浏览器
            callback({
              cancel: false,
              responseHeaders: {
                'Content-Type': mime.getType(decodedLocalPath),
              },
              data: data, // 直接传递图片数据
            });
          });
        });
      }
    },
  );
}

// 下载图片并保存到本地
function downloadImage(imageUrl, localPath, callback) {
  const fileStream = fs.createWriteStream(localPath);

  const protocol = imageUrl.startsWith('https') ? https : http;

  protocol
    .get(imageUrl, (res) => {
      console.log(`Downloading: ${imageUrl}`);

      // 确保下载成功并保存文件
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Image saved to: ${localPath}`);
        callback(); // 下载完成后回调
      });
    })
    .on('error', (err) => {
      console.error('下载图片失败:', err);
    });
}

// 创建本地 HTTP 服务器，代理图片请求
const imageCacheServer = http.createServer((req, res) => {
  // 设置 CORS 头部，允许浏览器跨域访问本地图片
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const requestedUrl = decodeURIComponent(req.url); // 解码请求路径
  const fileName = path.basename(requestedUrl);
  const filePath = path.join(imageCacheDir, fileName);

  console.log('Received request for:', fileName);

  if (fs.existsSync(filePath)) {
    console.log(`Serving from disk cache: ${fileName}`);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error reading cached image');
        return;
      }

      // 返回缓存的图片
      res.writeHead(200, { 'Content-Type': mime.getType(filePath) });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Image not found');
  }
});

// 启动 HTTP 服务器，监听 3000 端口
const port = 3000;
imageCacheServer.listen(port, () => {
  console.log(`Image cache server running at http://localhost:${port}`);
});

app.whenReady().then(() => {
  createWindow();

  // 在退出应用时关闭窗口
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});
