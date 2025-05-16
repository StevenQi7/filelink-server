// 该文件是针对 Vercel 环境优化的服务器配置
// 在 Vercel 上部署时，主要通过 API 路由 /api/socketio 提供 Socket.io 服务
// 而不是通过传统的服务器设置

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // 注意：在 Vercel 上，服务器端的 Socket.io 会通过 API 路由提供
  // 这个文件主要用于本地开发环境

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');
    console.log('运行环境:', dev ? '开发模式' : '生产模式');
    console.log('注意: 在 Vercel 环境中，Socket.io 通过 API 路由提供服务');
  });
}); 