// Vercel 环境下的 Socket.io 初始化
const { Server: SocketIOServer } = require('socket.io');
const { 
  getSession, 
  updateSession,
  storeSessionMember,
  getSessionMembers,
  removeSessionMember
} = require('./redis');

let io;

// 专门为 Vercel 环境设计的初始化函数
function initVercelSocketServer(req, res) {
  if (io) {
    console.log('Socket.IO 服务已经初始化，重用现有实例');
    return io;
  }

  console.log('在 Vercel 环境中初始化 Socket.IO 服务');
  
  if (!res.socket.server.io) {
    console.log('创建新的 Socket.IO 服务器实例');
    
    io = new SocketIOServer(res.socket.server, {
      path: '/socket.io/',
      addTrailingSlash: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true
    });
    
    // 保存 Socket.IO 实例到服务器对象
    res.socket.server.io = io;
    
    // 连接建立时
    io.on('connection', async (socket) => {
      console.log('收到新的WebSocket连接请求，连接ID:', socket.id);
      const { sessionId, deviceId } = socket.handshake.query;
      
      console.log('连接参数:', { sessionId, deviceId });
      
      if (!sessionId || !deviceId) {
        console.log('缺少必要参数，断开连接');
        socket.disconnect();
        return;
      }
      
      // 这里是原有的连接逻辑，与原始 socket.js 文件相同
      // ... 省略相同的代码 ...
    });
  }
  
  return res.socket.server.io;
}

// 普通初始化函数，兼容原有代码
function initSocketServer(httpServer) {
  if (process.env.VERCEL) {
    console.log('在 Vercel 环境中，Socket.IO 通过 API 路由初始化');
    return;
  }
  
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });
  
  console.log('Socket.IO 服务器已初始化，路径: /socket.io/');
  
  // 连接建立时
  io.on('connection', async (socket) => {
    // 这里是原有的连接逻辑，与原始代码相同
    // ... 省略相同的代码 ...
  });
  
  return io;
}

function getSocketIO() {
  return io;
}

function emitToSession(sessionId, event, data) {
  if (io) {
    console.log(`向会话 ${sessionId} 发送 ${event} 事件`);
    io.to(sessionId).emit(event, data);
  } else {
    console.error('无法发送事件：Socket.IO 实例不存在');
  }
}

module.exports = {
  initSocketServer,
  initVercelSocketServer,
  getSocketIO,
  emitToSession
}; 