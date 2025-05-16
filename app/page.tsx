'use client';

import React, { useState, useEffect } from 'react';

export default function Home() {
  const [isSender, setIsSender] = useState<boolean | null>(null);
  const [code, setCode] = useState<string>('');
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [deviceId, setDeviceId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  const [peerInfo, setPeerInfo] = useState<any>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filesInfo, setFilesInfo] = useState<any[]>([]);
  const [transferStatus, setTransferStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [rtcConnection, setRtcConnection] = useState<any>(null);
  const [dataChannel, setDataChannel] = useState<any>(null);
  const [rtcState, setRtcState] = useState<string>('未连接');
  const [iceState, setIceState] = useState<string>('未连接');
  const [dataChannelState, setDataChannelState] = useState<string>('关闭');
  const [debug, setDebug] = useState<boolean>(false);

  // 生成设备 ID
  useEffect(() => {
    const id = 'device_' + Math.random().toString(36).substring(2, 10);
    setDeviceId(id);
  }, []);

  // 生成 6 位随机密码
  const generateCode = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);
    return code;
  };

  // 创建会话（发送方）
  const createSession = async () => {
    try {
      const code = generateCode();
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
        setSessionId(data.sessionId);
        setIsSender(true);
        setTransferStatus('等待接收方连接...');
        
        // 建立 WebSocket 连接
        connectWebSocket(data.sessionId);
      } else {
        setErrorMessage(data.error || '创建会话失败');
      }
    } catch (error) {
      setErrorMessage('创建会话时发生错误');
      console.error(error);
    }
  };

  // 加入会话（接收方）
  const joinSession = async () => {
    if (!code || code.length !== 6) {
      setErrorMessage('请输入有效的 6 位密码');
      return;
    }

    try {
      const response = await fetch('/api/session/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        setPeerInfo(data.peerInfo);
        setIsSender(false);
        setTransferStatus('已连接到发送方');
        
        // 建立 WebSocket 连接
        connectWebSocket(data.sessionId);
        
        // 主动请求发送方初始化连接
        setTimeout(() => {
          if (window.socket && window.socket.connected) {
            console.log('接收方主动请求发送方初始化WebRTC连接');
            window.socket.emit('request_connection', {
              deviceId,
              sessionId: data.sessionId
            });
          }
        }, 2000);
      } else {
        setErrorMessage(data.error || '加入会话失败');
      }
    } catch (error) {
      setErrorMessage('加入会话时发生错误');
      console.error(error);
    }
  };

  // 建立 WebSocket 连接
  const connectWebSocket = (sessionId: string) => {
    console.log(`开始连接WebSocket，会话ID: ${sessionId}，设备ID: ${deviceId}`);
    
    // 在客户端动态导入 socket.io-client
    import('socket.io-client').then(({ io }) => {
      const socket = io(`${window.location.origin}`, {
        query: {
          sessionId,
          deviceId
        }
      });

      socket.on('connect', () => {
        console.log('WebSocket 连接已建立，socket ID:', socket.id);
        
        // 如果是接收方，主动触发一次WebRTC初始化
        if (!isSender) {
          console.log('作为接收方加入了会话，准备初始化WebRTC');
          setTimeout(() => initWebRTC(), 1000);
        }
      });

      socket.on('connection_status', (data) => {
        console.log('连接状态:', data);
      });

      socket.on('peer_event', (data) => {
        console.log('接收到对等事件:', data);
        if (data.event === 'joined') {
          console.log('对方已加入会话，deviceId:', data.deviceId);
          // 如果是发送方，则发起 WebRTC 连接
          if (isSender) {
            console.log('作为发送方，开始初始化WebRTC连接');
            setTimeout(() => initWebRTC(), 1000);
          }
        } else if (data.event === 'left') {
          console.log('对方已离开会话');
          setTransferStatus('对方已断开连接');
        }
      });

      socket.on('offer', (data) => {
        console.log('收到offer:', data);
        if (!isSender && data.sdp) {
          console.log('接收方收到offer，处理中...');
          handleOffer(data.sdp);
        }
      });

      socket.on('answer', (data) => {
        console.log('收到answer:', data);
        if (isSender && data.sdp) {
          console.log('发送方收到answer，处理中...');
          handleAnswer(data.sdp);
        }
      });

      socket.on('ice_candidate', (data) => {
        console.log('收到ice_candidate:', data);
        if (data.candidate) {
          console.log('处理ICE候选...');
          handleIceCandidate(data.candidate);
        }
      });

      socket.on('files_info', (data) => {
        console.log('收到files_info:', data);
        if (!isSender) {
          setFilesInfo(data.files);
        }
      });

      socket.on('transfer_update', (data) => {
        console.log('收到transfer_update:', data);
        setTransferStatus(data.status);
        if (data.progress) setProgress(data.progress);
      });

      socket.on('disconnect', () => {
        console.log('WebSocket 连接已断开');
      });

      socket.on('request_connection', (data) => {
        console.log('收到连接请求:', data);
        if (isSender) {
          console.log('收到接收方请求，开始初始化WebRTC连接');
          setTimeout(() => initWebRTC(), 500);
        }
      });

      // 保存 socket 实例到状态中
      window.socket = socket;
    });
  };

  // 初始化 WebRTC 连接
  const initWebRTC = () => {
    try {
      console.log('初始化 WebRTC 连接');
      
      // 如果已经有连接，先关闭
      if (rtcConnection) {
        console.log('关闭现有的WebRTC连接');
        rtcConnection.close();
      }
      
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      console.log('创建新的RTCPeerConnection');
      const peerConnection = new RTCPeerConnection(configuration);
      setRtcConnection(peerConnection);
      setRtcState('正在连接');

      // ICE 连接状态变化
      peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE 连接状态变化:', peerConnection.iceConnectionState);
        setIceState(peerConnection.iceConnectionState);
      };

      // ICE 收集状态变化
      peerConnection.onicegatheringstatechange = () => {
        console.log('ICE 收集状态变化:', peerConnection.iceGatheringState);
      };

      // 信令状态变化
      peerConnection.onsignalingstatechange = () => {
        console.log('信令状态变化:', peerConnection.signalingState);
      };

      // 创建数据通道（发送方）
      if (isSender) {
        console.log('创建数据通道');
        const channel = peerConnection.createDataChannel('fileTransfer');
        setupDataChannel(channel);
      } else {
        // 接收方监听数据通道
        console.log('准备接收数据通道');
        peerConnection.ondatachannel = (event) => {
          console.log('收到数据通道');
          setupDataChannel(event.channel);
        };
      }

      // 处理 ICE 候选
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('收集到新的 ICE 候选:', event.candidate.candidate);
          sendIceCandidate(event.candidate);
        } else {
          console.log('ICE 候选收集完成');
        }
      };

      // 连接状态变化
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log('WebRTC 连接状态变化:', state);
        setRtcState(state);
        
        if (state === 'connected') {
          console.log('WebRTC 连接已建立');
          setConnected(true);
          setTransferStatus('WebRTC 连接已建立');
          
          // 如果是发送方，发送文件信息
          if (isSender && selectedFiles.length > 0) {
            console.log('发送文件信息...');
            sendFilesInfo();
          }
        } else if (state === 'failed') {
          console.error('WebRTC 连接失败');
          setErrorMessage('WebRTC 连接失败，请检查网络连接或重新启动会话');
        } else if (state === 'disconnected' || state === 'closed') {
          setConnected(false);
        }
      };

      // 如果是发送方，创建 offer
      if (isSender) {
        console.log('作为发送方，创建offer');
        createOffer(peerConnection);
      }

      return peerConnection;
    } catch (error) {
      console.error('初始化 WebRTC 失败:', error);
      setErrorMessage('初始化 WebRTC 连接失败: ' + (error instanceof Error ? error.message : String(error)));
      return null;
    }
  };

  // 设置数据通道
  const setupDataChannel = (channel: RTCDataChannel) => {
    try {
      channel.binaryType = 'arraybuffer';
      setDataChannelState(channel.readyState);
      
      channel.onopen = () => {
        console.log('数据通道已打开');
        setDataChannel(channel);
        setDataChannelState('open');
      };

      channel.onclose = () => {
        console.log('数据通道已关闭');
        setDataChannelState('closed');
      };

      channel.onerror = (event) => {
        console.error('数据通道错误:', event);
        setErrorMessage('数据通道发生错误');
      };

      channel.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data);
            console.log('收到消息:', message);
            
            if (message.type === 'ready_to_receive') {
              // 接收方准备好接收文件
              if (isSender) {
                sendFiles();
              }
            } else if (message.type === 'file_chunk_received') {
              // 更新进度
              setProgress(message.progress);
            } else if (message.type === 'transfer_complete') {
              setTransferStatus('传输完成');
              setProgress(1);
            }
          } else {
            console.log('收到二进制数据，长度:', event.data.byteLength);
          }
        } catch (error) {
          console.error('处理消息错误:', error);
        }
      };
    } catch (error) {
      console.error('设置数据通道失败:', error);
    }
  };

  // 创建 offer（发送方）
  const createOffer = async (peerConnection: RTCPeerConnection) => {
    try {
      console.log('创建 offer...');
      const offer = await peerConnection.createOffer();
      console.log('设置本地描述(offer)');
      await peerConnection.setLocalDescription(offer);
      console.log('本地描述设置完成');
      
      // 通过WebSocket直接发送offer
      if (window.socket && window.socket.connected) {
        console.log('通过WebSocket直接发送offer');
        window.socket.emit('offer', { sdp: offer });
        console.log('已通过WebSocket发送offer');
      } else {
        // 备用：通过API发送
        console.log('发送offer到信令服务器API');
        const response = await fetch(`/api/session/${sessionId}/offer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            sdp: offer
          }),
        });
        
        if (response.ok) {
          console.log('Offer已通过API发送到信令服务器');
        } else {
          console.error('发送offer失败:', await response.text());
        }
      }
    } catch (error) {
      console.error('创建或发送offer失败:', error);
    }
  };

  // 处理 offer（接收方）
  const handleOffer = async (sdp: any) => {
    console.log('处理接收到的offer');
    
    if (!rtcConnection) {
      console.log('初始化WebRTC连接(由于接收到offer)');
      initWebRTC();
      // 等待初始化完成
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    try {
      console.log('设置远程描述(offer)');
      await rtcConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('远程描述设置完成，创建answer');
      
      const answer = await rtcConnection.createAnswer();
      console.log('设置本地描述(answer)');
      await rtcConnection.setLocalDescription(answer);
      console.log('本地描述设置完成');
      
      // 通过WebSocket直接发送answer
      if (window.socket && window.socket.connected) {
        console.log('通过WebSocket直接发送answer');
        window.socket.emit('answer', { sdp: answer });
        console.log('已通过WebSocket发送answer');
      } else {
        // 备用：通过API发送
        console.log('发送answer到信令服务器API');
        const response = await fetch(`/api/session/${sessionId}/answer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            sdp: answer
          }),
        });
        
        if (response.ok) {
          console.log('Answer已通过API发送到信令服务器');
        } else {
          console.error('发送answer失败:', await response.text());
        }
      }
    } catch (error) {
      console.error('处理offer或发送answer失败:', error);
    }
  };

  // 处理 answer（发送方）
  const handleAnswer = async (sdp: any) => {
    try {
      console.log('处理接收到的answer');
      if (!rtcConnection) {
        console.error('无法处理answer: WebRTC连接不存在');
        return;
      }
      console.log('设置远程描述(answer)');
      await rtcConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('远程描述设置完成');
    } catch (error) {
      console.error('处理answer失败:', error);
    }
  };

  // 发送 ICE 候选
  const sendIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      console.log('发送ICE候选', candidate.candidate?.substring(0, 50) + '...');
      
      // 通过WebSocket直接发送ICE候选
      if (window.socket && window.socket.connected) {
        console.log('通过WebSocket直接发送ICE候选');
        window.socket.emit('ice_candidate', { candidate });
        console.log('已通过WebSocket发送ICE候选');
      } else {
        // 备用：通过API发送
        console.log('通过API发送ICE候选');
        const response = await fetch(`/api/session/${sessionId}/ice-candidate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            candidate
          }),
        });
        
        if (response.ok) {
          console.log('ICE候选已通过API发送到信令服务器');
        } else {
          console.error('发送ICE候选失败:', await response.text());
        }
      }
    } catch (error) {
      console.error('发送ICE候选失败:', error);
    }
  };

  // 处理 ICE 候选
  const handleIceCandidate = async (candidate: any) => {
    if (rtcConnection && candidate) {
      try {
        console.log('添加远程ICE候选:', candidate.candidate || candidate);
        await rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('远程ICE候选添加成功');
      } catch (error) {
        console.error('添加ICE候选失败:', error);
      }
    } else {
      console.warn('无法添加ICE候选: WebRTC连接不存在或候选无效');
    }
  };

  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  // 发送文件信息
  const sendFilesInfo = async () => {
    if (!selectedFiles.length) return;

    const filesInfo = selectedFiles.map(file => ({
      name: file.name,
      size: file.size,
      type: file.type
    }));

    try {
      await fetch(`/api/session/${sessionId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          files: filesInfo
        }),
      });
    } catch (error) {
      console.error('发送文件信息失败:', error);
    }
  };

  // 准备接收文件
  const readyToReceive = () => {
    if (dataChannel) {
      dataChannel.send(JSON.stringify({ type: 'ready_to_receive' }));
      setTransferStatus('准备接收文件...');
    }
  };

  // 发送文件
  const sendFiles = async () => {
    if (!dataChannel || !selectedFiles.length) return;

    setTransferStatus('开始发送文件...');
    setProgress(0);

    // 更新传输状态
    await fetch(`/api/session/${sessionId}/transfer-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId,
        status: 'transferring',
        progress: 0
      }),
    });

    const file = selectedFiles[0]; // 简化为一次只传一个文件
    const chunkSize = 16384; // 16KB
    const totalChunks = Math.ceil(file.size / chunkSize);
    let currentChunk = 0;

    // 发送文件元数据
    dataChannel.send(JSON.stringify({
      type: 'file_metadata',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }));

    const fileReader = new FileReader();
    let offset = 0;

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + chunkSize);
      fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = (e) => {
      if (dataChannel.readyState === 'open') {
        dataChannel.send(e.target?.result as ArrayBuffer);
        
        currentChunk++;
        offset += chunkSize;
        
        const currentProgress = Math.min(currentChunk / totalChunks, 1);
        setProgress(currentProgress);
        
        // 更新传输状态
        if (currentChunk % 10 === 0) { // 每10个块更新一次状态
          fetch(`/api/session/${sessionId}/transfer-status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              deviceId,
              status: 'transferring',
              progress: currentProgress
            }),
          });
        }

        if (currentChunk < totalChunks) {
          readNextChunk();
        } else {
          // 传输完成
          dataChannel.send(JSON.stringify({ type: 'file_complete' }));
          setTransferStatus('文件传输完成');
          
          fetch(`/api/session/${sessionId}/transfer-status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              deviceId,
              status: 'completed',
              progress: 1
            }),
          });
        }
      }
    };

    fileReader.onerror = () => {
      console.error('读取文件失败');
      setTransferStatus('文件传输失败');
      
      fetch(`/api/session/${sessionId}/transfer-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          status: 'failed',
          error: '读取文件失败'
        }),
      });
    };

    readNextChunk();
  };

  // 关闭会话
  const closeSession = async () => {
    if (sessionId) {
      try {
        await fetch(`/api/session/${sessionId}/close`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            reason: '用户主动关闭'
          }),
        });
        
        // 清理状态
        setSessionId('');
        setGeneratedCode('');
        setSelectedFiles([]);
        setFilesInfo([]);
        setTransferStatus('');
        setProgress(0);
        setConnected(false);
        setIsSender(null);
        
        // 关闭 WebRTC 连接
        if (rtcConnection) {
          rtcConnection.close();
          setRtcConnection(null);
        }
        
        // 关闭数据通道
        if (dataChannel) {
          dataChannel.close();
          setDataChannel(null);
        }
        
        // 关闭 WebSocket 连接
        if (window.socket) {
          window.socket.disconnect();
        }
      } catch (error) {
        console.error('关闭会话失败:', error);
      }
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-100">
      <div className="w-full max-w-3xl bg-white p-6 rounded-xl shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-center">FileLink 公网传输测试</h1>
          <button 
            className="text-xs text-gray-500 hover:text-gray-700"
            onClick={() => setDebug(!debug)}
          >
            {debug ? '隐藏调试' : '显示调试'}
          </button>
        </div>
        
        {/* 调试信息区域 */}
        {debug && sessionId && (
          <div className="bg-gray-100 border border-gray-300 p-3 rounded text-xs mb-4">
            <h3 className="font-bold mb-1">调试信息:</h3>
            <div className="grid grid-cols-2 gap-1">
              <div>WebRTC连接状态:</div><div>{rtcState}</div>
              <div>ICE连接状态:</div><div>{iceState}</div>
              <div>数据通道状态:</div><div>{dataChannelState}</div>
              <div>会话ID:</div><div className="truncate">{sessionId}</div>
            </div>
          </div>
        )}
        
        {errorMessage && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {errorMessage}
            <button 
              className="float-right font-bold" 
              onClick={() => setErrorMessage('')}
            >
              &times;
            </button>
          </div>
        )}
        
        {isSender === null ? (
          <div className="flex flex-col space-y-4">
            <h2 className="text-lg font-semibold mb-2">选择角色</h2>
            <div className="flex space-x-4">
              <button 
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 px-6 rounded-lg font-medium"
                onClick={() => createSession()}
              >
                我是发送方
              </button>
              <button 
                className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 px-6 rounded-lg font-medium"
                onClick={() => setIsSender(false)}
              >
                我是接收方
              </button>
            </div>
          </div>
        ) : isSender === false && !sessionId ? (
          <div className="flex flex-col space-y-4">
            <h2 className="text-lg font-semibold mb-2">输入密码加入会话</h2>
            <div className="flex space-x-2">
              <input
                type="text"
                className="flex-1 border rounded-lg px-4 py-2"
                placeholder="输入6位会话密码"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button 
                className="bg-green-500 hover:bg-green-600 text-white py-2 px-6 rounded-lg font-medium"
                onClick={joinSession}
              >
                加入
              </button>
            </div>
            <button 
              className="text-blue-500 hover:text-blue-700"
              onClick={() => setIsSender(null)}
            >
              返回
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {isSender && generatedCode && (
              <div className="bg-yellow-100 p-4 rounded-lg text-center">
                <h3 className="font-semibold mb-2">6位会话密码</h3>
                <div className="text-2xl font-bold tracking-wider bg-white p-2 rounded">{generatedCode}</div>
                <p className="text-sm mt-2">请将此密码告知接收方</p>
              </div>
            )}
            
            <div className="bg-gray-100 p-4 rounded-lg">
              <h3 className="font-semibold mb-2">会话信息</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="font-medium">角色:</div>
                <div>{isSender ? '发送方' : '接收方'}</div>
                <div className="font-medium">设备ID:</div>
                <div className="truncate">{deviceId}</div>
                <div className="font-medium">会话状态:</div>
                <div>{transferStatus || '准备中'}</div>
                {!isSender && peerInfo && (
                  <>
                    <div className="font-medium">对方设备:</div>
                    <div>{peerInfo.name} ({peerInfo.platform})</div>
                  </>
                )}
              </div>
            </div>
            
            {isSender && (
              <div className="space-y-4">
                <h3 className="font-semibold">选择要发送的文件</h3>
                <input
                  type="file"
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  onChange={handleFileChange}
                  multiple
                />
                
                {selectedFiles.length > 0 && (
                  <div className="bg-gray-100 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">已选择 {selectedFiles.length} 个文件</h4>
                    <ul className="text-sm space-y-1">
                      {selectedFiles.map((file, index) => (
                        <li key={index} className="truncate">
                          {file.name} ({(file.size / 1024).toFixed(2)} KB)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {connected && selectedFiles.length > 0 && (
                  <button 
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg font-medium"
                    onClick={sendFiles}
                  >
                    发送文件
                  </button>
                )}
              </div>
            )}
            
            {!isSender && filesInfo.length > 0 && (
              <div className="space-y-4">
                <div className="bg-gray-100 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">将接收的文件</h3>
                  <ul className="text-sm space-y-1">
                    {filesInfo.map((file, index) => (
                      <li key={index} className="truncate">
                        {file.name} ({(file.size / 1024).toFixed(2)} KB)
                      </li>
                    ))}
                  </ul>
                </div>
                
                <button 
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded-lg font-medium"
                  onClick={readyToReceive}
                >
                  准备接收
                </button>
              </div>
            )}
            
            {(transferStatus === 'transferring' || progress > 0) && (
              <div className="space-y-2">
                <h3 className="font-semibold">传输进度</h3>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full" 
                    style={{ width: `${progress * 100}%` }}
                  ></div>
                </div>
                <div className="text-right text-sm">{Math.round(progress * 100)}%</div>
              </div>
            )}
            
            <button 
              className="w-full bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg font-medium"
              onClick={closeSession}
            >
              关闭会话
            </button>
          </div>
        )}
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