// 协议常量
const CPKT_LOGOUT = -1;
const CPKT_LOGIN = 0;
const CPKT_OFFER = 1;
const CPKT_ANSWER = 2;
const CPKT_CANDIDATE = 3;
const CPKT_RELAY = 4;
const CPKT_SWITCH_TO_FALLBACK = 5;
const CPKT_SWITCH_TO_FALLBACK_ACK = 6;
const CPKT_P2P_FAILED = 7;

const SPKT_OFFER = 11;
const SPKT_ANSWER = 12;
const SPKT_CANDIDATE = 13;
const SPKT_RELAY = 14;
const SPKT_SWITCH_TO_FALLBACK = 15;
const SPKT_SWITCH_TO_FALLBACK_ACK = 16;
const SPKT_P2P_FAILED = 17;
const SPKT_RELAY_BUDGET = 99;
const SPKT_RELAY_READY = 20;    // 中继就绪
const SPKT_RELAY_DATA = 21;     // 中继数据
const SPKT_RELAY_COMPLETE = 22; // 中继完成
const SPKT_RELAY_ERROR = 23;    // 中继错误

const CPKT_RELAY_REQUEST = 30;  // 请求中继
const CPKT_RELAY_ACCEPT = 31;   // 接受中继
const CPKT_RELAY_REJECT = 32;   // 拒绝中继

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function genSessionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

function genKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
}

let ws;
let localId = '';
let remoteId = '';
let isSender = false;
let encryptionKey = '';
let useEncrypt = false;
let pc = null;
let dc = null;
let files = [];
let relayMode = false;
let fileRecvBuffer = [];
let fileRecvMeta = null;
let fileRecvSize = 0;
let isRelayMode = false;
let relayFileInfo = null;
let relayBuffer = [];
let relayTotalSize = 0;
let currentFileIndex = 0;  // 添加当前文件索引

// UI 元素
const fileInput = document.getElementById('fileInput');
const createSessionBtn = document.getElementById('createSession');
const sessionInfo = document.getElementById('sessionInfo');
const sessionIdSpan = document.getElementById('sessionId');
const encryptionKeySpan = document.getElementById('encryptionKey');
const senderStatus = document.getElementById('senderStatus');
const senderFileList = document.getElementById('senderFileList');
const joinSessionId = document.getElementById('joinSessionId');
const joinEncryptionKey = document.getElementById('joinEncryptionKey');
const joinSessionBtn = document.getElementById('joinSession');
const receiverStatus = document.getElementById('receiverStatus');
const receiverFileList = document.getElementById('receiverFileList');

createSessionBtn.onclick = () => {
    isSender = true;
    localId = genSessionId();
    sessionIdSpan.textContent = localId;
    
    // 询问是否启用加密
    useEncrypt = confirm('是否启用文件加密？');
    if (useEncrypt) {
        encryptionKey = genKey();
        encryptionKeySpan.textContent = encryptionKey;
    } else {
        encryptionKey = '';
        encryptionKeySpan.textContent = '未启用加密';
    }
    
    sessionInfo.style.display = 'block';
    connectWS();
};

joinSessionBtn.onclick = () => {
    isSender = false;
    localId = genSessionId();
    remoteId = joinSessionId.value.trim();
    
    // 如果输入了密钥，则启用加密
    const key = joinEncryptionKey.value.trim();
    if (key) {
        encryptionKey = key;
        useEncrypt = true;
    } else {
        encryptionKey = '';
        useEncrypt = false;
    }
    
    connectWS();
};

fileInput.onchange = () => {
    files = Array.from(fileInput.files);
    senderFileList.innerHTML = '';
    files.forEach(f => {
        addFileToList(f, senderFileList, false);
    });
    updateStatus(`已选择 ${files.length} 个文件`, 'success');
};

function connectWS() {
    // 使用相对路径，适应任何部署环境
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
        ws.send(JSON.stringify({ 
            type: CPKT_LOGIN, 
            id: localId,
            targetId: isSender ? undefined : remoteId
        }));
        
        if (isSender) {
            updateStatus('等待接收方加入...', 'success');
        } else {
            updateStatus('等待发送方建立连接...', 'success');
        }
    };
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        console.log('收到消息:', data);
        
        if (data.type === SPKT_RELAY_READY) {
            console.log('接收方已就绪，开始发送文件');
            if (isSender && isRelayMode) {
                sendFileList();
            } else {
                handleRelayRequest(data);
            }
        } else if (data.type === SPKT_RELAY_DATA) {
            handleRelayData(data);
        } else if (data.type === SPKT_RELAY_ERROR) {
            updateStatus(data.msg, 'error');
        } else if (data.type === SPKT_OFFER) {
            if (data.ready) {
                console.log('接收方已就绪，开始创建 offer');
                startWebRTC(data.callerId);
            } else {
                handleOffer(data);
            }
        } else if (data.type === SPKT_ANSWER) {
            handleAnswer(data);
        } else if (data.type === SPKT_CANDIDATE) {
            handleCandidate(data);
        } else if (data.type === SPKT_SWITCH_TO_FALLBACK) {
            switchToRelay(data);
        } else if (data.type === SPKT_P2P_FAILED) {
            updateStatus('P2P 失败，已切换中继', 'error');
        } else if (data.type === CPKT_LOGIN && data.success) {
            if (isSender) {
                updateStatus('等待接收方加入...', 'success');
            } else {
                updateStatus('等待发送方建立连接...', 'success');
            }
        }
    };
    ws.onclose = () => {
        updateStatus('WebSocket 连接已关闭', 'error');
    };
    ws.onerror = () => {
        updateStatus('WebSocket 连接错误', 'error');
    };
}

function handleSignal(data) {
    switch (data.type) {
        case SPKT_OFFER:
            handleOffer(data);
            break;
        case SPKT_ANSWER:
            handleAnswer(data);
            break;
        case SPKT_CANDIDATE:
            handleCandidate(data);
            break;
        case SPKT_SWITCH_TO_FALLBACK:
            switchToRelay(data);
            break;
        case SPKT_P2P_FAILED:
            updateStatus('P2P 失败，已切换中继', 'error');
            break;
        default:
            break;
    }
}

function startWebRTC(recipientId) {
    console.log('开始 WebRTC 连接');
    pc = new RTCPeerConnection({ 
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10  // 启用候选池
    });
    
    // 保存接收方 ID
    remoteId = recipientId;
    
    // 添加超时检测
    setTimeout(() => {
        if (pc.iceConnectionState !== 'connected') {
            console.log('WebRTC 连接超时，切换到中继模式');
            switchToRelayMode();
        }
    }, 10000);  // 增加超时时间到 10 秒
    
    if (isSender) {
        console.log('发送方创建数据通道');
        dc = pc.createDataChannel('file');
        setupDataChannel();
        
        pc.createOffer().then(offer => {
            console.log('发送方创建 offer');
            return pc.setLocalDescription(offer);
        }).then(() => {
            console.log('发送方设置本地描述');
            ws.send(JSON.stringify({
                type: CPKT_OFFER,
                offer: pc.localDescription,
                callerId: localId,
                recipientId: recipientId
            }));
        }).catch(err => {
            console.error('创建 offer 失败:', err);
            updateStatus('创建连接失败', 'error');
        });
    } else {
        console.log('接收方等待数据通道');
        pc.ondatachannel = (e) => {
            console.log('接收方收到数据通道');
            dc = e.channel;
            setupDataChannel();
        };
    }
    
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            console.log('发送 ICE candidate');
            ws.send(JSON.stringify({
                type: CPKT_CANDIDATE,
                candidate: e.candidate,
                callerId: localId,
                recipientId: isSender ? remoteId : localId
            }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE 连接状态:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected') {
            updateStatus('WebRTC 连接已建立', 'success');
        } else if (pc.iceConnectionState === 'failed') {
            console.log('WebRTC 连接失败，切换到中继模式');
            switchToRelayMode();
        }
    };
}

function handleOffer(data) {
    console.log('收到 offer:', data);
    
    // 验证数据
    if (!data.offer || !data.callerId) {
        console.error('无效的 offer 数据:', data);
        updateStatus('收到无效的连接请求', 'error');
        return;
    }
    
    // 保存发送方 ID
    remoteId = data.callerId;
    console.log('设置发送方 ID:', remoteId);  // 添加日志
    
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    pc.ondatachannel = (e) => {
        console.log('接收方收到数据通道');
        dc = e.channel;
        setupDataChannel();
    };
    
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            console.log('发送 ICE candidate');
            ws.send(JSON.stringify({
                type: CPKT_CANDIDATE,
                candidate: e.candidate,
                callerId: localId,
                recipientId: remoteId
            }));
        }
    };
    
    // 验证 offer 格式
    if (typeof data.offer === 'string') {
        try {
            data.offer = JSON.parse(data.offer);
        } catch (e) {
            console.error('解析 offer 失败:', e);
            updateStatus('解析连接请求失败', 'error');
            return;
        }
    }
    
    if (!data.offer.type || !data.offer.sdp) {
        console.error('无效的 offer 格式:', data.offer);
        updateStatus('无效的连接请求格式', 'error');
        return;
    }
    
    pc.setRemoteDescription(new RTCSessionDescription(data.offer)).then(() => {
        console.log('设置远程描述成功');
        return pc.createAnswer();
    }).then(answer => {
        console.log('创建 answer 成功');
        return pc.setLocalDescription(answer).then(() => answer);
    }).then(answer => {
        console.log('发送 answer');
        ws.send(JSON.stringify({
            type: CPKT_ANSWER,
            answer: answer,
            callerId: localId,
            recipientId: remoteId
        }));
    }).catch(err => {
        console.error('处理 offer 失败:', err);
        updateStatus('建立连接失败', 'error');
    });
}

function handleAnswer(data) {
    pc.setRemoteDescription(new RTCSessionDescription(data.answer));
}

function handleCandidate(data) {
    if (data.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function setupDataChannel() {
    dc.onopen = () => {
        console.log('WebRTC 数据通道已建立');
        updateStatus('WebRTC 通道已建立', 'success');
        if (isSender) {
            sendFileList();
        }
    };
    dc.onclose = () => {
        console.log('WebRTC 数据通道已关闭');
        updateStatus('数据通道已关闭', 'error');
    };
    dc.onerror = (e) => {
        console.error('WebRTC 数据通道错误:', e);
        updateStatus('数据通道错误', 'error');
    };
    dc.onmessage = async (e) => {
        if (!isSender) {
            if (typeof e.data === 'string') {
                // 处理文件元数据
                try {
                    const meta = JSON.parse(e.data);
                    console.log(`收到 WebRTC 文件元数据: ${meta.name} (${formatSize(meta.size)})`);
                    
                    // 检查是否是加密文件但没有密钥
                    if (meta.isEncrypted && !encryptionKey) {
                        console.log('加密文件需要密钥');
                        updateStatus('这是加密文件，请输入密钥', 'error');
                        // 关闭数据通道
                        dc.close();
                        return;
                    }
                    
                    fileRecvMeta = meta;
                    fileRecvBuffer = [];
                    fileRecvSize = 0;
                    addFileToList(meta, receiverFileList, true);
                } catch (err) {
                    console.error('解析 WebRTC 文件元数据失败:', err);
                }
            } else {
                // 处理文件二进制数据
                let data = e.data;
                if (encryptionKey) {
                    try {
                        data = await decryptData(new Uint8Array(data), encryptionKey);
                    } catch (err) {
                        console.error('解密数据失败:', err);
                        updateStatus('解密数据失败', 'error');
                        return;
                    }
                }
                
                fileRecvBuffer.push(data);
                fileRecvSize += data.byteLength;
                if (fileRecvMeta) {
                    updateFileProgress(fileRecvMeta.name, fileRecvSize / fileRecvMeta.size * 100, receiverFileList);
                    if (fileRecvSize >= fileRecvMeta.size) {
                        console.log(`WebRTC 文件接收完成: ${fileRecvMeta.name}`);
                        // 保存文件
                        const blob = new Blob(fileRecvBuffer, { type: fileRecvMeta.type });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = fileRecvMeta.name;
                        a.click();
                        
                        // 更新状态显示
                        const currentFile = fileRecvMeta.currentFile || 0;
                        const totalFiles = fileRecvMeta.totalFiles || 0;
                        if (currentFile < totalFiles) {
                            updateStatus(`等待接收下一个文件 (${currentFile + 1}/${totalFiles})`, 'info');
                        } else {
                            updateStatus('所有文件接收完成', 'success');
                        }
                        
                        fileRecvBuffer = [];
                        fileRecvSize = 0;
                        fileRecvMeta = null;
                    }
                }
            }
        }
    };
}

function sendFileList() {
    if (isRelayMode) {
        console.log('使用服务器中继模式发送文件');
        // 中继模式发送
        currentFileIndex = 0;
        sendNextFileRelay();
    } else {
        console.log('使用 WebRTC 模式发送文件');
        // WebRTC 模式发送
        currentFileIndex = 0;
        sendNextFile();
    }
}

function sendNextFile() {
    if (currentFileIndex >= files.length) {
        console.log('所有文件发送完成');
        updateStatus('所有文件发送完成', 'success');
        return;
    }
    
    const file = files[currentFileIndex];
    console.log(`开始 WebRTC 传输文件: ${file.name} (${formatSize(file.size)})`);
    dc.send(JSON.stringify({ 
        name: file.name, 
        size: file.size, 
        type: file.type,
        isEncrypted: useEncrypt,
        totalFiles: files.length,
        currentFile: currentFileIndex + 1
    }));
    sendFileChunks(file);
}

function sendNextFileRelay() {
    if (currentFileIndex >= files.length) {
        console.log('所有文件发送完成');
        updateStatus('所有文件发送完成', 'success');
        return;
    }
    
    const file = files[currentFileIndex];
    console.log(`开始中继传输文件: ${file.name} (${formatSize(file.size)})`);
    sendFileChunksRelay(file);
}

function sendFileChunks(file) {
    const chunkSize = 16384;
    let offset = 0;
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        if (dc.readyState !== 'open') {
            console.warn('WebRTC 数据通道未打开');
            return;
        }
        
        let data = e.target.result;
        if (useEncrypt && encryptionKey) {
            try {
                data = await encryptData(data, encryptionKey);
            } catch (err) {
                console.error('加密数据失败:', err);
                updateStatus('加密数据失败', 'error');
                return;
            }
        }
        
        dc.send(data);
        offset += e.target.result.byteLength;
        if (senderFileList) {
            updateFileProgress(file.name, offset / file.size * 100, senderFileList);
        }
        if (offset < file.size) {
            readNext();
        } else {
            console.log(`WebRTC 文件传输完成: ${file.name}`);
            // 更新状态显示
            const currentFile = currentFileIndex + 1;
            const totalFiles = files.length;
            updateStatus(`文件传输进度: ${currentFile}/${totalFiles}`, 'success');
            
            // 发送下一个文件
            currentFileIndex++;
            setTimeout(() => sendNextFile(), 100);  // 短暂延迟后发送下一个文件
        }
    };
    
    function readNext() {
        const chunk = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(chunk);
    }
    readNext();
}

function sendFileChunksRelay(file) {
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;
    
    function readNextChunk() {
        const chunk = file.slice(offset, offset + chunkSize);
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            let data = new Uint8Array(arrayBuffer);
            
            if (useEncrypt && encryptionKey) {
                try {
                    data = await encryptData(data, encryptionKey);
                } catch (err) {
                    console.error('加密数据失败:', err);
                    updateStatus('加密数据失败', 'error');
                    return;
                }
            }
            
            const hexString = Array.from(data)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            
            ws.send(JSON.stringify({
                type: SPKT_RELAY_DATA,
                callerId: localId,
                recipientId: remoteId,
                chunk: hexString,
                isLast: offset + chunkSize >= file.size,
                fileName: file.name,
                currentFile: currentFileIndex + 1,
                totalFiles: files.length
            }));
            
            offset += chunkSize;
            if (offset < file.size) {
                readNextChunk();
            } else {
                console.log(`中继文件传输完成: ${file.name}`);
                // 更新状态显示
                const currentFile = currentFileIndex + 1;
                const totalFiles = files.length;
                updateStatus(`文件传输进度: ${currentFile}/${totalFiles}`, 'success');
                
                // 发送下一个文件
                currentFileIndex++;
                setTimeout(() => sendNextFileRelay(), 100);  // 短暂延迟后发送下一个文件
            }
            
            // 更新进度
            if (senderFileList) {
                updateFileProgress(file.name, Math.min(100, (offset / file.size) * 100), senderFileList);
            }
        };
        
        reader.readAsArrayBuffer(chunk);
    }
    
    readNextChunk();
}

function addFileToList(file, container, isReceiver) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
        <div class="file-info">
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatSize(file.size)}</span>
        </div>
        <div class="progress">
            <div class="progress-bar" style="width:0%"></div>
            <span class="progress-text">0%</span>
        </div>
    `;
    
    if (isReceiver) {
        const btn = document.createElement('button');
        btn.textContent = '接收';
        btn.onclick = () => {
            if (isRelayMode) {
                console.log('中继模式下无需点击接收按钮');
                return;
            }
            if (!dc) {
                console.error('数据通道未建立');
                updateStatus('数据通道未建立', 'error');
                return;
            }
            receiveFile(file);
        };
        div.appendChild(btn);
    }
    container.appendChild(div);
}

function updateFileProgress(fileName, percent, container) {
    if (!container) {
        console.warn('容器不存在:', container);
        return;
    }
    const items = container.querySelectorAll('.file-item');
    let found = false;
    items.forEach(item => {
        if (item.querySelector('.file-name').textContent === fileName) {
            const bar = item.querySelector('.progress-bar');
            const text = item.querySelector('.progress-text');
            if (bar && text) {
                bar.style.width = percent + '%';
                text.textContent = Math.round(percent) + '%';
                found = true;
            }
        }
    });
    if (!found) {
        console.warn('未找到文件项:', fileName);
    }
}

function receiveFile(meta) {
    if (!dc) {
        console.error('数据通道未建立');
        return;
    }
    
    // 这里只是演示，实际应监听 datachannel 的二进制数据
    dc.onmessage = (e) => {
        if (typeof e.data === 'string') return;
        fileRecvBuffer.push(e.data);
        fileRecvSize += e.data.byteLength;
        updateFileProgress(meta.name, fileRecvSize / meta.size * 100, receiverFileList);
        if (fileRecvSize >= meta.size) {
            // 保存文件
            const blob = new Blob(fileRecvBuffer, { type: meta.type });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = meta.name;
            a.click();
            fileRecvBuffer = [];
            fileRecvSize = 0;
        }
    };
}

function switchToRelay(data) {
    relayMode = true;
    updateStatus('P2P 失败，切换服务器中继', 'error');
    // TODO: 实现服务器中继模式下的文件传输
}

// 修改中继数据处理
async function handleRelayData(data) {
    if (!isSender) {
        const { chunk, isLast } = data;
        console.log('收到中继数据块:', chunk ? chunk.length / 2 : 0, '字节');
        
        try {
            // 将十六进制字符串转换回 Uint8Array
            const bytes = new Uint8Array(chunk.length / 2);
            for (let i = 0; i < chunk.length; i += 2) {
                bytes[i / 2] = parseInt(chunk.substr(i, 2), 16);
            }
            
            let data = bytes;
            if (encryptionKey) {
                try {
                    data = await decryptData(bytes, encryptionKey);
                } catch (err) {
                    console.error('解密数据失败:', err);
                    updateStatus('解密数据失败', 'error');
                    return;
                }
            }
            
            relayBuffer.push(data);
            relayTotalSize += data.byteLength;
            
            if (relayFileInfo) {
                updateFileProgress(relayFileInfo[0].name, relayTotalSize / relayFileInfo[0].size * 100, receiverFileList);
                if (isLast) {
                    console.log(`服务器中继文件传输完成: ${relayFileInfo[0].name}`);
                    // 保存文件
                    const blob = new Blob(relayBuffer, { type: relayFileInfo[0].type });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = relayFileInfo[0].name;
                    a.click();
                    relayBuffer = [];
                    relayTotalSize = 0;
                    relayFileInfo = null;
                }
            }
        } catch (error) {
            console.error('处理中继数据块失败:', error);
            updateStatus('文件传输失败', 'error');
        }
    }
}

function updateStatus(msg, type) {
    if (isSender) {
        senderStatus.textContent = msg;
        senderStatus.className = 'status ' + type;
    } else {
        receiverStatus.textContent = msg;
        receiverStatus.className = 'status ' + type;
    }
}

function formatSize(size) {
    if (size < 1024) return size + 'B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + 'KB';
    return (size / 1024 / 1024).toFixed(1) + 'MB';
}

// 切换到中继模式
function switchToRelayMode() {
    if (isRelayMode) {
        console.log('已经在中继模式中');
        return;
    }
    isRelayMode = true;
    console.log('WebRTC 连接失败，切换到服务器中继模式');
    updateStatus('切换到中继模式', 'warning');
    
    if (isSender) {
        console.log('发送中继请求，文件信息:', files);
        console.log('接收方 ID:', remoteId);
        // 发送方请求中继
        ws.send(JSON.stringify({
            type: CPKT_RELAY_REQUEST,
            callerId: localId,
            recipientId: remoteId,
            fileInfo: files.map(file => ({
                name: file.name,
                size: file.size,
                type: file.type
            })),
            isEncrypted: useEncrypt  // 添加加密标志
        }));
    }
}

// 处理中继请求
function handleRelayRequest(data) {
    if (!isSender) {
        const { callerId, fileInfo, isEncrypted } = data;
        console.log(`收到中继请求，来自: ${callerId}`);
        console.log('文件信息:', fileInfo);
        console.log('是否加密:', isEncrypted);
        
        // 如果是加密文件但没有密钥，直接提示
        if (isEncrypted && !encryptionKey) {
            console.log('加密文件需要密钥');
            updateStatus('这是加密文件，请输入密钥', 'error');
            ws.send(JSON.stringify({
                type: CPKT_RELAY_REJECT,
                callerId,
                recipientId: localId,
                accept: false,
                reason: 'need_key'
            }));
            return;
        }
        
        relayFileInfo = fileInfo;
        
        // 显示文件信息
        fileInfo.forEach(info => {
            console.log(`准备接收中继文件: ${info.name} (${formatSize(info.size)})`);
            addFileToList(info, receiverFileList, false);  // 中继模式下不显示接收按钮
        });
        
        // 询问用户是否接受
        if (confirm(`是否接收来自 ${callerId} 的文件？`)) {
            console.log('接受中继请求');
            ws.send(JSON.stringify({
                type: CPKT_RELAY_ACCEPT,
                callerId,
                recipientId: localId,
                accept: true
            }));
            // 通知发送方可以开始发送
            ws.send(JSON.stringify({
                type: SPKT_RELAY_READY,
                recipientId: callerId
            }));
        } else {
            console.log('拒绝中继请求');
            ws.send(JSON.stringify({
                type: CPKT_RELAY_REJECT,
                callerId,
                recipientId: localId,
                accept: false
            }));
        }
    }
}

// 在 HTML 中添加测试按钮
const testRelayBtn = document.createElement('button');
testRelayBtn.textContent = '测试中继模式';
testRelayBtn.onclick = () => {
    console.log('手动切换到中继模式');
    switchToRelayMode();
};
document.body.appendChild(testRelayBtn);

// 添加加密相关的函数
async function encryptData(data, key) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const keyHash = await crypto.subtle.digest('SHA-256', keyData);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv
        },
        cryptoKey,
        data
    );
    
    // 将 IV 和加密数据合并
    const result = new Uint8Array(iv.length + encryptedData.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encryptedData), iv.length);
    return result;
}

async function decryptData(encryptedData, key) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const keyHash = await crypto.subtle.digest('SHA-256', keyData);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
    );
    
    // 分离 IV 和加密数据
    const iv = encryptedData.slice(0, 12);
    const data = encryptedData.slice(12);
    
    return await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv
        },
        cryptoKey,
        data
    );
} 