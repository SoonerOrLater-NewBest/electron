import { app, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { parse } from 'url';
import Datastore from 'nedb';

// 注意：如果 Electron 版本较新，Node.js 全局内置 fetch 可能不可用，此处可选择引入 node-fetch
// import fetch from 'node-fetch';

// 创建图片缓存目录（例如：{userData}/image_cache）
const IMAGE_CACHE_DIR = path.join(app.getPath('userData'), 'image_cache');
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}

// 创建 nedb 数据库实例用于 API 缓存（存储 JSON 或文本数据）
const cacheDb = new Datastore<{ key: string; data: string }>({
  filename: path.join(app.getPath('userData'), 'api_cache.db'),
  autoload: true,
});

// 根据 URL 和查询参数生成唯一 key（用于 API 缓存）
function generateCacheKey(
  pathname: string,
  query: Record<string, any>,
): string {
  const qs = new URLSearchParams(query).toString();
  return `${pathname}?${qs}`;
}

// 根据图片 URL 生成本地文件保存路径（将 URL 中的非字母数字字符替换）
function getLocalImagePath(url: string): string {
  const sanitized = url.replace(/[^a-z0-9]/gi, '_');
  return path.join(IMAGE_CACHE_DIR, sanitized);
}

// 定义拦截规则：拦截所有 http/https 请求
const filter = { urls: ['*://*/*'] };

session.defaultSession.webRequest.onBeforeRequest(
  filter,
  (details, callback) => {
    const { url, resourceType } = details;

    // 只处理 http/https 请求
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      callback({});
      return;
    }

    // --- 1. 图片缓存逻辑 ---
    // 判断：resourceType 为 image 或 URL 后缀为常见图片格式
    if (resourceType === 'image' || /\.(png|jpe?g|gif|svg)$/i.test(url)) {
      const localImagePath = getLocalImagePath(url);
      if (fs.existsSync(localImagePath)) {
        console.log('Image cache hit:', url);
        callback({ cancel: true, redirectURL: `file://${localImagePath}` });
        return;
      }
    }

    // --- 2. 接口缓存逻辑 ---
    // 仅拦截 URL 中包含 "dsl" 的请求
    if (url.includes('dsl')) {
      const parsedUrl = parse(url, true);
      if (!parsedUrl.pathname) {
        callback({});
        return;
      }
      const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);
      // 查询 nedb 数据库，看是否已有缓存
      cacheDb.findOne({ key: cacheKey }, (err, doc) => {
        if (err) {
          console.error('API cache query error:', err);
          callback({});
          return;
        }
        if (doc) {
          console.log('API cache hit:', url);
          // 假设接口返回的是 JSON 文本
          const base64Data = Buffer.from(doc.data, 'utf8').toString('base64');
          callback({
            cancel: true,
            redirectURL: `data:application/json;base64,${base64Data}`,
          });
        } else {
          callback({});
        }
      });
      return; // 异步查询nedb，所以后续不再调用 callback
    }

    // --- 3. 其他请求放行 ---
    callback({});
  },
);

session.defaultSession.webRequest.onCompleted(filter, (details) => {
  const { url, statusCode, resourceType, method } = details;

  // 仅缓存 GET 且成功的请求
  if (!url || statusCode !== 200 || method !== 'GET') {
    return;
  }

  // --- 图片缓存 ---
  if (resourceType === 'image' || /\.(png|jpe?g|gif|svg)$/i.test(url)) {
    const localImagePath = getLocalImagePath(url);
    if (fs.existsSync(localImagePath)) {
      // 已经缓存
      return;
    }
    // 通过 fetch 获取图片内容（这里使用全局 fetch，若无全局 fetch 请引入 node-fetch）
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        fs.writeFileSync(localImagePath, Buffer.from(buffer));
        console.log('Cached image:', url);
      })
      .catch((err) => {
        console.error('Error caching image:', url, err);
      });
  }

  // --- API 缓存 ---
  if (url.includes('dsl')) {
    const parsedUrl = parse(url, true);
    if (!parsedUrl.pathname) return;
    const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);
    // 查询 nedb，看是否已经缓存（避免重复写入）
    cacheDb.findOne({ key: cacheKey }, (err, doc) => {
      if (err) {
        console.error('API cache query error on completed:', err);
        return;
      }
      if (doc) {
        return; // 已缓存
      }
      // 重新发起 fetch 请求获取接口返回内容
      fetch(url)
        .then((res) => res.text())
        .then((text) => {
          cacheDb.insert({ key: cacheKey, data: text }, (err2) => {
            if (err2) {
              console.error('Error caching API response:', url, err2);
            } else {
              console.log('Cached API response:', url);
            }
          });
        })
        .catch((err) => {
          console.error('Error fetching API response:', url, err);
        });
    });
  }
});
