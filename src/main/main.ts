import path from 'path';
import { app, BrowserWindow, session, protocol } from 'electron';
import Datastore from 'nedb';
import fs from 'fs';
import { parse } from 'url';

let mainWindow: BrowserWindow | null = null;

// 初始化缓存数据库
const cacheDb = new Datastore<{
  key: string;
  data: { headers: Record<string, string>; body: string };
}>({
  filename: path.join(app.getPath('userData'), 'cache.db'),
  autoload: true,
});
function downloadImage(imageUrl, localPath, callback) {
  const fileStream = fs.createWriteStream(localPath);

  const protocol = imageUrl.startsWith('https') ? https : http;

  protocol
    .get(imageUrl, (res) => {
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        callback(); // 下载完成后调用回调
      });
    })
    .on('error', (err) => {
      console.error('下载图片失败:', err);
    });
}
const CACHE_DIR = path.join(app.getPath('userData'), 'cache');

// 创建缓存目录（如果不存在）
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const generateCacheKey = (pathname: string, query: Record<string, any>) =>
  `${pathname}?${new URLSearchParams(query).toString()}`;

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

  mainWindow.loadURL('http://www.baidu.com');

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 注册自定义协议 cache:// 协议
  // protocol.registerHttpProtocol('cache', (request, callback) => {
  //   const cacheUrl = request.url;
  //   const filePath = path.normalize(decodeURIComponent(cacheUrl.substr(7))); // 去掉 "cache://"

  //   console.log('Serving cached file from:', filePath);

  //   // 检查缓存文件是否存在
  //   if (fs.existsSync(filePath)) {
  //     console.log(`Found cached file at: ${filePath}`);
  //     callback({
  //       statusCode: 200,
  //       headers: {
  //         'Content-Type': 'image/jpeg', // 你可以根据实际的文件类型修改
  //       },
  //       data: fs.readFileSync(filePath), // 返回缓存文件内容
  //     });
  //   } else {
  //     console.log(`File not found in cache: ${filePath}`);
  //     callback({
  //       statusCode: 404,
  //       data: Buffer.from('Not Found'), // 文件未找到时的返回内容
  //     });
  //   }
  // });

  // 设置网络拦截器
  // session.defaultSession.webRequest.onBeforeRequest(
  //   { urls: ['*://*/*'] },
  //   (details, callback) => {
  //     const { url, resourceType } = details;

  //     // 忽略非 HTTP/HTTPS 请求
  //     if (!url.startsWith('http://') && !url.startsWith('https://')) {
  //       callback({});
  //       return;
  //     }

  //     // 不拦截主页面加载请求
  //     if (resourceType === 'mainFrame') {
  //       callback({});
  //       return;
  //     }

  //     const parsedUrl = parse(url, true);
  //     if (!parsedUrl.pathname) {
  //       callback({});
  //       return;
  //     }

  //     const cacheKey = generateCacheKey(parsedUrl.pathname, parsedUrl.query);
  //     const cachePath = path.join(
  //       CACHE_DIR,
  //       `${cacheKey.replace(/[^a-z0-9]/gi, '_')}`,
  //     );

  //     // 检查缓存
  //     if (fs.existsSync(cachePath)) {
  //       console.log('Cache hit for image:', url);

  //       // 使用自定义协议返回缓存文件
  //       callback({ cancel: true, redirectURL: `cache://${cachePath}` });
  //     } else {
  //       console.log('Cache miss:', url);
  //       callback({});
  //     }
  //   },
  // );

  // 在请求完成后缓存数据
  // session.defaultSession.webRequest.onCompleted((details) => {
  //   const { url, responseHeaders, statusCode } = details;

  //   // 仅缓存成功的请求
  //   if (!url || statusCode !== 200) {
  //     return;
  //   }

  //   const parsedUrl = parse(url, true);
  //   const cacheKey = generateCacheKey(
  //     parsedUrl.pathname || '',
  //     parsedUrl.query,
  //   );
  //   const cachePath = path.join(
  //     CACHE_DIR,
  //     `${cacheKey.replace(/[^a-z0-9]/gi, '_')}`,
  //   );

  //   // 自定义网络请求获取响应体
  //   fetch(url)
  //     .then((res) => {
  //       const contentType = res.headers.get('content-type');

  //       if (contentType?.includes('application/json')) {
  //         return res
  //           .json()
  //           .then((body) => ({ body: JSON.stringify(body), contentType }));
  //       }
  //       if (contentType?.includes('text')) {
  //         return res.text().then((body) => ({ body, contentType }));
  //       }
  //       if (contentType?.includes('image') || contentType?.includes('font')) {
  //         return res.arrayBuffer().then((body) => ({
  //           body: Buffer.from(body),
  //           contentType,
  //         }));
  //       }

  //       throw new Error('Unsupported content type');
  //     })
  //     .then(({ body, contentType }) => {
  //       if (body) {
  //         fs.writeFileSync(cachePath, body); // 缓存内容写入文件
  //         console.log('Response cached:', url);
  //       }
  //     })
  //     .catch((err) => {
  //       console.error('Error caching response:', err);
  //     });
  // });

  // 拦截图片请求
  const filter = {
    urls: ['*://*/*.jpg', '*://*/*.jpeg', '*://*/*.png', '*://*/*.gif'],
  };

  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      const userDataPath = app.getPath('userData');

      const requestedUrl = details.url;
      const parsedUrl = parse(requestedUrl, true);
      const fileName = generateCacheKey(parsedUrl.pathname, parsedUrl.query);
      const localPath = path.join(userDataPath, 'images', fileName);

      // 检查是否本地已缓存该图片
      if (fs.existsSync(localPath)) {
        // 如果本地有缓存的图片，直接加载本地图片
        callback({ cancel: false, redirectURL: 'file://' + localPath });
      } else {
        // 如果没有缓存，允许请求并下载图片到本地
        downloadImage(requestedUrl, localPath, () => {
          callback({ cancel: false, redirectURL: 'file://' + localPath });
        });
      }
    },
  );
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(createWindow).catch(console.log);
