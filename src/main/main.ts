import { app, BrowserWindow, session } from 'electron';
import Nedb from 'nedb';
import path from 'path';
import fs from 'fs';
import https from 'https';
import axios from 'axios';
import { IncomingMessage } from 'http';

// 初始化 Nedb 数据库，存储 API 响应数据
const userDataPath = app.getPath('userData');
const apiCachePath = path.join(userDataPath, 'apiCache.db');
const db = new Nedb({ filename: apiCachePath, autoload: true });

// 创建浏览器窗口
let win: BrowserWindow;

function createWindow(): void {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // 加载指定网页
  win.loadURL('https://www.baidu.com');

  // 拦截所有请求，包含图片请求和API请求
  const filter = {
    urls: ['*://*/*'], // 匹配所有请求
  };

  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      const url = details.url;
      const resourceType = details.resourceType;
      const queryParams = new URL(url).searchParams.toString(); // 获取请求的查询参数
      const uniqueKey =
        resourceType === 'image'
          ? getImageCacheKey(url)
          : getApiCacheKey(url, queryParams);

      if (resourceType === 'image') {
        handleImageRequest(url, uniqueKey, callback);
      } else if (resourceType === 'xhr' || resourceType === 'fetch') {
        handleApiRequest(url, uniqueKey, callback);
      } else {
        callback({ cancel: false });
      }
    },
  );
  // 使用 onCompleted 捕获响应数据并缓存
  session.defaultSession.webRequest.onCompleted((details) => {
    const url = details.url;
    const method = details.method;
    const resourceType = details.resourceType;
    const statusCode = details.statusCode;

    if (
      (resourceType === 'xhr' || resourceType === 'fetch') &&
      statusCode === 200
    ) {
      const uniqueKey = getApiCacheKey(
        url,
        details.uploadData ? details.uploadData[0].bytes.toString() : '',
      );

      // 获取响应内容
      details.responseBody?.then((data) => {
        if (data) {
          const responseData = JSON.parse(data.toString());
          // 将响应数据保存到本地数据库
          db.insert({ key: uniqueKey, data: responseData }, (err) => {
            if (err) {
              console.error('Error saving data to Nedb:', err);
            }
            console.log('API response data saved to Nedb');
          });
        }
      });
    }
  });
}

// 处理图片请求
function handleImageRequest(
  url: string,
  uniqueKey: string,
  callback: (details: any) => void,
): void {
  const localPath = path.join(userDataPath, 'imageCache', uniqueKey);

  if (fs.existsSync(localPath)) {
    console.log(`Serving image from local cache: ${url}`);
    fs.readFile(localPath, (err, data) => {
      if (err) {
        console.error('Error reading cached image:', err);
        callback({ cancel: true });
        return;
      }

      callback({
        cancel: false,
        responseHeaders: { 'Content-Type': 'image/jpeg' }, // 假设图片是 JPEG 格式
        data: data,
      });
    });
  } else {
    downloadImage(url, localPath, () => {
      fs.readFile(localPath, (err, data) => {
        if (err) {
          console.error('Error reading downloaded image:', err);
          callback({ cancel: true });
          return;
        }

        callback({
          cancel: false,
          responseHeaders: { 'Content-Type': 'image/jpeg' },
          data: data,
        });
      });
    });
  }
}

// 处理 API 请求
function handleApiRequest(
  url: string,
  uniqueKey: string,
  callback: (details: any) => void,
): void {
  console.log(`Intercepted API request: ${url}`);
  db.findOne({ key: uniqueKey }, (err, doc) => {
    if (err) {
      console.error('Error querying Nedb:', err);
      callback({ cancel: false });
      return;
    }

    if (doc) {
      console.log('Returning cached API data from Nedb');
      callback({
        cancel: false,
        responseHeaders: { 'Content-Type': 'application/json' },
        data: JSON.stringify(doc.data),
      });
    } else {
      console.log('No cached data, making network request');
      axios
        .get(url)
        .then((response) => {
          const data = response.data;
          db.insert({ key: uniqueKey, data: data }, (err) => {
            if (err) {
              console.error('Error saving data to Nedb:', err);
            }
            console.log('API data saved to Nedb');
          });

          callback({
            cancel: false,
            responseHeaders: { 'Content-Type': 'application/json' },
            data: JSON.stringify(data),
          });
        })
        .catch((error) => {
          console.error('API request failed:', error);
          callback({ cancel: true });
        });
    }
  });
}

// 生成唯一的缓存 Key (图片请求)
function getImageCacheKey(url: string): string {
  const filename = path.basename(url);
  return filename; // 对于图片，直接使用文件名作为唯一标识
}

// 生成唯一的缓存 Key (API 请求，包含请求入参)
function getApiCacheKey(url: string, queryParams: string): string {
  // 使用 URL 和查询参数（如果有）结合来确保唯一性
  return `${url}?${queryParams}`;
}

// 下载图片并保存到本地
function downloadImage(
  imageUrl: string,
  localPath: string,
  callback: () => void,
): void {
  const fileStream = fs.createWriteStream(localPath);

  const protocol = imageUrl.startsWith('https') ? https : require('http');

  protocol
    .get(imageUrl, (res: IncomingMessage) => {
      console.log(`Downloading image: ${imageUrl}`);

      // 确保下载成功并保存文件
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Image saved to: ${localPath}`);
        callback(); // 下载完成后回调
      });
    })
    .on('error', (err: Error) => {
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
