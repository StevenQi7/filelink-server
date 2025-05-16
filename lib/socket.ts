import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { getSession, updateSession } from './redis';

let io: SocketIOServer;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // 连接建立时
  io.on('connection', (socket) => {
    const { sessionId, deviceId } = socket.handshake.query as { sessionId: string, deviceId: string };
    
    if (!sessionId || !deviceId) {
      socket.disconnect();
      return;
    }

    // 加入会话房间
    socket.join(sessionId);
    
    console.log(`设备 ${deviceId} 连接到会话 ${sessionId}`);

    // 通知会话中的其他成员有新设备加入
    socket.to(sessionId).emit('peer_event', {
      type: 'peer_event',
      event: 'joined',
      deviceId
    });

    // 处理断开连接
    socket.on('disconnect', () => {
      console.log(`设备 ${deviceId} 断开连接`);
      
      socket.to(sessionId).emit('peer_event', {
        type: 'peer_event',
        event: 'left',
        deviceId
      });
    });

    // 处理发送 SDP 提议
    socket.on('offer', async (data) => {
      socket.to(sessionId).emit('offer', {
        type: 'sdp',
        subtype: 'offer',
        sdp: data.sdp,
        from: deviceId
      });
    });

    // 处理发送 SDP 应答
    socket.on('answer', async (data) => {
      socket.to(sessionId).emit('answer', {
        type: 'sdp',
        subtype: 'answer',
        sdp: data.sdp,
        from: deviceId
      });
    });

    // 处理 ICE 候选
    socket.on('ice_candidate', async (data) => {
      socket.to(sessionId).emit('ice_candidate', {
        type: 'ice_candidate',
        candidate: data.candidate,
        from: deviceId
      });
    });

    // 处理文件传输状态更新
    socket.on('transfer_update', async (data) => {
      socket.to(sessionId).emit('transfer_update', {
        type: 'transfer_update',
        status: data.status,
        progress: data.progress,
        from: deviceId
      });
    });

    // 处理文件元数据
    socket.on('files_info', async (data) => {
      socket.to(sessionId).emit('files_info', {
        type: 'files_info',
        files: data.files,
        from: deviceId
      });
    });
  });

  return io;
}

export function getSocketIO() {
  return io;
}

export function emitToSession(sessionId: string, event: string, data: any) {
  if (io) {
    io.to(sessionId).emit(event, data);
  }
} 