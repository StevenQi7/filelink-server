// Socket.io API 路由处理程序
// 注意：这个文件在 /pages/api 目录下，用于处理 Socket.io 连接
// 在 Vercel 环境中，/socket.io/* 请求会被重定向到此处理程序

import { Server as SocketIOServer } from 'socket.io';

// 存储全局 Socket.io 实例
let io;

// 处理 Socket.io 连接
export default function SocketHandler(req, res) {
  if (res.socket.server.io) {
    console.log('Socket.io 服务已初始化，重用现有实例');
    res.end();
    return;
  }
  
  console.log('初始化新的 Socket.io 服务器实例');
  
  // 创建 Socket.io 服务器实例
  const io = new SocketIOServer(res.socket.server, {
    path: '/socket.io/',
    addTrailingSlash: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });
  
  // 保存 Socket.io 实例到服务器对象
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
    
    // 加入会话房间
    socket.join(sessionId);
    
    console.log(`设备 ${deviceId} 连接到会话 ${sessionId}`);
    
    // 获取会话中的其他成员数量
    const roomMembers = io.sockets.adapter.rooms.get(sessionId);
    const memberCount = roomMembers ? roomMembers.size : 0;
    console.log(`会话 ${sessionId} 当前成员数量: ${memberCount}`);
    
    // 广播通知其他成员有新成员加入
    if (memberCount > 1) {
      console.log(`通知会话 ${sessionId} 中的其他成员有新设备加入`);
      socket.to(sessionId).emit('peer_event', {
        type: 'peer_event',
        event: 'joined',
        deviceId
      });
    }
    
    // 处理断开连接
    socket.on('disconnect', async () => {
      console.log(`设备 ${deviceId} 断开连接`);
      socket.to(sessionId).emit('peer_event', {
        type: 'peer_event',
        event: 'left',
        deviceId
      });
    });
    
    // 处理发送 SDP 提议
    socket.on('offer', async (data) => {
      console.log(`收到设备 ${deviceId} 的offer`);
      socket.to(sessionId).emit('offer', data);
    });
    
    // 处理发送 SDP 应答
    socket.on('answer', async (data) => {
      console.log(`收到设备 ${deviceId} 的answer`);
      socket.to(sessionId).emit('answer', data);
    });
    
    // 处理 ICE 候选
    socket.on('ice_candidate', async (data) => {
      console.log(`收到设备 ${deviceId} 的ICE候选`);
      socket.to(sessionId).emit('ice_candidate', data);
    });
    
    // 处理请求连接
    socket.on('request_connection', (data) => {
      console.log(`收到设备 ${deviceId} 的连接请求`);
      socket.to(sessionId).emit('request_connection', {
        deviceId,
        sessionId,
        timestamp: Date.now()
      });
    });
    
    // 处理文件信息
    socket.on('files_info', async (data) => {
      console.log(`收到设备 ${deviceId} 的文件信息`);
      socket.to(sessionId).emit('files_info', data);
    });
    
    // 处理请求文件信息
    socket.on('request_files_info', async (data) => {
      console.log(`收到设备 ${deviceId} 的文件信息请求`);
      socket.to(sessionId).emit('request_files_info', {
        deviceId,
        sessionId: data.sessionId || sessionId,
        timestamp: Date.now()
      });
    });
    
    // 发送一个测试事件告知客户端连接成功
    socket.emit('connection_status', { 
      status: 'connected',
      message: `你已成功连接到信令服务器`,
      sessionId,
      deviceId,
      roomMembers: memberCount
    });
  });
  
  console.log('Socket.io 服务器初始化完成');
  res.end();
}

// 配置处理程序不对请求体进行解析
export const config = {
  api: {
    bodyParser: false,
  },
}; 