import { app, BrowserWindow, session } from 'electron';
import Nedb from 'nedb';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';

const userDataPath = app.getPath('userData');
const apiCachePath = path.join(userDataPath, 'apiCache.db');
const db = new Nedb({ filename: apiCachePath, autoload: true });

let win: BrowserWindow;

function createWindow(): void {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.loadURL('https://www.baidu.com');

  // 拦截所有请求，包括POST、XHR等
  const filter = {
    urls: ['*://*/*'],
  };

  // 在 onBeforeRequest 中拦截请求
  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      const url = details.url;
      const method = details.method;
      const resourceType = details.resourceType;
      const body = details.uploadData
        ? details.uploadData[0].bytes.toString()
        : null;

      // 如果是 API 请求 (POST)，我们处理它
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        if (method === 'POST' && body) {
          const uniqueKey = getApiCacheKey(url, body);

          // 查找缓存
          db.findOne({ key: uniqueKey }, (err, doc) => {
            if (err) {
              console.error('Error querying Nedb:', err);
            } else if (doc) {
              // 如果缓存存在，返回缓存数据
              console.log('Returning cached data from Nedb');
              callback({
                cancel: false,
                responseHeaders: { 'Content-Type': 'application/json' },
                data: JSON.stringify(doc.data),
              });
              return;
            }
          });
        }
      }

      callback({ cancel: false });
    },
  );

  // 拦截响应并保存
  session.defaultSession.webRequest.onCompleted((details) => {
    const url = details.url;
    const method = details.method;
    const resourceType = details.resourceType;
    const statusCode = details.statusCode;

    // 对于 API 请求（POST 请求）并且响应是成功的（状态码 200）
    if (
      (resourceType === 'xhr' || resourceType === 'fetch') &&
      statusCode === 200
    ) {
      const uniqueKey = getApiCacheKey(
        url,
        details.uploadData ? details.uploadData[0].bytes.toString() : '',
      );

      // 使用模拟的 POST 请求获取响应
      sendPostRequest(url, details.uploadData, (responseData) => {
        if (responseData) {
          // 保存到 Nedb 数据库
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

// 模拟 POST 请求并获取响应
function sendPostRequest(
  url: string,
  postData: any,
  callback: (data: any) => void,
): void {
  const postDataStr = postData[0].bytes.toString();
  const data = JSON.parse(postDataStr); // 解析请求体数据

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postDataStr),
    },
  };

  const protocol = url.startsWith('https') ? https : http;

  const req = protocol.request(url, options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });

    res.on('end', () => {
      try {
        const parsedData = JSON.parse(responseData);
        callback(parsedData);
      } catch (err) {
        console.error('Error parsing response data:', err);
        callback(null);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error sending POST request:', err);
    callback(null);
  });

  // 写入请求体
  req.write(postDataStr);
  req.end();
}

// 生成唯一的缓存 Key (API 请求，包含请求入参)
function getApiCacheKey(url: string, body: string): string {
  return `${url}?${body}`;
}

app.whenReady().then(() => {
  createWindow();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});
