const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const mime = require('mime'); // 用于检测文件类型

// 缓存目录，存储已下载的图片
const imageCacheDir = path.join(__dirname, 'imageCache');

// 创建图片缓存目录（如果不存在）
if (!fs.existsSync(imageCacheDir)) {
  fs.mkdirSync(imageCacheDir);
}

// 内存缓存，用于缓存已下载的图片
const imageCache = {};

// 启动 HTTP 服务器，提供图片缓存
const server = http.createServer((req, res) => {
  const requestedUrl = url.parse(req.url).pathname;
  const fileName = path.basename(requestedUrl);
  const filePath = path.join(imageCacheDir, fileName);

  // 如果缓存中有该文件，直接返回
  if (imageCache[fileName]) {
    res.writeHead(200, { 'Content-Type': mime.getType(filePath) });
    res.end(imageCache[fileName]);
  } else {
    // 如果没有缓存，从文件系统中加载
    if (fs.existsSync(filePath)) {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Error reading cached image');
          return;
        }

        // 将文件加入内存缓存
        imageCache[fileName] = data;

        res.writeHead(200, { 'Content-Type': mime.getType(filePath) });
        res.end(data);
      });
    } else {
      res.writeHead(404);
      res.end('Image not found');
    }
  }
});

// 监听 3000 端口
const port = 3000;
server.listen(port, () => {
  console.log(`Image cache server running at http://localhost:${port}`);
});

module.exports = server;
