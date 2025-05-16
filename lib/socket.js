const { Server: SocketIOServer } = require('socket.io');
const { 
  getSession, 
  updateSession,
  storeSessionMember,
  getSessionMembers,
  removeSessionMember
} = require('./redis');

let io;
// 移除内存中的会话成员存储
// const sessionMembers = new Map();

function initSocketServer(httpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  console.log('Socket.IO 服务器已初始化');

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

    // 记录会话成员到Redis
    await storeSessionMember(sessionId, socket.id, {
      socketId: socket.id,
      deviceId: deviceId
    });

    // 获取会话中的其他成员数量
    const roomMembers = io.sockets.adapter.rooms.get(sessionId);
    const memberCount = roomMembers ? roomMembers.size : 0;
    console.log(`会话 ${sessionId} 当前成员数量: ${memberCount}`);

    // 获取当前会话中的所有成员
    const sessionMembersMap = await getSessionMembers(sessionId);
    const allMembers = Array.from(sessionMembersMap.values());
    console.log(`会话 ${sessionId} 当前所有成员:`, allMembers);

    // 如果不是第一个加入的成员，则通知已在会话中的其他成员
    if (memberCount > 1) {
      console.log(`通知会话 ${sessionId} 中的其他成员有新设备加入`);
      // 广播通知其他成员有新成员加入
      socket.to(sessionId).emit('peer_event', {
        type: 'peer_event',
        event: 'joined',
        deviceId
      });
      
      // 同时通知自己有其他成员存在
      setTimeout(() => {
        // 筛选出不是当前设备的其他成员
        const otherMembers = allMembers.filter(member => member.deviceId !== deviceId);
        
        if (otherMembers.length > 0) {
          console.log(`通知新成员 ${deviceId} 有其他成员存在:`, otherMembers);
          otherMembers.forEach(member => {
            socket.emit('peer_event', {
              type: 'peer_event',
              event: 'joined',
              deviceId: member.deviceId
            });
          });
        }
      }, 1000);
    }

    // 处理断开连接
    socket.on('disconnect', async () => {
      console.log(`设备 ${deviceId} 断开连接`);
      
      // 从Redis中移除会话成员
      const isSessionEmpty = await removeSessionMember(sessionId, socket.id);
      console.log(`已从会话 ${sessionId} 中移除设备 ${deviceId}`);
      
      if (isSessionEmpty) {
        console.log(`会话 ${sessionId} 已没有成员，已清理会话成员信息`);
      }
      
      socket.to(sessionId).emit('peer_event', {
        type: 'peer_event',
        event: 'left',
        deviceId
      });
    });

    // 处理发送 SDP 提议
    socket.on('offer', async (data) => {
      console.log(`收到设备 ${deviceId} 的offer:`, typeof data === 'string' ? 'SDP字符串' : '对象格式');
      
      // 确保data是对象形式
      const offerData = typeof data === 'string' ? { sdp: JSON.parse(data) } : data;
      
      // 简化数据格式，直接传递SDP对象
      socket.to(sessionId).emit('offer', offerData);
      console.log(`已转发offer到会话 ${sessionId} 的其他成员`);
    });

    // 处理发送 SDP 应答
    socket.on('answer', async (data) => {
      console.log(`收到设备 ${deviceId} 的answer:`, typeof data === 'string' ? 'SDP字符串' : '对象格式');
      
      // 确保data是对象形式
      const answerData = typeof data === 'string' ? { sdp: JSON.parse(data) } : data;
      
      // 简化数据格式，直接传递SDP对象
      socket.to(sessionId).emit('answer', answerData);
      console.log(`已转发answer到会话 ${sessionId} 的其他成员`);
    });

    // 处理 ICE 候选
    socket.on('ice_candidate', async (data) => {
      console.log(`收到设备 ${deviceId} 的ICE候选`);

      // 转发ICE候选到会话中的其他设备
      socket.to(sessionId).emit('ice_candidate', {
        type: 'ice_candidate',
        deviceId,
        candidate: data.candidate
      });
      
      console.log(`已转发ICE候选到会话 ${sessionId} 的其他成员`);
    });

    // 处理调试请求
    socket.on('debug', async (data) => {
      console.log(`收到设备 ${deviceId} 的调试请求:`, data);
      
      if (data.action === 'check_session_status') {
        const connectedSockets = await io.in(data.sessionId).fetchSockets();
        const members = connectedSockets.map(s => ({
          id: s.id,
          deviceId: s.handshake.query.deviceId
        }));
        
        // 从Redis获取会话成员信息
        const sessionMembersMap = await getSessionMembers(data.sessionId);
        const memberDetailsFromRedis = Array.from(sessionMembersMap.values());
        
        socket.emit('debug_response', {
          action: 'session_status',
          sessionId: data.sessionId,
          membersCount: members.length,
          members,
          memberDetails: memberDetailsFromRedis
        });
        
        console.log(`会话 ${data.sessionId} 当前有 ${members.length} 个设备连接`);
        
        // 如果发送方发送调试请求，自动要求所有接收方请求连接
        if (members.length > 1) {
          console.log('检测到多个设备在会话中，尝试触发连接请求');
          socket.to(sessionId).emit('request_connection', {
            deviceId,
            sessionId: data.sessionId,
            timestamp: Date.now(),
            isAutoTrigger: true
          });
        }
      }
    });

    // 处理文件传输状态更新
    socket.on('transfer_update', async (data) => {
      console.log(`收到设备 ${deviceId} 的传输状态更新:`, data.status);
      socket.to(sessionId).emit('transfer_update', {
        type: 'transfer_update',
        status: data.status,
        progress: data.progress,
        from: deviceId
      });
    });

    // 处理文件元数据
    socket.on('files_info', async (data) => {
      console.log(`收到设备 ${deviceId} 的文件信息:`, data.files);
      socket.to(sessionId).emit('files_info', {
        type: 'files_info',
        files: data.files,
        from: deviceId
      });
      console.log(`已转发文件信息到会话 ${sessionId} 的其他成员`);
    });

    // 处理请求文件信息
    socket.on('request_files_info', async (data) => {
      console.log(`收到设备 ${deviceId} 的文件信息请求`);
      socket.to(sessionId).emit('request_files_info', {
        deviceId,
        sessionId: data.sessionId || sessionId,
        timestamp: Date.now()
      });
      console.log(`已转发文件信息请求到会话 ${sessionId} 的其他成员`);
    });

    // 处理连接请求
    socket.on('request_connection', (data) => {
      console.log(`收到设备 ${deviceId} 的连接请求`);
      socket.to(sessionId).emit('request_connection', {
        deviceId,
        sessionId,
        timestamp: Date.now()
      });
      console.log(`已转发连接请求到会话 ${sessionId} 的其他成员`);
      
      // 给自己也发一个通知，便于调试
      socket.emit('debug_response', {
        action: 'request_sent',
        message: '已发送连接请求到其他成员',
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
    console.log(`已向设备 ${deviceId} 发送连接成功状态`);
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
  getSocketIO,
  emitToSession
}; 