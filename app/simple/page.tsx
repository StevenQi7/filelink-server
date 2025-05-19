'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

// 清理旧状态的函数，确保页面加载时重置连接状态
const cleanupStaleState = () => {
  try {
    if (typeof window !== 'undefined') {
      // 清除连接状态标志
      window.localStorage.removeItem('isConnecting');
      window.localStorage.removeItem('isWebSocketReconnecting');
      window.localStorage.removeItem('pendingOffer');
      window.localStorage.removeItem('pendingAnswer');
      window.localStorage.removeItem('lastWebRTCInitTime');
      window.localStorage.removeItem('lastConnectionRequestTime');
      window.localStorage.removeItem('lastOfferTime');
      window.localStorage.removeItem('webrtcRetryCount');
      
      console.log('[页面加载] 已清除旧的连接状态标志');
    }
  } catch (e) {
    console.error('清理旧状态失败:', e);
  }
};

// 立即执行
cleanupStaleState();

// 添加完全清理所有存储的函数
const cleanAllStorage = () => {
  try {
    if (typeof window !== 'undefined') {
      // 清除所有WebRTC相关的本地存储
      window.localStorage.removeItem('isConnecting');
      window.localStorage.removeItem('isWebSocketReconnecting');
      window.localStorage.removeItem('pendingOffer');
      window.localStorage.removeItem('pendingAnswer');
      window.localStorage.removeItem('lastWebSocketConnectTime');
      window.localStorage.removeItem('lastWebRTCInitTime');
      window.localStorage.removeItem('lastConnectionRequestTime');
      window.localStorage.removeItem('lastOfferTime');
      window.localStorage.removeItem('webrtcRetryCount');
      window.localStorage.removeItem('webrtcDeviceId');
      window.localStorage.removeItem('webrtcSessionId');
      window.localStorage.removeItem('webrtcRole');
      
      console.log('[用户操作] 已清除所有存储的WebRTC状态和标识');
      
      // 提示用户刷新页面获取新的设备ID
      if (typeof window !== 'undefined') {
        window.alert('所有本地缓存已清除！请刷新页面以获取新的设备ID。');
        window.location.reload();
      }
    }
  } catch (e) {
    console.error('清理所有存储失败:', e);
  }
};

export default function SimplePage() {
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [roomCode, setRoomCode] = useState<string>('');
  const [localConnection, setLocalConnection] = useState<RTCPeerConnection | null>(null);
  const [channel, setChannel] = useState<RTCDataChannel | null>(null);
  const [status, setStatus] = useState<string>('未连接');
  const [logs, setLogs] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  // 存储接收到的ICE候选
  const [pendingCandidates, setPendingCandidates] = useState<RTCIceCandidate[]>([]);
  
  // 文件传输相关状态
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileInfo, setFileInfo] = useState<any[]>([]);
  const [transferProgress, setTransferProgress] = useState<{[key: string]: number}>({});
  const [receivingFiles, setReceivingFiles] = useState<{[key: string]: {
    name: string, 
    size: number, 
    type: string, 
    progress: number, 
    buffer: Uint8Array[], 
    received: number,
    id: string
  }}>({});
  const [showFileConfirm, setShowFileConfirm] = useState<boolean>(false);
  
  // 使用ref直接引用WebRTC连接，避免异步状态更新问题
  const rtcConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  // 增加一个引用，用于保存selectedFiles，避免React状态管理问题
  const selectedFilesRef = useRef<File[]>([]);
  
  // 增加数据通道的ref引用，解决数据通道状态同步问题
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  
  // 使用ref存储文件传输状态
  const fileChunkSize = 16384; // 16KB 块大小
  const transfersInProgress = useRef<{[key: string]: boolean}>({});
  
  // 状态变量：记录连接详细信息
  const [connectionDetails, setConnectionDetails] = useState({
    connectionState: '未连接',
    iceConnectionState: '未连接',
    iceGatheringState: '未开始',
    signalingState: '稳定',
    dataChannelState: '关闭'
  });
  
  // 使用useRef保存socket连接，避免重渲染丢失连接
  const socketRef = useRef<any>(null);
  
  // 替换现有的socket和setSocket的使用
  const setSocket = (newSocket: any) => {
    socketRef.current = newSocket;
  };
  
  const getSocket = () => socketRef.current;
  
  // 更新设置本地连接的方法，同时更新state和ref
  const updateLocalConnection = (conn: RTCPeerConnection | null) => {
    rtcConnectionRef.current = conn;
    setLocalConnection(conn);
    
    // 每次更新连接时也更新连接详情
    if (conn) {
      updateConnectionDetails(conn);
    } else {
      updateConnectionDetails(null);
    }
  };
  
  // 修改设备ID初始化代码
  useEffect(() => {
    // 首先尝试从localStorage获取设备ID
    const savedDeviceId = localStorage.getItem('webrtcDeviceId');
    
    if (savedDeviceId) {
      // 如果localStorage中有设备ID，直接使用
      setDeviceId(savedDeviceId);
      log(`使用已保存的设备ID: ${savedDeviceId}`);
    } else {
      // 如果没有，创建新的设备ID
      const id = 'device_' + Math.random().toString(36).substring(2, 10);
      setDeviceId(id);
      // 保存到localStorage
      localStorage.setItem('webrtcDeviceId', id);
      log(`设备ID生成: ${id}`);
    }
  }, []);
  
  // 记录日志
  const log = (message: string) => {
    console.log(message);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };
  
  // 生成房间码
  const generateRoomCode = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    log(`生成6位密码: ${code}`);
    return code;
  };
  
  // 修改 WebSocket 连接函数
  const connectWebSocket = useCallback((sid: string) => {
    try {
      // 如果当前有活跃连接，先断开
      if (socketRef.current && socketRef.current.connected) {
        log(`断开现有WebSocket连接: ${socketRef.current.id}`);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // 记录上次连接时间
      const lastConnectTime = parseInt(localStorage.getItem('lastWebSocketConnectTime') || '0');
      const now = Date.now();
      
      // 如果在2秒内已经尝试过连接，则跳过
      if (lastConnectTime && (now - lastConnectTime < 2000)) {
        log('最近2秒内已尝试连接，跳过重复连接');
        return;
      }
      
      // 记录本次连接时间
      localStorage.setItem('lastWebSocketConnectTime', now.toString());
      
      // 获取当前设备ID，从state或localStorage
      const currentDeviceId = deviceId || localStorage.getItem('webrtcDeviceId') || `device_${Math.random().toString(36).substring(2, 10)}`;
      
      // 确保deviceId被保存到localStorage
      if (!localStorage.getItem('webrtcDeviceId')) {
        localStorage.setItem('webrtcDeviceId', currentDeviceId);
      }
      
      // 使用动态导入确保在浏览器环境执行
      log(`正在创建新的WebSocket连接到会话 ${sid}...`);
      import('socket.io-client').then(({ io }) => {
        const connectId = Math.random().toString(36).substring(2, 10);
        log(`创建Socket连接 [${connectId}]...`);
        log(`使用设备ID: ${currentDeviceId}`);
        
        // 确保之前的socket已被清理
        if (socketRef.current && socketRef.current.connected) {
          log(`再次检查并关闭现有连接: ${socketRef.current.id}`);
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        
        // 确定当前环境并选择适当的连接URL
        const isProduction = process.env.NODE_ENV === 'production' || 
                            window.location.hostname !== 'localhost';
        const connectionURL = isProduction ? window.location.origin : window.location.origin;
        
        log(`环境: ${isProduction ? '生产环境' : '开发环境'}, 连接URL: ${connectionURL}`);
        
        const newSocket = io(connectionURL, {
          query: {
            sessionId: sid,
            deviceId: currentDeviceId,
            connectId
          },
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 10000,
          forceNew: true,
          path: '/socket.io/'
        });
        
        // 设置连接超时处理
        const connectionTimeout = setTimeout(() => {
          if (newSocket && !newSocket.connected) {
            log(`连接超时，关闭连接尝试 [${connectId}]`);
            newSocket.disconnect();
          }
        }, 10000);
        
        // 设置事件处理器
        newSocket.on('connect', () => {
          clearTimeout(connectionTimeout);
          log(`WebSocket已连接，ID: ${newSocket.id} [${connectId}]`);
          setSocket(newSocket);
        });
        
        // 其他事件处理...
        
        // 在这里添加所有事件监听器
        setupSocketEventListeners(newSocket);
      }).catch(error => {
        log(`创建WebSocket连接失败: ${error}`);
      });
    } catch (error) {
      log(`WebSocket连接异常: ${error}`);
    }
  }, [deviceId]);
  
  // 提取事件处理器到单独的函数，方便重用
  const setupSocketEventListeners = (newSocket: any) => {
    // 移除所有现有的事件监听器，避免重复绑定
    newSocket.off('connection_status');
    newSocket.off('disconnect');
    newSocket.off('peer');
    newSocket.off('peer_event');
    newSocket.off('offer');
    newSocket.off('answer');
    newSocket.off('ice_candidate');
    newSocket.off('request_connection');
    
    // 为调试添加一个标识
    const eventId = Math.random().toString(36).substring(2, 6);
    log(`为Socket ${newSocket.id} 设置事件监听器 [${eventId}]`);
    
    newSocket.on('connection_status', (data: any) => {
      log(`连接状态: ${JSON.stringify(data)}`);
    });
    
    newSocket.on('disconnect', () => {
      log(`WebSocket连接断开 [${eventId}]`);
      
      // 如果当前socket是主socket，则设置为null
      if (socketRef.current === newSocket) {
        setSocket(null);
      }
    });
    
    newSocket.on('peer_event', (data: any) => {
      log(`收到对等事件: ${data.event}, 从: ${data.deviceId} [${eventId}]`);
      
      if (data.event === 'joined') {
        // 忽略自己的加入事件
        if (data.deviceId === deviceId) {
          log('忽略自己的加入事件');
          return;
        }
        
        log(`收到加入事件，当前角色: ${role}`);
        const currentRole = localStorage.getItem('webrtcRole') || role;
        
        // 如果是发送方，初始化WebRTC连接并准备传输
        if (currentRole === 'sender') {
          // 检查是否最近初始化过连接
          const lastInitTime = parseInt(localStorage.getItem('lastWebRTCInitTime') || '0');
          const now = Date.now();
          
          if (lastInitTime && (now - lastInitTime < 5000)) {
            log('已在最近5秒内初始化过WebRTC连接，跳过重复初始化');
            
            // 即使跳过初始化，仍然确保发送文件信息
            if (fileInfo.length > 0 && socketRef.current && socketRef.current.connected) {
              log('发送文件信息给接收方...');
              socketRef.current.emit('files_info', { files: fileInfo });
            }
          } else {
            log('作为发送方，初始化WebRTC连接...');
            localStorage.setItem('lastWebRTCInitTime', now.toString());
            tryConnect();
            
            // 在WebRTC连接建立后，发送文件信息
            // 延长等待时间，确保连接完全建立
            setTimeout(() => {
              // 如果有选择的文件，发送文件信息
              if (fileInfo.length > 0 && socketRef.current && socketRef.current.connected) {
                log('通过WebSocket发送文件信息给接收方...');
                socketRef.current.emit('files_info', { files: fileInfo });
              }
            }, 3000); // 延迟3秒，等待连接建立
          }
        }
      }
    });
    
    newSocket.on('offer', (data: any) => {
      log(`收到offer: ${JSON.stringify(data).substring(0, 100)}...`);
      
      // 检查当前有效角色
      const currentRole = localStorage.getItem('webrtcRole') || role;
      log(`当前角色: ${currentRole}, localStorage角色: ${localStorage.getItem('webrtcRole')}, React状态角色: ${role}`);
      
      if (currentRole !== 'sender') {  // 只要不是发送方，就处理offer
        log('作为接收方处理offer');
        
        // 确保连接被关闭并重新初始化
        if (rtcConnectionRef.current) {
          log('关闭现有连接并重新初始化');
          rtcConnectionRef.current.close();
          updateLocalConnection(null);
          setChannel(null);
          // 保留暂存的ICE候选，不要清空
          log(`保留 ${pendingCandidates.length} 个存储的ICE候选`);
        }
        
        // 短暂延迟后初始化WebRTC连接
        setTimeout(() => {
          log('初始化接收方WebRTC连接');
          const conn = initWebRTC(false);
          
          // 再等待500ms，确保连接初始化完成
          setTimeout(() => {
            if (conn) {
              // 获取SDP对象
              let sdpToUse;
              try {
                if (data.sdp) {
                  sdpToUse = data.sdp;
                  log('使用offer.sdp属性');
                } else {
                  sdpToUse = data;
                  log('直接使用offer对象');
                }
                
                log('WebRTC连接已创建，设置远程描述并发送Answer');
                // 设置远程描述并创建Answer
                setRemoteOfferAndCreateAnswer(conn, sdpToUse)
                  .then(() => {
                    // 处理成功后，尝试添加存储的ICE候选
                    if (pendingCandidates.length > 0) {
                      log(`尝试添加 ${pendingCandidates.length} 个存储的ICE候选`);
                      
                      // 注意：创建一个副本来遍历，因为在处理过程中可能会添加新的候选
                      const candidates = [...pendingCandidates];
                      
                      let addedCount = 0;
                      for (const candidate of candidates) {
                        try {
                          conn.addIceCandidate(candidate)
                            .then(() => {
                              addedCount++;
                              log(`成功添加ICE候选 ${addedCount}/${candidates.length}`);
                            })
                            .catch(err => {
                              log(`添加ICE候选失败: ${err}`);
                            });
                        } catch (error) {
                          log(`添加ICE候选时出错: ${error instanceof Error ? error.message : String(error)}`);
                        }
                      }
                      
                      // 清空已处理的候选
                      setPendingCandidates(prev => {
                        // 移除所有已处理的候选
                        return prev.filter(c => !candidates.some(
                          pc => pc.candidate === c.candidate && 
                                pc.sdpMid === c.sdpMid && 
                                pc.sdpMLineIndex === c.sdpMLineIndex
                        ));
                      });
                    } else {
                      log('没有存储的ICE候选需要添加');
                    }
                  })
                  .catch(error => {
                    log(`处理offer时出错: ${error instanceof Error ? error.message : String(error)}`);
                  });
              } catch (error) {
                log(`处理SDP offer格式出错: ${error instanceof Error ? error.message : String(error)}`);
              }
            } else {
              log('WebRTC连接创建失败');
            }
          }, 500);
        }, 500);
      } else {
        log('作为发送方，忽略收到的offer');
      }
    });
    
    newSocket.on('answer', (data: any) => {
      log(`收到answer: ${JSON.stringify(data).substring(0, 100)}...`);
      // 使用ref而不是状态变量来访问连接
      if (rtcConnectionRef.current) {
        const answer = data.sdp || data;
        try {
          log(`尝试设置远程描述 (Answer)，连接状态: ${rtcConnectionRef.current.connectionState}`);
          rtcConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer))
            .then(() => log('已设置远程描述 (Answer)'))
            .catch(error => log(`设置远程描述失败: ${error}`));
        } catch (error) {
          log(`处理Answer失败: ${error}`);
        }
      } else {
        log('收到Answer但WebRTC连接不存在，请检查创建顺序');
      }
    });
    
    newSocket.on('ice_candidate', (data: any) => {
      log(`收到ice_candidate，来自: ${data.deviceId}`);
      
      // 如果角色是接收方且还没有初始化WebRTC连接，先初始化连接
      const currentRole = localStorage.getItem('webrtcRole') || role;
      
      if (data.candidate) {
        // 先存储ICE候选
        const candidate = new RTCIceCandidate(data.candidate);
        log(`保存ICE候选: ${candidate.candidate.slice(0, 50)}...`);
        setPendingCandidates(prev => [...prev, candidate]);
        
        if (currentRole === 'receiver' && !rtcConnectionRef.current) {
          log('作为接收方收到ICE候选，但连接未初始化，开始初始化...');
          
          setTimeout(() => {
            // 尝试初始化WebRTC连接
            const conn = initWebRTC(false);
            
            // 等待连接初始化完成
            setTimeout(() => {
              if (conn) {
                log(`尝试添加 ${pendingCandidates.length} 个存储的ICE候选`);
                // 为防止仍有pending的ICE,使用当前最新的pendingCandidates
                const candidates = [...pendingCandidates];
                candidates.forEach(candidate => {
                  try {
                    conn.addIceCandidate(candidate)
                      .then(() => log('添加ICE候选成功'))
                      .catch(err => log(`添加ICE候选失败: ${err}`));
                  } catch (error) {
                    log(`添加ICE候选出错: ${error instanceof Error ? error.message : String(error)}`);
                  }
                });
                
                // 发送连接请求，请求offer
                setTimeout(() => {
                  log('主动请求发送方发起连接');
                  requestConnection();
                }, 1000);
              }
            }, 1000);
          }, 500);
        } else if (rtcConnectionRef.current) {
          // 已有连接，尝试添加候选
          try {
            addIceCandidate(candidate);
          } catch (error) {
            log(`添加ICE候选失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          log(`已保存ICE候选，当前共有 ${pendingCandidates.length} 个候选等待添加`);
        }
      }
    });
    
    newSocket.on('request_connection', (data: any) => {
      log(`收到连接请求，来自: ${data.deviceId} [${eventId}]`);
      
      const currentRole = localStorage.getItem('webrtcRole') || role;
      if (currentRole === 'sender') {
        log('作为发送方收到连接请求，准备初始化WebRTC连接');
        
        // 检查是否在最近5秒内处理过连接请求
        const lastRequestTime = parseInt(localStorage.getItem('lastConnectionRequestTime') || '0');
        const now = Date.now();
        
        if (lastRequestTime && (now - lastRequestTime < 5000)) {
          log('已在最近5秒内处理过连接请求，跳过重复初始化');
          return;
        }
        
        // 记录处理时间
        localStorage.setItem('lastConnectionRequestTime', now.toString());
        
        // 延迟500ms后初始化连接，减少并发
        setTimeout(() => {
          tryConnect();
        }, 500);
      }
    });
    
    // 增加文件信息事件处理
    newSocket.on('files_info', (data: any) => {
      log(`收到文件信息: ${JSON.stringify(data).substring(0, 100)}...`);
      
      // 更新文件信息
      if (data.files && Array.isArray(data.files)) {
        setFileInfo(data.files);
        log(`接收方将接收 ${data.files.length} 个文件`);
        
        // 显示确认对话框
        setShowFileConfirm(true);
      }
    });
    
    // 添加WebSocket事件处理以响应文件信息请求
    newSocket.on('request_files_info', (data: any) => {
      log(`收到WebSocket文件信息请求，来自: ${data.deviceId}`);
      
      const currentRole = localStorage.getItem('webrtcRole') || role;
      if (currentRole === 'sender' && fileInfo.length > 0) {
        log(`发送 ${fileInfo.length} 个文件的信息到接收方`);
        newSocket.emit('files_info', { files: fileInfo });
        log('已通过WebSocket发送文件信息');
      } else {
        log('没有可发送的文件信息，或不是发送方');
      }
    });
  };
  
  // 创建会话（发送方）
  const createSession = async () => {
    try {
      // 发送方必须先选择文件
      if (selectedFiles.length === 0 && role !== 'receiver') {
        log('请先选择要发送的文件，再创建会话');
        return;
      }

      log('正在创建会话...');
      const code = generateRoomCode();
      setRoomCode(code);
      
      const response = await fetch('/api/session/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          deviceInfo: {
            id: deviceId,
            name: '发送设备',
            platform: 'web',
            version: '1.0'
          }
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        // 设置sessionId并保存到localStorage
        const sid = data.sessionId;
        setSessionId(sid);
        localStorage.setItem('webrtcSessionId', sid);
        log(`会话创建成功，ID: ${sid}，房间密码: ${code}`);
        
        // 设置角色，并存储到localStorage
        setRole('sender');
        localStorage.setItem('webrtcRole', 'sender');
        log('角色已设置为: 发送方 (sender)');
        
        // 建立WebSocket连接
        connectWebSocket(sid);
      } else {
        log(`创建会话失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      log(`创建会话错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 加入会话（接收方）
  const joinSession = async () => {
    if (!roomCode || roomCode.length !== 6) {
      log('请输入有效的6位房间码');
      return;
    }
    
    try {
      log('正在加入会话...');
      
      const response = await fetch('/api/session/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: roomCode,
          deviceInfo: {
            id: deviceId,
            name: '接收设备',
            platform: 'web',
            version: '1.0'
          }
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        // 设置sessionId并保存到localStorage
        const sid = data.sessionId;
        setSessionId(sid);
        localStorage.setItem('webrtcSessionId', sid);
        log(`会话加入成功，ID: ${sid}`);
        log(`对方设备: ${data.peerInfo.name} (${data.peerInfo.platform})`);
        
        // 设置角色，并存储到localStorage
        setRole('receiver');
        localStorage.setItem('webrtcRole', 'receiver');
        log('角色已设置为: 接收方 (receiver)');
        
        // 建立WebSocket连接
        connectWebSocket(sid);
        
        // 设置延迟2秒后请求连接
        setTimeout(() => {
          requestConnection();
        }, 2000);
      } else {
        log(`加入会话失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      log(`加入会话错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 作为发送方开始（直接模式）
  const startAsSender = () => {
    const code = generateRoomCode();
    setRoomCode(code);
    setRole('sender');
    log(`已生成房间码: ${code}`);
    initWebRTC(true);
  };
  
  // 作为接收方开始（直接模式）
  const startAsReceiver = () => {
    if (!roomCode || roomCode.length !== 6) {
      log('请输入有效的6位房间码');
      return;
    }
    
    setRole('receiver');
    log(`正在连接到房间: ${roomCode}`);
    initWebRTC(false);
  };
  
  // 手动设置SDP和ICE候选
  const [sdpValue, setSdpValue] = useState('');
  const [iceValue, setIceValue] = useState('');
  const [collectedIceCandidates, setCollectedIceCandidates] = useState<RTCIceCandidate[]>([]);
  
  // 更新连接详情
  const updateConnectionDetails = (connection: RTCPeerConnection | null, channelState?: string) => {
    if (!connection) {
      setConnectionDetails({
        connectionState: '未连接',
        iceConnectionState: '未连接',
        iceGatheringState: '未开始',
        signalingState: '稳定',
        dataChannelState: channelState || '关闭'
      });
      return;
    }

    setConnectionDetails({
      connectionState: connection.connectionState,
      iceConnectionState: connection.iceConnectionState,
      iceGatheringState: connection.iceGatheringState,
      signalingState: connection.signalingState,
      dataChannelState: channelState || (channel ? channel.readyState : '关闭')
    });
  };
  
  // 初始化WebRTC连接，返回连接对象但也直接保存到ref
  const initWebRTC = (isSender: boolean, forceTcp = false) => {
    try {
      log('初始化WebRTC连接...');
      
      // 记录当前网络环境信息
      log('当前网络环境:');
      
      // 检测是否处于生产环境
      const isProduction = process.env.NODE_ENV === 'production' || window.location.hostname !== 'localhost';
      log(`运行环境: ${isProduction ? '生产环境' : '开发环境'}`);
      
      // 创建连接
      let configuration: RTCConfiguration = {
        iceServers: [
          {
            urls: "turn:107.175.53.199:3478?transport=udp",
            username: "admin", // 替换为实际用户名
            credential: "admin" // 替换为实际密码
          },
          {
            urls: "stun:107.175.53.199:3478"
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'relay', // 强制只用 TURN
        bundlePolicy: 'max-bundle' as RTCBundlePolicy,
        rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy
      };
      
      const connection = new RTCPeerConnection(configuration);
      
      // 同时更新状态和ref
      updateLocalConnection(connection);
      
      // 重置收集的ICE候选
      setCollectedIceCandidates([]);
      
      // 监听ICE候选
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateString = event.candidate.candidate.slice(0, 50);
          log(`收集到ICE候选: ${candidateString}...`);
          
          // 存储ICE候选供手动交换使用
          setCollectedIceCandidates(prev => [...prev, event.candidate!]);
          
          // 如果已连接WebSocket，发送ICE候选
          if (socketRef.current && socketRef.current.connected && sessionId) {
            socketRef.current.emit('ice_candidate', { candidate: event.candidate });
            log('已通过WebSocket发送ICE候选');
          }
        } else {
          log('ICE候选收集完成');
        }
        // 更新连接状态
        updateConnectionDetails(connection);
      };
      
      // 监听连接状态变化
      connection.onconnectionstatechange = () => {
        log(`连接状态变化: ${connection.connectionState}`);
        setStatus(connection.connectionState);
        updateConnectionDetails(connection);
      };
      
      // 监听ICE连接状态
      connection.oniceconnectionstatechange = () => {
        log(`ICE连接状态: ${connection.iceConnectionState}`);
        updateConnectionDetails(connection);
      };

      // 监听ICE收集状态
      connection.onicegatheringstatechange = () => {
        log(`ICE收集状态: ${connection.iceGatheringState}`);
        updateConnectionDetails(connection);
      };

      // 监听信令状态
      connection.onsignalingstatechange = () => {
        log(`信令状态: ${connection.signalingState}`);
        updateConnectionDetails(connection);
      };
      
      if (isSender) {
        // 创建数据通道
        const dataChannel = connection.createDataChannel('testChannel');
        setupDataChannel(dataChannel);
        
        // 如果已连接WebSocket，自动创建并发送offer
        if (socketRef.current && socketRef.current.connected && sessionId) {
          log('通过WebSocket发起连接...');
          createOffer(connection);
        } else if (!sessionId) {
          // 直接模式：创建并显示offer
          createAndShowOffer(connection);
        }
      } else {
        // 接收方监听数据通道
        connection.ondatachannel = (event) => {
          log('收到数据通道');
          setupDataChannel(event.channel);
        };
        
        // 如果未连接WebSocket，提示接收方输入offer
        if (!socketRef.current || !socketRef.current.connected || !sessionId) {
          log('请输入对方提供的SDP Offer');
        }
      }
      
      return connection;
    } catch (error) {
      log(`初始化WebRTC失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  
  // 设置数据通道
  const setupDataChannel = (dataChannel: RTCDataChannel) => {
    dataChannel.onopen = () => {
      log(`数据通道已打开: ${dataChannel.label}`);
      // 同时更新React状态和ref
      setChannel(dataChannel);
      dataChannelRef.current = dataChannel;
      updateConnectionDetails(localConnection, 'open');
      
      // 如果是发送方且有文件信息，发送文件信息
      const currentRole = localStorage.getItem('webrtcRole') || role;
      if (currentRole === 'sender' && fileInfo.length > 0) {
        log('数据通道已打开，立即发送文件信息...');
        
        // 延迟一点时间再发送，确保对方的监听器已经设置好
        setTimeout(() => {
          try {
            dataChannel.send(JSON.stringify({
              type: 'files_info',
              files: fileInfo
            }));
            log(`已发送 ${fileInfo.length} 个文件的信息到接收方`);
          } catch (error) {
            log(`发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }, 1000);
      } else if (currentRole === 'receiver') {
        // 接收方主动请求文件信息
        log('作为接收方，主动请求文件信息...');
        try {
          dataChannel.send(JSON.stringify({
            type: 'request_files_info'
          }));
          log('已发送文件信息请求');
        } catch (error) {
          log(`发送文件信息请求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    
    dataChannel.onclose = () => {
      log('数据通道已关闭');
      setChannel(null);
      dataChannelRef.current = null;
      updateConnectionDetails(localConnection, 'closed');
    };
    
    dataChannel.onmessage = (event) => {
      // 尝试解析JSON消息
      try {
        const data = JSON.parse(event.data);
        log(`收到消息: ${JSON.stringify(data).substring(0, 100)}...`);
        
        if (data.type === 'file-confirm') {
          if (data.confirmed) {
            log('接收方已确认接收文件，开始传输...');
            sendAllFiles();
          } else {
            log('接收方拒绝接收文件');
          }
        } else if (data.type === 'files_info') {
          log(`通过数据通道收到文件信息: ${data.files.length} 个文件`);
          setFileInfo(data.files);
          setShowFileConfirm(true);
        } else if (data.type === 'file-start' || data.type === 'file-end') {
          // 处理文件传输相关的消息
          handleDataChannelMessage(event);
        } else if (data.type === 'request_files_info') {
          // 响应文件信息请求
          log('收到文件信息请求');
          if (fileInfo.length > 0) {
            log(`发送 ${fileInfo.length} 个文件的信息到接收方`);
            try {
              // 直接使用当前上下文中的数据通道
              const currentChannel = channel;
              if (currentChannel && currentChannel.readyState === 'open') {
                currentChannel.send(JSON.stringify({
                  type: 'files_info',
                  files: fileInfo
                }));
                log('已发送文件信息');
              } else {
                log('数据通道不可用，无法发送文件信息');
                // 尝试通过WebSocket发送
                if (socketRef.current && socketRef.current.connected) {
                  socketRef.current.emit('files_info', { files: fileInfo });
                  log('通过WebSocket发送文件信息');
                }
              }
            } catch (error) {
              log(`发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else {
            log('没有可发送的文件信息');
          }
        } else {
          log(`收到消息: ${event.data}`);
        }
      } catch (error) {
        // 如果不是JSON，可能是二进制数据（文件块）
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          processFileChunk(event.data);
        } else {
          log(`收到纯文本消息: ${event.data}`);
        }
      }
    };
    
    dataChannel.onerror = (event) => {
      log(`数据通道错误: ${JSON.stringify(event)}`);
      updateConnectionDetails(localConnection, 'error');
    };
  };
  
  // 修改 createOffer 函数
  const createOffer = async (connection: RTCPeerConnection) => {
    try {
      // 检查是否最近5秒内发送过offer
      const lastOfferTime = parseInt(localStorage.getItem('lastOfferTime') || '0');
      const now = Date.now();
      if (lastOfferTime && (now - lastOfferTime < 5000)) {
        log(`最近5秒内已发送过offer，跳过此次发送`);
        return;
      }
      
      log('创建SDP Offer...');
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      log('已设置本地描述 (Offer)');
      
      // 记录本次发送offer的时间
      localStorage.setItem('lastOfferTime', now.toString());
      
      // 检查WebSocket连接状态，必要时重新连接
      if (!socketRef.current || !socketRef.current.connected) {
        log('WebSocket未连接，尝试重新连接...');
        
        // 从localStorage获取sessionId
        const savedSessionId = localStorage.getItem('webrtcSessionId') || sessionId;
        
        if (savedSessionId) {
          log(`使用会话ID重新连接: ${savedSessionId}`);
          // 尝试重新连接，但避免无限循环
          const isReconnecting = localStorage.getItem('isWebSocketReconnecting');
          if (!isReconnecting) {
            localStorage.setItem('isWebSocketReconnecting', 'true');
            
            // 保存offer到localStorage以便重连后使用
            const offerJson = JSON.stringify(offer);
            localStorage.setItem('pendingOffer', offerJson);
            log('已保存offer到localStorage，等待重连后发送');
            
            // 获取当前设备ID，从state或localStorage
            const currentDeviceId = deviceId || localStorage.getItem('webrtcDeviceId') || `device_${Math.random().toString(36).substring(2, 10)}`;
            
            // 确保deviceId被保存到localStorage
            if (!localStorage.getItem('webrtcDeviceId')) {
              localStorage.setItem('webrtcDeviceId', currentDeviceId);
            }
            
            // 启动新的连接
            import('socket.io-client').then(({ io }) => {
              const connectId = Math.random().toString(36).substring(2, 10);
              log(`直接创建Socket连接 [${connectId}]...`);
              log(`使用设备ID: ${currentDeviceId}`);
              
              const newSocket = io(`${window.location.origin}`, {
                query: {
                  sessionId: savedSessionId,
                  deviceId: currentDeviceId,
                  connectId
                },
                reconnection: false,
                // 添加path配置，确保与服务器端一致
                path: '/socket.io/'
              });
              
              // 设置临时socket事件处理器
              setupSocketEventListeners(newSocket);
              
              newSocket.on('connect', () => {
                log(`临时WebSocket已连接，ID: ${newSocket.id} [${connectId}]`);
                
                // 获取保存的offer
                const savedOffer = localStorage.getItem('pendingOffer');
                if (savedOffer) {
                  try {
                    const offerObj = JSON.parse(savedOffer);
                    log('从localStorage恢复offer并发送...');
                    newSocket.emit('offer', { sdp: offerObj });
                    log('Offer已成功发送');
                    localStorage.removeItem('pendingOffer');
                  } catch (error) {
                    log(`发送恢复的offer失败: ${error instanceof Error ? error.message : String(error)}`);
                  }
                } else {
                  log('无法找到保存的offer');
                }
                
                // 更新全局socket引用
                setSocket(newSocket);
                localStorage.removeItem('isWebSocketReconnecting');
              });
            });
          } else {
            log('已有WebSocket重连进行中，避免重复重连');
            log('显示offer以便手动交换:');
            log(JSON.stringify(offer));
          }
        } else {
          log('缺少会话ID，无法重新连接WebSocket');
          // 显示offer以便手动交换
          log('请手动交换以下SDP Offer:');
          log(JSON.stringify(offer));
        }
      } else {
        // 正常发送offer
        log('通过WebSocket发送offer...');
        socketRef.current.emit('offer', { sdp: offer });
        log('已通过WebSocket发送offer');
      }
    } catch (error) {
      log(`创建Offer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 创建并显示offer（直接模式）
  const createAndShowOffer = async (connection: RTCPeerConnection) => {
    try {
      log('创建SDP Offer...');
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      log('已设置本地描述 (Offer)');
      log('请将以下SDP Offer提供给接收方:');
      log(JSON.stringify(offer));
    } catch (error) {
      log(`创建Offer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 修改setRemoteOfferAndCreateAnswer函数
  const setRemoteOfferAndCreateAnswer = async (connection: RTCPeerConnection, sdp: any) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        log('设置远程描述 (Offer)...');
        // 确保我们有有效的SDP对象
        const sdpObject = (typeof sdp === 'string') ? JSON.parse(sdp) : sdp;
        
        try {
          await connection.setRemoteDescription(new RTCSessionDescription(sdpObject));
          log('远程描述设置成功');
        } catch (error) {
          log(`尝试直接设置远程描述失败: ${error instanceof Error ? error.message : String(error)}`);
          
          // 尝试使用内部sdp属性
          if (sdpObject.sdp) {
            log('尝试使用内部sdp属性');
            await connection.setRemoteDescription(new RTCSessionDescription(sdpObject.sdp));
            log('使用内部sdp属性设置远程描述成功');
          } else {
            throw error;
          }
        }
        
        // 创建Answer
        log('创建SDP Answer...');
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        log('本地描述设置成功 (Answer)');
        
        // 通过WebSocket发送Answer
        if (socketRef.current && socketRef.current.connected) {
          log('通过WebSocket发送Answer');
          socketRef.current.emit('answer', { sdp: answer });
          log('Answer已发送');
          
          // 解决Promise，表示处理成功
          resolve();
        } else {
          log('WebSocket未连接，尝试重新连接并发送Answer');
          
          // 从localStorage获取sessionId
          const savedSessionId = localStorage.getItem('webrtcSessionId') || sessionId;
          
          if (savedSessionId) {
            // 保存answer到localStorage以便重连后使用
            const answerJson = JSON.stringify(answer);
            localStorage.setItem('pendingAnswer', answerJson);
            
            // 获取当前设备ID，从state或localStorage
            const currentDeviceId = deviceId || localStorage.getItem('webrtcDeviceId') || `device_${Math.random().toString(36).substring(2, 10)}`;
            
            // 确保deviceId被保存到localStorage
            if (!localStorage.getItem('webrtcDeviceId')) {
              localStorage.setItem('webrtcDeviceId', currentDeviceId);
            }
            
            // 直接创建临时WebSocket连接
            import('socket.io-client').then(({ io }) => {
              const connectId = Math.random().toString(36).substring(2, 10);
              log(`创建临时Socket连接 [${connectId}] 发送Answer...`);
              log(`使用设备ID: ${currentDeviceId}`);
              
              const tempSocket = io(`${window.location.origin}`, {
                query: {
                  sessionId: savedSessionId,
                  deviceId: currentDeviceId,
                  connectId
                },
                reconnection: false,
                // 添加path配置，确保与服务器端一致
                path: '/socket.io/'
              });
              
              // 设置临时socket事件处理器
              setupSocketEventListeners(tempSocket);
              
              tempSocket.on('connect', () => {
                log(`临时WebSocket已连接，ID: ${tempSocket.id}`);
                
                // 获取保存的answer
                const savedAnswer = localStorage.getItem('pendingAnswer');
                if (savedAnswer) {
                  try {
                    const answerObj = JSON.parse(savedAnswer);
                    log('从localStorage恢复answer并发送...');
                    tempSocket.emit('answer', { sdp: answerObj });
                    log('Answer已成功发送');
                    localStorage.removeItem('pendingAnswer');
                    
                    // 更新全局socket引用
                    setSocket(tempSocket);
                    
                    // 解决Promise，表示处理成功
                    resolve();
                  } catch (error) {
                    log(`发送恢复的answer失败: ${error instanceof Error ? error.message : String(error)}`);
                    reject(error);
                  }
                } else {
                  log('无法找到保存的answer');
                  reject(new Error('无法找到保存的answer'));
                }
              });
              
              tempSocket.on('error', (error) => {
                log(`临时Socket连接错误: ${error}`);
                reject(error);
              });
            }).catch(error => {
              log(`创建临时Socket连接失败: ${error instanceof Error ? error.message : String(error)}`);
              reject(error);
            });
          } else {
            const error = new Error('缺少会话ID，无法发送Answer');
            log(error.message);
            reject(error);
          }
        }
      } catch (error) {
        log(`处理Offer失败: ${error instanceof Error ? error.message : String(error)}`);
        reject(error);
      }
    });
  };
  
  // 处理通过WebSocket接收到的answer
  const handleRemoteAnswer = async (sdp: any) => {
    if (!rtcConnectionRef.current) {
      log('WebRTC连接未初始化，无法处理answer');
      return;
    }
    
    try {
      log('设置远程描述 (Answer)...');
      await rtcConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      log('已设置远程描述');
    } catch (error) {
      log(`处理Answer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 添加ICE候选
  const addIceCandidate = async (candidate: any) => {
    if (!rtcConnectionRef.current) {
      log('WebRTC连接未初始化，无法添加ICE候选');
      return;
    }
    
    try {
      await rtcConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      log('已添加远程ICE候选');
    } catch (error) {
      log(`添加ICE候选失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 发送消息
  const sendMessage = () => {
    if (channel && channel.readyState === 'open') {
      const message = `测试消息 ${new Date().toISOString()}`;
      channel.send(message);
      log(`已发送消息: ${message}`);
    } else {
      log('数据通道未打开，无法发送消息');
    }
  };
  
  // 关闭WebRTC连接和WebSocket
  const closeConnection = () => {
    // 关闭WebRTC连接
    if (rtcConnectionRef.current) {
      rtcConnectionRef.current.close();
      updateLocalConnection(null);
      setChannel(null);
      setStatus('未连接');
      log('WebRTC连接已关闭');
    }
    
    // 关闭WebSocket连接
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.disconnect();
      setSocket(null);
      log('WebSocket连接已关闭');
    }
    
    // 重置状态
    setSessionId('');
    setRole(null);
  };
  
  // 查看服务器端的连接状态
  const checkServerStatus = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('debug', { action: 'check_session_status', sessionId });
      log('已发送会话状态检查请求');
    } else {
      log('WebSocket未连接，无法检查会话状态');
    }
  };
  
  // 请求连接功能
  const requestConnection = () => {
    if (socketRef.current && socketRef.current.connected) {
      log('发送连接请求...');
      socketRef.current.emit('request_connection', { 
        deviceId, 
        sessionId,
        isInitiator: role === 'receiver'
      });
      log('已发送连接请求');
    } else {
      log('WebSocket未连接，无法发送连接请求');
    }
  };
  
  // 设置远程offer (接收方，直接模式)
  const setRemoteOffer = async (offerStr: string) => {
    if (!rtcConnectionRef.current) {
      log('WebRTC连接未初始化，初始化中...');
      const conn = initWebRTC(false);
      setTimeout(() => {
        if (conn) {
          try {
            const offer = JSON.parse(offerStr);
            log('设置远程描述 (Offer)...');
            conn.setRemoteDescription(new RTCSessionDescription(offer))
              .then(() => {
                log('已设置远程描述');
                // 创建并显示answer
                createAndShowAnswer(conn);
              })
              .catch(error => {
                log(`处理Offer失败: ${error instanceof Error ? error.message : String(error)}`);
              });
          } catch (error) {
            log(`解析Offer失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }, 500);
      return;
    }
    
    try {
      const offer = JSON.parse(offerStr);
      log('设置远程描述 (Offer)...');
      await rtcConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      log('已设置远程描述');
      
      // 创建并显示answer
      await createAndShowAnswer(rtcConnectionRef.current);
    } catch (error) {
      log(`处理Offer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 创建并显示answer (接收方，直接模式)
  const createAndShowAnswer = async (connection: RTCPeerConnection) => {
    try {
      log('创建SDP Answer...');
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      log('已设置本地描述 (Answer)');
      log('请将以下SDP Answer提供给发送方:');
      log(JSON.stringify(answer));
    } catch (error) {
      log(`创建Answer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 设置远程answer (发送方，直接模式)
  const setRemoteAnswer = async (answerStr: string) => {
    if (!rtcConnectionRef.current) {
      log('WebRTC连接未初始化');
      return;
    }
    
    try {
      const answer = JSON.parse(answerStr);
      log('设置远程描述 (Answer)...');
      await rtcConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      log('已设置远程描述');
    } catch (error) {
      log(`处理Answer失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 修改tryConnect函数，避免重复初始化连接
  const tryConnect = () => {
    // 检查是否已经有一个正在进行的连接尝试
    const isConnecting = localStorage.getItem('isConnecting');
    if (isConnecting === 'true') {
      log('已有正在进行的连接尝试，跳过重复初始化');
      return;
    }
    
    localStorage.setItem('isConnecting', 'true');
    
    // 保存当前尝试的次数
    const retryCount = parseInt(localStorage.getItem('webrtcRetryCount') || '0');
    const maxRetries = 3;
    
    // 获取当前有效角色
    const currentRole = localStorage.getItem('webrtcRole') || role;
    log(`尝试建立连接，当前角色: ${currentRole}，尝试次数: ${retryCount + 1}/${maxRetries + 1}`);
    
    // 如果是发送方，尝试从localStorage恢复文件信息
    if (currentRole === 'sender' && fileInfo.length === 0) {
      const savedFileInfo = localStorage.getItem('webrtcFileInfo');
      if (savedFileInfo) {
        try {
          const parsedFileInfo = JSON.parse(savedFileInfo);
          if (Array.isArray(parsedFileInfo) && parsedFileInfo.length > 0) {
            setFileInfo(parsedFileInfo);
            log(`连接前从localStorage恢复了 ${parsedFileInfo.length} 个文件的信息`);
          }
        } catch (error) {
          log(`尝试恢复文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    
    try {
      // 关闭现有连接
      if (rtcConnectionRef.current) {
        log('关闭现有连接');
        rtcConnectionRef.current.close();
        updateLocalConnection(null);
        setChannel(null);
      }
      
      // 初始化新连接
      setTimeout(() => {
        log(`初始化新WebRTC连接 (角色: ${currentRole})`);
        const isSender = currentRole === 'sender';
        const conn = initWebRTC(isSender);
        
        // 直接保存新创建的连接到ref中
        if (conn) {
          rtcConnectionRef.current = conn;
        }
        
        // 如果是发送方，等待初始化完成后创建offer
        if (isSender && conn) {
          setTimeout(() => {
            log('主动创建并发送offer');
            try {
              createOffer(conn);
              
              // 设置一个延迟检查连接是否成功建立
              const connectionCheckTimer = setTimeout(() => {
                // 检查连接状态
                if (conn.connectionState !== 'connected' && retryCount < maxRetries) {
                  log(`连接未成功建立，将在3秒后重试 (${retryCount + 1}/${maxRetries})`);
                  localStorage.setItem('webrtcRetryCount', (retryCount + 1).toString());
                  localStorage.setItem('isConnecting', 'false');
                  setTimeout(tryConnect, 3000);
                } else if (conn.connectionState === 'connected') {
                  log('连接已成功建立，重置重试计数');
                  localStorage.setItem('webrtcRetryCount', '0');
                  localStorage.setItem('isConnecting', 'false');
                  
                  // 添加: 如果是发送方且有文件信息，确保在连接建立后发送
                  if (currentRole === 'sender') {
                    // 再次尝试从localStorage获取文件信息（如果状态中没有）
                    let currentFileInfo = fileInfo;
                    if (currentFileInfo.length === 0) {
                      const savedFileInfo = localStorage.getItem('webrtcFileInfo');
                      if (savedFileInfo) {
                        try {
                          const parsedFileInfo = JSON.parse(savedFileInfo);
                          if (Array.isArray(parsedFileInfo) && parsedFileInfo.length > 0) {
                            currentFileInfo = parsedFileInfo;
                            setFileInfo(parsedFileInfo);
                            log(`连接成功后，从localStorage恢复了 ${parsedFileInfo.length} 个文件的信息`);
                          }
                        } catch (error) {
                          log(`尝试恢复文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                        }
                      }
                    }
                    
                    if (currentFileInfo.length > 0) {
                      // 通过WebSocket发送
                      if (socketRef.current && socketRef.current.connected) {
                        log('连接已建立，通过WebSocket发送文件信息...');
                        socketRef.current.emit('files_info', { files: currentFileInfo });
                      }
                      
                      // 获取当前的数据通道 - 修复引用问题
                      const currentChannel = channel;
                      
                      // 如果数据通道已开启，也通过数据通道发送
                      if (currentChannel && currentChannel.readyState === 'open') {
                        log('连接已建立，通过数据通道发送文件信息...');
                        setTimeout(() => {
                          try {
                            currentChannel.send(JSON.stringify({
                              type: 'files_info',
                              files: currentFileInfo
                            }));
                            log('已通过数据通道发送文件信息');
                          } catch (error) {
                            log(`通过数据通道发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                          }
                        }, 1000);
                      } else {
                        log('数据通道未准备好，稍后将通过数据通道事件发送文件信息');
                      }
                    } else {
                      log('没有可发送的文件信息，请检查是否选择了文件');
                    }
                  } else {
                    log('作为接收方，连接已建立，准备接收文件');
                  }
                } else if (retryCount >= maxRetries) {
                  log(`已达到最大重试次数 (${maxRetries})，请尝试手动连接或刷新页面`);
                  localStorage.setItem('webrtcRetryCount', '0');
                  localStorage.setItem('isConnecting', 'false');
                }
              }, 10000);  // 10秒后检查连接状态
              
              // 当连接状态变化时清除定时器和添加文件信息发送逻辑
              conn.onconnectionstatechange = () => {
                if (conn.connectionState === 'connected') {
                  clearTimeout(connectionCheckTimer);
                  log('连接已成功建立，重置重试计数');
                  localStorage.setItem('webrtcRetryCount', '0');
                  localStorage.setItem('isConnecting', 'false');
                  
                  // 添加: 如果是发送方且有文件信息，确保在连接建立后发送
                  const currentRole = localStorage.getItem('webrtcRole') || role;
                  if (currentRole === 'sender') {
                    // 再次尝试从localStorage获取文件信息（如果状态中没有）
                    let currentFileInfo = fileInfo;
                    if (currentFileInfo.length === 0) {
                      const savedFileInfo = localStorage.getItem('webrtcFileInfo');
                      if (savedFileInfo) {
                        try {
                          const parsedFileInfo = JSON.parse(savedFileInfo);
                          if (Array.isArray(parsedFileInfo) && parsedFileInfo.length > 0) {
                            currentFileInfo = parsedFileInfo;
                            setFileInfo(parsedFileInfo);
                            log(`连接状态变化时，从localStorage恢复了 ${parsedFileInfo.length} 个文件的信息`);
                          }
                        } catch (error) {
                          log(`尝试恢复文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                        }
                      }
                    }
                    
                    if (currentFileInfo.length > 0) {
                      // 通过WebSocket发送
                      if (socketRef.current && socketRef.current.connected) {
                        log('连接已建立，通过WebSocket发送文件信息...');
                        socketRef.current.emit('files_info', { files: currentFileInfo });
                      }
                      
                      // 获取当前的数据通道 - 修复引用问题
                      const currentChannel = channel;
                      
                      // 如果数据通道已开启，也通过数据通道发送
                      if (currentChannel && currentChannel.readyState === 'open') {
                        log('连接已建立，通过数据通道发送文件信息...');
                        setTimeout(() => {
                          try {
                            currentChannel.send(JSON.stringify({
                              type: 'files_info',
                              files: currentFileInfo
                            }));
                            log('已通过数据通道发送文件信息');
                          } catch (error) {
                            log(`通过数据通道发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                          }
                        }, 1000);
                      } else {
                        log('数据通道未准备好，稍后将通过数据通道事件发送文件信息');
                      }
                    } else {
                      log('没有可发送的文件信息，请检查是否选择了文件');
                    }
                  } else {
                    log('作为接收方，连接已建立，准备接收文件');
                  }
                }
              };
            } catch (error) {
              log(`创建offer失败: ${error instanceof Error ? error.message : String(error)}`);
              localStorage.setItem('isConnecting', 'false');
            }
          }, 1000);
        } else if (!isSender) {
          log('作为接收方等待offer');
          localStorage.setItem('isConnecting', 'false');
        }
      }, 500);
    } catch (error) {
      log(`连接初始化失败: ${error}`);
      localStorage.setItem('isConnecting', 'false');
    }
  };
  
  // 在组件挂载时初始化socket对象
  useEffect(() => {
    // 如果已经存在会话ID，尝试重新连接
    const savedSessionId = localStorage.getItem('webrtcSessionId');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      connectWebSocket(savedSessionId);
    }
    
    // 清理函数
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connectWebSocket]);
  
  // 组件初始化时的清理逻辑，避免旧的连接状态导致问题
  useEffect(() => {
    // 将组件的连接状态重置为未连接
    setStatus('未连接');
    setConnectionDetails({
      connectionState: '未连接',
      iceConnectionState: '未连接',
      iceGatheringState: '未开始',
      signalingState: '稳定',
      dataChannelState: '关闭'
    });
    
    // 记录组件初始化
    log('页面已加载，状态已重置');
    
    // 如果已经存在会话ID，尝试重新连接
    const savedSessionId = localStorage.getItem('webrtcSessionId');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      // 稍微延迟连接，确保组件完全初始化
      setTimeout(() => {
        log(`尝试重新连接到会话: ${savedSessionId}`);
        connectWebSocket(savedSessionId);
      }, 1000);
    }
    
    // 清理函数
    return () => {
      if (socketRef.current) {
        log('组件卸载，关闭WebSocket连接');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // 清除所有连接状态标志
      localStorage.removeItem('isConnecting');
      localStorage.removeItem('isWebSocketReconnecting');
    };
  }, [connectWebSocket]);
  
  // 文件选择处理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files);
      
      // 更新React状态和ref
      setSelectedFiles(files);
      selectedFilesRef.current = files;
      
      // 创建文件信息数组
      const filesInfo = files.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type,
        id: `file_${Math.random().toString(36).substring(2, 15)}`
      }));
      
      setFileInfo(filesInfo);
      log(`已选择 ${files.length} 个文件，总大小: ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}`);
      
      // 将文件信息保存到localStorage，确保在连接重试过程中不会丢失
      try {
        localStorage.setItem('webrtcFileInfo', JSON.stringify(filesInfo));
        
        // 额外存储文件状态持久化标记
        localStorage.setItem('webrtcHasSelectedFiles', 'true');
        log('已将文件信息保存到localStorage');
      } catch (error) {
        log(`保存文件信息到localStorage失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // 如果已连接，发送文件信息
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('files_info', { files: filesInfo });
        log('已向接收方发送文件信息');
      }
      
      // 如果数据通道已打开，也通过数据通道发送
      if (channel && channel.readyState === 'open') {
        try {
          channel.send(JSON.stringify({
            type: 'files_info',
            files: filesInfo
          }));
          log('已通过数据通道发送文件信息');
        } catch (error) {
          log(`通过数据通道发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  };
  
  // 格式化字节数为可读格式
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };
  
  // 发送文件数据
  const sendFile = async (file: File, fileId: string) => {
    // 优先使用ref引用的数据通道，其次使用React状态，确保获取最新数据通道
    const currentChannel = dataChannelRef.current || channel;
    
    if (!currentChannel || currentChannel.readyState !== 'open') {
      log('数据通道未打开，无法发送文件');
      return;
    }
    
    try {
      // 避免重复发送
      if (transfersInProgress.current[fileId]) {
        log(`文件 ${file.name} (${fileId}) 已在传输中`);
        return;
      }
      
      transfersInProgress.current[fileId] = true;
      
      // 初始化进度
      setTransferProgress(prev => ({...prev, [fileId]: 0}));
      
      log(`开始发送文件: ${file.name} (${formatBytes(file.size)})`);
      
      // 发送文件开始命令
      currentChannel.send(JSON.stringify({
        type: 'file-start',
        fileId,
        name: file.name,
        size: file.size,
        fileType: file.type
      }));
      
      // 读取文件
      const reader = new FileReader();
      const chunkSize = fileChunkSize; // 每个块的大小
      let offset = 0;
      
      const readSlice = (o: number) => {
        const slice = file.slice(o, o + chunkSize);
        reader.readAsArrayBuffer(slice);
      };
      
      reader.onload = async (e) => {
        // 每次读取时重新获取通道状态，避免在文件传输过程中通道状态改变
        const activeChannel = dataChannelRef.current || channel;
        
        if (e.target?.result && activeChannel && activeChannel.readyState === 'open') {
          const chunk = e.target.result;
          
          try {
            // 发送二进制数据 - 确保类型正确
            if (chunk instanceof ArrayBuffer) {
              activeChannel.send(chunk);
            } else if (typeof chunk === 'string') {
              activeChannel.send(chunk);
            } else {
              throw new Error('不支持的数据类型');
            }
            
            // 假设是ArrayBuffer类型
            const byteLength = chunk instanceof ArrayBuffer ? chunk.byteLength : 
                             (typeof chunk === 'string' ? new TextEncoder().encode(chunk).length : 0);
            
            offset += byteLength;
            
            // 更新进度
            const progress = Math.min(100, Math.round((offset / file.size) * 100));
            setTransferProgress(prev => ({...prev, [fileId]: progress}));
            
            // 如果还有数据，继续读取
            if (offset < file.size) {
              readSlice(offset);
            } else {
              // 发送文件结束命令
              activeChannel.send(JSON.stringify({
                type: 'file-end',
                fileId
              }));
              
              log(`文件 ${file.name} 发送完成`);
              transfersInProgress.current[fileId] = false;
            }
          } catch (error) {
            log(`发送文件块失败: ${error instanceof Error ? error.message : String(error)}`);
            transfersInProgress.current[fileId] = false;
          }
        } else {
          if (!activeChannel) {
            log('数据通道已丢失，无法继续发送文件');
          } else if (activeChannel.readyState !== 'open') {
            log(`数据通道状态改变为 ${activeChannel.readyState}，无法继续发送文件`);
          }
          transfersInProgress.current[fileId] = false;
        }
      };
      
      reader.onerror = (error) => {
        log(`读取文件失败: ${error}`);
        transfersInProgress.current[fileId] = false;
      };
      
      // 开始读取第一块
      readSlice(0);
    } catch (error) {
      log(`发送文件失败: ${error instanceof Error ? error.message : String(error)}`);
      transfersInProgress.current[fileId] = false;
    }
  };
  
  // 发送所有选中文件
  const sendAllFiles = () => {
    // 首先检查ref中的文件数组
    let filesToSend = selectedFilesRef.current;
    
    // 如果ref为空，检查状态
    if (filesToSend.length === 0) {
      filesToSend = selectedFiles;
    }
    
    // 如果仍然为空，尝试从DOM中恢复
    if (filesToSend.length === 0) {
      log('状态中没有选择的文件，尝试查找文件输入...');
      
      // 从localStorage恢复文件信息
      const savedFileInfo = localStorage.getItem('webrtcFileInfo');
      const hasSelectedFiles = localStorage.getItem('webrtcHasSelectedFiles') === 'true';
      
      if (savedFileInfo && hasSelectedFiles) {
        try {
          const parsedFileInfo = JSON.parse(savedFileInfo);
          if (Array.isArray(parsedFileInfo) && parsedFileInfo.length > 0) {
            log(`从localStorage恢复了 ${parsedFileInfo.length} 个文件的信息`);
            
            // 获取文件输入元素 - 尝试多种选择器
            const fileInputs = document.querySelectorAll('input[type="file"]');
            let foundFiles = false;
            
            for (const input of fileInputs) {
              const inputElement = input as HTMLInputElement;
              if (inputElement.files && inputElement.files.length > 0) {
                const files = Array.from(inputElement.files);
                log(`找到了文件输入，包含 ${files.length} 个文件`);
                
                // 更新状态和ref
                setSelectedFiles(files);
                selectedFilesRef.current = files;
                foundFiles = true;
                
                // 发送找到的文件
                log(`开始传输 ${files.length} 个文件`);
                files.forEach((file, index) => {
                  const fileId = parsedFileInfo[index]?.id || `file_${Math.random().toString(36).substring(2, 15)}`;
                  setTimeout(() => sendFile(file, fileId), index * 500);
                });
                break;
              }
            }
            
            if (!foundFiles) {
              log('未找到包含文件的输入元素，尝试创建新的文件请求');
              
              // 提示用户重新选择文件
              if (typeof window !== 'undefined' && confirm('需要重新选择文件才能发送。现在重新选择文件吗？')) {
                const newInput = document.createElement('input');
                newInput.type = 'file';
                newInput.multiple = true;
                newInput.style.display = 'none';
                
                // 添加选择文件事件处理
                newInput.onchange = (e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.files && target.files.length > 0) {
                    const files = Array.from(target.files);
                    
                    // 更新状态和ref
                    setSelectedFiles(files);
                    selectedFilesRef.current = files;
                    
                    // 再次发送文件
                    log(`用户重新选择了 ${files.length} 个文件，开始传输`);
                    files.forEach((file, index) => {
                      const fileId = parsedFileInfo[index]?.id || `file_${Math.random().toString(36).substring(2, 15)}`;
                      setTimeout(() => sendFile(file, fileId), index * 500);
                    });
                    
                    // 清理临时输入元素
                    document.body.removeChild(newInput);
                  }
                };
                
                // 添加到DOM并触发点击
                document.body.appendChild(newInput);
                newInput.click();
                return;
              }
            }
            
            return; // 已经处理了文件或请求用户重新选择，直接返回
          }
        } catch (error) {
          log(`解析文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      log('没有找到文件或用户取消了选择');
      return;
    }
    
    // 如果找到了文件，发送它们
    log(`开始发送 ${filesToSend.length} 个文件`);
    filesToSend.forEach((file, index) => {
      const fileId = fileInfo[index]?.id || `file_${Math.random().toString(36).substring(2, 15)}`;
      setTimeout(() => sendFile(file, fileId), index * 500); // 稍微错开时间
    });
  };
  
  // 确认接收文件
  const confirmReceiveFiles = () => {
    // 优先使用ref引用的数据通道
    const currentChannel = dataChannelRef.current || channel;
    
    if (currentChannel && currentChannel.readyState === 'open') {
      currentChannel.send(JSON.stringify({
        type: 'file-confirm',
        confirmed: true
      }));
      
      log('已确认接收文件');
      setShowFileConfirm(false);
    } else {
      log('数据通道未开启，无法确认接收文件');
    }
  };
  
  // 拒绝接收文件
  const rejectReceiveFiles = () => {
    // 优先使用ref引用的数据通道
    const currentChannel = dataChannelRef.current || channel;
    
    if (currentChannel && currentChannel.readyState === 'open') {
      currentChannel.send(JSON.stringify({
        type: 'file-confirm',
        confirmed: false
      }));
      
      log('已拒绝接收文件');
      setShowFileConfirm(false);
    } else {
      log('数据通道未开启，无法拒绝接收文件');
    }
  };
  
  // 下载接收到的文件
  const downloadFile = (fileId: string) => {
    try {
      const fileData = receivingFiles[fileId];
      if (!fileData) {
        log(`找不到文件数据: ${fileId}`);
        return;
      }
      
      // 合并所有块
      const totalLength = fileData.buffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of fileData.buffer) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      
      // 创建 Blob 并下载
      const blob = new Blob([result], { type: fileData.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileData.name;
      a.click();
      
      // 清理
      URL.revokeObjectURL(url);
      
      log(`文件 ${fileData.name} 下载完成`);
      
      // 从接收列表中移除
      const newReceivingFiles = {...receivingFiles};
      delete newReceivingFiles[fileId];
      setReceivingFiles(newReceivingFiles);
      
    } catch (error) {
      log(`下载文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 处理接收到的数据通道消息
  const handleDataChannelMessage = (event: MessageEvent) => {
    try {
      // 检查是否是二进制数据
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        // 这里处理二进制数据，通常是文件块
        processFileChunk(event.data);
        return;
      }
      
      // 处理文本消息 (JSON)
      const data = JSON.parse(event.data);
      log(`收到数据: ${JSON.stringify(data).substring(0, 100)}...`);
      
      switch (data.type) {
        case 'message':
          log(`收到消息: ${data.text}`);
          break;
          
        case 'file-start':
          log(`开始接收文件: ${data.name} (${formatBytes(data.size)})`);
          
          // 初始化文件接收 - 使用立即执行的函数确保状态更新被同步执行
          (async () => {
            // 创建更新函数，并立即获取更新后的状态
            const newState = { 
              ...receivingFiles,
              [data.fileId]: {
                name: data.name,
                size: data.size,
                type: data.fileType,
                progress: 0,
                buffer: [],
                received: 0,
                id: data.fileId
              }
            };
            
            // 立即更新本地状态引用，以便后续文件块可以立即使用
            // 这里创建一个本地引用，用于后续临时访问
            Object.assign(receivingFiles, newState);
            
            // 然后正式通过React更新状态
            setReceivingFiles(newState);
            
            log(`已初始化文件接收状态: ${data.fileId}`);
          })();
          break;
          
        case 'file-end':
          log(`文件接收完成: ${receivingFiles[data.fileId]?.name}`);
          
          // 更新文件状态
          setReceivingFiles(prev => {
            const updated = {...prev};
            if (updated[data.fileId]) {
              updated[data.fileId].progress = 100;
            }
            return updated;
          });
          break;
          
        case 'files_info':
          log(`通过数据通道收到文件信息: ${data.files.length} 个文件`);
          setFileInfo(data.files);
          setShowFileConfirm(true);
          break;
          
        case 'file-confirm':
          if (data.confirmed) {
            log('接收方已确认接收文件，开始传输');
            sendAllFiles();
          } else {
            log('接收方拒绝接收文件');
          }
          break;
          
        case 'request_files_info':
          // 响应文件信息请求
          log('收到文件信息请求');
          if (fileInfo.length > 0) {
            log(`发送 ${fileInfo.length} 个文件的信息到接收方`);
            try {
              // 直接使用当前上下文中的数据通道
              const currentChannel = channel;
              if (currentChannel && currentChannel.readyState === 'open') {
                currentChannel.send(JSON.stringify({
                  type: 'files_info',
                  files: fileInfo
                }));
                log('已发送文件信息');
              } else {
                log('数据通道不可用，无法发送文件信息');
                // 尝试通过WebSocket发送
                if (socketRef.current && socketRef.current.connected) {
                  socketRef.current.emit('files_info', { files: fileInfo });
                  log('通过WebSocket发送文件信息');
                }
              }
            } catch (error) {
              log(`发送文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else {
            log('没有可发送的文件信息');
          }
          break;
          
        default:
          log(`收到未知类型消息: ${data.type}`);
      }
    } catch (error) {
      log(`处理数据通道消息失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 处理接收到的文件块
  const processFileChunk = async (chunk: ArrayBuffer | Blob) => {
    try {
      // 转换Blob到ArrayBuffer (如果需要)
      const buffer = chunk instanceof Blob 
        ? await chunk.arrayBuffer() 
        : chunk;
      
      // 找出当前正在接收哪个文件
      const activeFileIds = Object.keys(receivingFiles).filter(id => 
        receivingFiles[id] && receivingFiles[id].progress < 100
      );
      
      if (activeFileIds.length === 0) {
        log('收到文件块，但没有活跃的文件传输');
        return;
      }
      
      // 假设只传一个文件，或者最先开始的文件
      const fileId = activeFileIds[0];
      
      // 检查文件数据是否存在
      if (!receivingFiles[fileId]) {
        log(`找不到文件ID: ${fileId}，可能是状态同步问题`);
        return;
      }
      
      // 直接修改一个本地副本，然后用它来更新状态
      const updated = {...receivingFiles};
      const fileData = updated[fileId];
      
      // 添加块到buffer
      const newChunk = new Uint8Array(buffer);
      fileData.buffer.push(newChunk);
      fileData.received += newChunk.length;
      fileData.progress = Math.min(100, Math.round((fileData.received / fileData.size) * 100));
      
      // 更新状态
      setReceivingFiles(updated);
      
      // 同时更新本地引用，确保下一个块能立即访问到最新状态
      Object.assign(receivingFiles, updated);
      
      log(`处理文件块: ${fileId}, 进度: ${fileData.progress}%`);
      
    } catch (error) {
      log(`处理文件块失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 添加缺失的addRemoteIceCandidates函数
  const addRemoteIceCandidates = () => {
    try {
      const candidates = JSON.parse(iceValue);
      if (Array.isArray(candidates)) {
        log(`正在添加 ${candidates.length} 个ICE候选...`);
        candidates.forEach(candidate => {
          if (rtcConnectionRef.current) {
            rtcConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
              .then(() => log('添加ICE候选成功'))
              .catch(err => log(`添加ICE候选失败: ${err}`));
          }
        });
      } else {
        log('ICE候选格式无效，应为数组');
      }
      // 清空输入框
      setIceValue('');
    } catch (error) {
      log(`解析ICE候选失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // 添加缺失的状态变量
  const [offerText, setOfferText] = useState<string>('');
  const [answerText, setAnswerText] = useState<string>('');
  
  // 添加新的 useEffect 钩子来恢复文件信息
  // 在组件加载时恢复保存的文件信息
  useEffect(() => {
    // 尝试从 localStorage 恢复文件信息
    const savedFileInfo = localStorage.getItem('webrtcFileInfo');
    const hasSelectedFiles = localStorage.getItem('webrtcHasSelectedFiles') === 'true';
    
    if (savedFileInfo && hasSelectedFiles) {
      try {
        const parsedFileInfo = JSON.parse(savedFileInfo);
        if (Array.isArray(parsedFileInfo) && parsedFileInfo.length > 0) {
          setFileInfo(parsedFileInfo);
          log(`从 localStorage 恢复了 ${parsedFileInfo.length} 个文件的信息`);
          
          // 尝试查找或请求文件
          setTimeout(() => {
            // 如果状态中仍然没有文件，检查DOM
            if (selectedFiles.length === 0 && selectedFilesRef.current.length === 0) {
              const fileInputs = document.querySelectorAll('input[type="file"]');
              for (const input of fileInputs) {
                const inputElement = input as HTMLInputElement;
                if (inputElement.files && inputElement.files.length > 0) {
                  const files = Array.from(inputElement.files);
                  log(`在DOM中找到了 ${files.length} 个文件`);
                  setSelectedFiles(files);
                  selectedFilesRef.current = files;
                  break;
                }
              }
            }
          }, 1000);
        }
      } catch (error) {
        log(`解析文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, []);
  
  // 修改UI部分的变量名称
  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">WebRTC 文件传输</h1>
      
      {/* 状态和控制区域 */}
      <div className="bg-white p-4 rounded shadow-md mb-4">
        <div className="bg-gray-100 p-3 rounded mb-4">
          <div className="text-sm font-medium">连接状态: <span className="font-bold">{status}</span></div>
          <div className="text-sm font-medium">WebSocket: <span className="font-bold">{socketRef.current?.connected ? '已连接' : '未连接'}</span></div>
          <div className="text-sm font-medium">角色: <span className="font-bold">{role || '未设置'}</span></div>
          {sessionId && <div className="text-sm font-medium">会话ID: <span className="font-bold">{sessionId}</span></div>}
          {roomCode && <div className="text-sm font-medium">房间密码: <span className="font-bold">{roomCode}</span></div>}
          <div className="mt-2">
            <button 
              onClick={cleanAllStorage}
              className="bg-yellow-500 text-white px-3 py-1 rounded text-sm hover:bg-yellow-600"
            >
              清理所有缓存并刷新
            </button>
          </div>
        </div>
        
        {/* 未选择角色时显示选择界面 */}
        {!role && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="border p-3 rounded text-center">
              <h2 className="text-lg font-semibold mb-4">我要发送文件</h2>
              <div className="mb-4">
                <input 
                  type="file" 
                  multiple
                  onChange={handleFileSelect}
                  className="border p-2 rounded w-full bg-gray-50"
                />
              </div>
              {selectedFiles.length > 0 && (
                <>
                  <div className="mb-3 text-left">
                    <h3 className="font-medium mb-1">已选择 {selectedFiles.length} 个文件:</h3>
                    <ul className="text-sm bg-gray-50 p-2 rounded max-h-40 overflow-y-auto">
                      {selectedFiles.map((file, index) => (
                        <li key={index} className="mb-1">
                          {file.name} ({formatBytes(file.size)})
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button 
                    onClick={createSession} 
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 w-full"
                  >
                    创建传输会话
                  </button>
                </>
              )}
            </div>
            
            <div className="border p-3 rounded text-center">
              <h2 className="text-lg font-semibold mb-4">我要接收文件</h2>
              <div className="mb-4">
                <input 
                  type="text" 
                  placeholder="输入6位房间密码"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  className="border px-3 py-2 rounded w-full mb-3"
                />
                <button 
                  onClick={joinSession} 
                  className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 w-full"
                  disabled={!roomCode || roomCode.length !== 6}
                >
                  加入传输会话
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* 发送方界面 */}
        {role === 'sender' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">文件发送</h2>
            
            {selectedFiles.length > 0 ? (
              <div className="mb-3">
                <h3 className="font-medium mb-1">传输文件列表:</h3>
                <ul className="text-sm bg-gray-50 p-2 rounded max-h-60 overflow-y-auto">
                  {selectedFiles.map((file, index) => (
                    <li key={index} className="mb-1">
                      <div className="flex justify-between">
                        <span>{file.name} ({formatBytes(file.size)})</span>
                        {transferProgress[fileInfo[index]?.id] !== undefined && (
                          <span>{transferProgress[fileInfo[index]?.id]}%</span>
                        )}
                      </div>
                      {transferProgress[fileInfo[index]?.id] !== undefined && (
                        <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                          <div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${transferProgress[fileInfo[index]?.id]}%`}}></div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="text-sm text-gray-600 mt-2">
                  等待接收方加入会话并确认接收文件... 
                  {status === 'connected' && <span className="text-green-600">WebRTC连接已建立</span>}
                </div>
              </div>
            ) : (
              <div className="mb-3">
                <input 
                  type="file" 
                  multiple
                  onChange={handleFileSelect}
                  className="border p-2 rounded w-full bg-gray-50"
                />
                <div className="text-sm text-red-500 mt-1">请选择要发送的文件</div>
              </div>
            )}
            
            <div className="flex gap-2 mt-4">
              <button
                onClick={closeConnection}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                取消传输
              </button>
            </div>
          </div>
        )}
        
        {/* 接收方界面 */}
        {role === 'receiver' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">文件接收</h2>
            
            {/* 如果未收到文件信息，显示请求按钮 */}
            {(!showFileConfirm && fileInfo.length === 0 && role === 'receiver') && (
              <div className="mb-3">
                <div className="bg-blue-50 border border-blue-200 p-3 rounded mb-3">
                  <p className="mb-2">尚未收到文件信息，可能是因为发送方还未选择文件或通信延迟。</p>
                  <button 
                    onClick={() => {
                      log('请求文件信息...');
                      // 通过数据通道请求
                      if (channel && channel.readyState === 'open') {
                        try {
                          channel.send(JSON.stringify({
                            type: 'request_files_info'
                          }));
                          log('已通过数据通道请求文件信息');
                        } catch (error) {
                          log(`通过数据通道请求文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                        }
                      } else {
                        log('数据通道未开启，无法通过数据通道请求');
                      }
                      
                      // 同时通过WebSocket请求
                      if (socketRef.current && socketRef.current.connected) {
                        try {
                          socketRef.current.emit('request_files_info', { 
                            deviceId,
                            sessionId: localStorage.getItem('webrtcSessionId') || sessionId
                          });
                          log('已通过WebSocket请求文件信息');
                        } catch (error) {
                          log(`通过WebSocket请求文件信息失败: ${error instanceof Error ? error.message : String(error)}`);
                        }
                      } else {
                        log('WebSocket未连接，无法通过WebSocket请求');
                      }
                      
                      // 尝试重新建立连接
                      setTimeout(() => {
                        log('尝试重新发送连接请求...');
                        requestConnection();
                      }, 1000);
                    }} 
                    className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600 w-full mt-2"
                  >
                    请求文件信息
                  </button>
                </div>
              </div>
            )}
            
            {/* 文件确认对话框 */}
            {showFileConfirm && fileInfo.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded mb-3">
                <h3 className="font-medium mb-1">发送方请求发送以下文件:</h3>
                <ul className="text-sm mb-2 max-h-40 overflow-y-auto">
                  {fileInfo.map((file, index) => (
                    <li key={index} className="mb-1">{file.name} ({formatBytes(file.size)})</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button 
                    onClick={confirmReceiveFiles} 
                    className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
                  >
                    接收文件
                  </button>
                  <button 
                    onClick={rejectReceiveFiles} 
                    className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
                  >
                    拒绝接收
                  </button>
                </div>
              </div>
            )}
            
            {/* 接收文件列表 */}
            {Object.keys(receivingFiles).length > 0 && (
              <div className="mb-3">
                <h3 className="font-medium mb-1">接收文件进度:</h3>
                <ul className="text-sm bg-gray-50 p-2 rounded max-h-60 overflow-y-auto">
                  {Object.entries(receivingFiles).map(([fileId, file]) => (
                    <li key={fileId} className="mb-2">
                      <div className="flex justify-between">
                        <span>{file.name} ({formatBytes(file.size)})</span>
                        <span>{file.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1">
                        <div className="bg-green-600 h-2.5 rounded-full" style={{width: `${file.progress}%`}}></div>
                      </div>
                      {file.progress === 100 && (
                        <button 
                          onClick={() => downloadFile(fileId)} 
                          className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                        >
                          下载文件
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="flex gap-2 mt-4">
              <button
                onClick={closeConnection}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                断开连接
              </button>
            </div>
          </div>
        )}
        
        {/* 连接详情（折叠） */}
        <details className="mt-4">
          <summary className="text-lg font-semibold cursor-pointer">连接详情</summary>
          <div className="bg-gray-50 p-3 rounded text-sm mt-2">
            <div className="mb-1">连接状态: <span className="font-medium">{connectionDetails.connectionState}</span></div>
            <div className="mb-1">ICE连接状态: <span className="font-medium">{connectionDetails.iceConnectionState}</span></div>
            <div className="mb-1">ICE收集状态: <span className="font-medium">{connectionDetails.iceGatheringState}</span></div>
            <div className="mb-1">信令状态: <span className="font-medium">{connectionDetails.signalingState}</span></div>
            <div className="mb-1">数据通道状态: <span className="font-medium">{connectionDetails.dataChannelState}</span></div>
          </div>
        </details>
        
        {/* 日志区域（折叠） */}
        <details className="mt-4">
          <summary className="text-lg font-semibold cursor-pointer">操作日志</summary>
          <div className="mt-2">
            <div className="flex justify-between mb-2">
              <h2 className="text-lg font-semibold">日志</h2>
              <button onClick={() => setLogs([])} className="text-red-500 text-sm">清空</button>
            </div>
            <div className="bg-black text-green-400 p-3 rounded h-64 overflow-y-auto text-sm font-mono">
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
} 