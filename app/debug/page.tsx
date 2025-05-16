'use client';

import React, { useState, useEffect } from 'react';

export default function DebugPage() {
  const [isSender, setIsSender] = useState<boolean | null>(null);
  const [code, setCode] = useState<string>('');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  const [rtcConnection, setRtcConnection] = useState<RTCPeerConnection | null>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<string>('未连接');
  const [iceConnectionState, setIceConnectionState] = useState<string>('未连接');
  const [dataChannelState, setDataChannelState] = useState<string>('未开启');

  // 添加日志
  const addLog = (message: string) => {
    console.log(message);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // 生成设备ID
  useEffect(() => {
    const id = 'device_' + Math.random().toString(36).substring(2, 10);
    setDeviceId(id);
    addLog(`设备ID生成: ${id}`);
  }, []);

  // 生成6位随机密码
  const generateCode = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    addLog(`生成6位密码: ${code}`);
    return code;
  };

  // 创建会话（发送方）
  const createSession = async () => {
    try {
      const code = generateCode();
      addLog(`正在创建会话...`);
      
      const response = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        setSessionId(data.sessionId);
        setIsSender(true);
        addLog(`会话创建成功，ID: ${data.sessionId}`);
        
        // 建立WebSocket连接
        connectWebSocket(data.sessionId);
      } else {
        addLog(`会话创建失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      addLog(`会话创建错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 加入会话（接收方）
  const joinSession = async () => {
    if (!code || code.length !== 6) {
      addLog('请输入有效的6位密码');
      return;
    }

    try {
      addLog(`正在加入会话...`);
      
      const response = await fetch('/api/session/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
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
        setSessionId(data.sessionId);
        setIsSender(false);
        addLog(`会话加入成功，ID: ${data.sessionId}`);
        addLog(`对方设备: ${data.peerInfo.name} (${data.peerInfo.platform})`);
        
        // 建立WebSocket连接
        connectWebSocket(data.sessionId);
      } else {
        addLog(`会话加入失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      addLog(`会话加入错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 建立WebSocket连接
  const connectWebSocket = (sessionId: string) => {
    addLog('正在连接WebSocket...');
    
    // 在客户端动态导入socket.io-client
    import('socket.io-client').then(({ io }) => {
      const socket = io(`${window.location.origin}`, {
        query: {
          sessionId,
          deviceId
        }
      });

      socket.on('connect', () => {
        addLog(`WebSocket已连接，ID: ${socket.id}`);
      });

      socket.on('connect_error', (error) => {
        addLog(`WebSocket连接错误: ${error.message}`);
      });

      socket.on('peer_event', (data) => {
        addLog(`收到对等事件: ${data.event}, 从: ${data.deviceId}`);
        
        if (data.event === 'joined') {
          // 如果是发送方，则发起WebRTC连接
          if (isSender) {
            initWebRTC();
          }
        }
      });

      socket.on('offer', (data) => {
        addLog(`收到SDP offer，从: ${data.from}`);
        if (!isSender) {
          handleOffer(data.sdp);
        }
      });

      socket.on('answer', (data) => {
        addLog(`收到SDP answer，从: ${data.from}`);
        if (isSender) {
          handleAnswer(data.sdp);
        }
      });

      socket.on('ice_candidate', (data) => {
        addLog(`收到ICE候选，从: ${data.from}`);
        handleIceCandidate(data.candidate);
      });

      socket.on('disconnect', () => {
        addLog('WebSocket已断开');
      });

      // 保存socket实例到window
      window.socket = socket;
    });
  };

  // 初始化WebRTC
  const initWebRTC = () => {
    try {
      addLog('正在初始化WebRTC...');
      
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      const peerConnection = new RTCPeerConnection(configuration);
      setRtcConnection(peerConnection);
      
      // 监听连接状态变化
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        addLog(`WebRTC连接状态变化: ${state}`);
        setConnectionState(state);
      };
      
      // 监听ICE连接状态变化
      peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        addLog(`ICE连接状态变化: ${state}`);
        setIceConnectionState(state);
      };
      
      // 监听ICE候选收集状态
      peerConnection.onicegatheringstatechange = () => {
        addLog(`ICE收集状态: ${peerConnection.iceGatheringState}`);
      };
      
      // 监听信令状态变化
      peerConnection.onsignalingstatechange = () => {
        addLog(`信令状态: ${peerConnection.signalingState}`);
      };

      // 处理ICE候选
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          addLog('收集到新的ICE候选');
          sendIceCandidate(event.candidate);
        } else {
          addLog('ICE候选收集完成');
        }
      };

      // 创建数据通道（发送方）或监听数据通道（接收方）
      if (isSender) {
        const channel = peerConnection.createDataChannel('testChannel');
        setupDataChannel(channel);
        addLog('已创建数据通道');
        
        // 创建并发送offer
        createOffer(peerConnection);
      } else {
        peerConnection.ondatachannel = (event) => {
          addLog('接收到数据通道');
          setupDataChannel(event.channel);
        };
      }
      
      return peerConnection;
    } catch (error) {
      addLog(`WebRTC初始化错误: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  // 设置数据通道
  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = () => {
      addLog(`数据通道已打开: ${channel.label}`);
      setDataChannel(channel);
      setDataChannelState('已开启');
    };

    channel.onclose = () => {
      addLog('数据通道已关闭');
      setDataChannelState('已关闭');
    };

    channel.onerror = (event) => {
      addLog(`数据通道错误: ${(event as any).error?.message || '未知错误'}`);
    };

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        addLog(`收到消息: ${event.data}`);
      } else {
        addLog(`收到二进制数据: ${event.data.byteLength} 字节`);
      }
    };
  };

  // 创建offer
  const createOffer = async (peerConnection: RTCPeerConnection) => {
    try {
      addLog('正在创建offer...');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      addLog('已设置本地描述(offer)');
      
      // 选择使用WebSocket直接发送offer
      if (window.socket && window.socket.connected) {
        addLog('直接通过WebSocket发送offer');
        window.socket.emit('offer', { sdp: offer });
      } else {
        // 备用：通过REST API发送
        addLog('通过API发送offer到信令服务器');
        await fetch(`/api/session/${sessionId}/offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            sdp: offer
          }),
        });
      }
      addLog('Offer已发送');
    } catch (error) {
      addLog(`创建offer错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 处理收到的offer
  const handleOffer = async (sdp: RTCSessionDescriptionInit) => {
    try {
      addLog('正在处理offer...');
      
      if (!rtcConnection) {
        addLog('初始化WebRTC连接...');
        initWebRTC();
      }
      
      await rtcConnection?.setRemoteDescription(new RTCSessionDescription(sdp));
      addLog('已设置远程描述(offer)');
      
      const answer = await rtcConnection?.createAnswer();
      await rtcConnection?.setLocalDescription(answer);
      addLog('已设置本地描述(answer)');
      
      // 选择使用WebSocket直接发送answer
      if (window.socket && window.socket.connected) {
        addLog('直接通过WebSocket发送answer');
        window.socket.emit('answer', { sdp: answer });
      } else {
        // 备用：通过REST API发送
        addLog('通过API发送answer到信令服务器');
        await fetch(`/api/session/${sessionId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            sdp: answer
          }),
        });
      }
      addLog('Answer已发送');
    } catch (error) {
      addLog(`处理offer错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 处理收到的answer
  const handleAnswer = async (sdp: RTCSessionDescriptionInit) => {
    try {
      addLog('正在处理answer...');
      await rtcConnection?.setRemoteDescription(new RTCSessionDescription(sdp));
      addLog('已设置远程描述(answer)');
    } catch (error) {
      addLog(`处理answer错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 发送ICE候选
  const sendIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      addLog(`发送ICE候选: ${candidate.candidate?.slice(0, 50)}...`);
      
      // 选择使用WebSocket直接发送ICE候选
      if (window.socket && window.socket.connected) {
        addLog('直接通过WebSocket发送ICE候选');
        window.socket.emit('ice_candidate', { candidate });
      } else {
        // 备用：通过REST API发送
        addLog('通过API发送ICE候选到信令服务器');
        await fetch(`/api/session/${sessionId}/ice-candidate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            candidate
          }),
        });
      }
    } catch (error) {
      addLog(`发送ICE候选错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 处理收到的ICE候选
  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    try {
      if (rtcConnection) {
        await rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));
        addLog('已添加远程ICE候选');
      } else {
        addLog('无法添加ICE候选: WebRTC连接不存在');
      }
    } catch (error) {
      addLog(`添加ICE候选错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 发送测试消息
  const sendTestMessage = () => {
    if (dataChannel && dataChannel.readyState === 'open') {
      const message = `测试消息 ${new Date().toISOString()}`;
      dataChannel.send(message);
      addLog(`已发送消息: ${message}`);
    } else {
      addLog('无法发送消息: 数据通道未开启');
    }
  };

  // 关闭连接
  const closeConnection = () => {
    if (rtcConnection) {
      rtcConnection.close();
      setRtcConnection(null);
      setConnectionState('已关闭');
      setIceConnectionState('已关闭');
      addLog('WebRTC连接已关闭');
    }
    
    if (window.socket) {
      window.socket.disconnect();
      addLog('WebSocket连接已关闭');
    }
    
    setSessionId('');
    setIsSender(null);
  };

  return (
    <main className="flex min-h-screen flex-col p-6 bg-gray-100">
      <div className="w-full max-w-4xl mx-auto bg-white p-6 rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-6">WebRTC 调试页面</h1>
        
        {!isSender ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">选择角色</h2>
            <div className="flex space-x-4">
              <button 
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 px-6 rounded-lg font-medium"
                onClick={createSession}
              >
                作为发送方
              </button>
              
              <div className="flex-1 flex space-x-2">
                <input
                  type="text"
                  className="flex-1 border rounded-lg px-4 py-2"
                  placeholder="输入6位密码"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button 
                  className="bg-green-500 hover:bg-green-600 text-white py-2 px-6 rounded-lg font-medium"
                  onClick={joinSession}
                >
                  作为接收方
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">连接信息</h2>
              <button 
                className="text-red-500 hover:text-red-700"
                onClick={closeConnection}
              >
                关闭连接
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 bg-gray-100 p-4 rounded-lg">
              <div className="font-medium">角色:</div>
              <div>{isSender ? '发送方' : '接收方'}</div>
              
              <div className="font-medium">设备ID:</div>
              <div className="truncate">{deviceId}</div>
              
              {isSender && (
                <>
                  <div className="font-medium">会话密码:</div>
                  <div className="text-xl font-bold">{generatedCode}</div>
                </>
              )}
              
              <div className="font-medium">会话ID:</div>
              <div className="truncate">{sessionId}</div>
              
              <div className="font-medium">WebRTC状态:</div>
              <div>{connectionState}</div>
              
              <div className="font-medium">ICE状态:</div>
              <div>{iceConnectionState}</div>
              
              <div className="font-medium">数据通道:</div>
              <div>{dataChannelState}</div>
            </div>
            
            {dataChannel && dataChannel.readyState === 'open' && (
              <button 
                className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg font-medium"
                onClick={sendTestMessage}
              >
                发送测试消息
              </button>
            )}
          </div>
        )}
        
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">日志</h2>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg h-80 overflow-y-auto font-mono text-xs">
            {logs.map((log, index) => (
              <div key={index} className="pb-1">{log}</div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// 全局类型声明
declare global {
  interface Window {
    socket: any;
  }
} 