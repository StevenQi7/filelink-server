const WebSocket = require('ws');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// 数据包类型定义
const PACKET_TYPES = {
    CREATE_SESSION: 0,
    JOIN_SESSION: 1,
    OFFER: 2,
    ANSWER: 3,
    ICE_CANDIDATE: 4,
    FILE_INFO: 5,
    FILE_CHUNK: 6,
    FILE_COMPLETE: 7,
    ERROR: 8
};

class SignalingServer {
    constructor(port = 8001) {
        this.wss = new WebSocket.Server({ port });
        this.sessions = new Map();
        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws) => {
            console.log('新的连接建立');

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(ws, data);
                } catch (error) {
                    console.error('消息处理错误:', error);
                    this.sendError(ws, '消息格式错误');
                }
            });

            ws.on('close', () => {
                this.handleDisconnect(ws);
            });
        });
    }

    generateSessionId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let sessionId = '';
        for (let i = 0; i < 6; i++) {
            sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return sessionId;
    }

    generateEncryptionKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    handleMessage(ws, data) {
        switch (data.type) {
            case PACKET_TYPES.CREATE_SESSION:
                this.handleCreateSession(ws, data);
                break;
            case PACKET_TYPES.JOIN_SESSION:
                this.handleJoinSession(ws, data);
                break;
            case PACKET_TYPES.OFFER:
            case PACKET_TYPES.ANSWER:
            case PACKET_TYPES.ICE_CANDIDATE:
                this.handleWebRTCSignal(ws, data);
                break;
            case PACKET_TYPES.FILE_INFO:
                this.handleFileInfo(ws, data);
                break;
            default:
                this.sendError(ws, '未知的消息类型');
        }
    }

    handleCreateSession(ws, data) {
        const sessionId = this.generateSessionId();
        const encryptionKey = data.encrypt ? this.generateEncryptionKey() : null;

        this.sessions.set(sessionId, {
            id: sessionId,
            sender: ws,
            receiver: null,
            encryptionKey,
            files: [],
            createdAt: Date.now()
        });

        ws.sessionId = sessionId;
        ws.isSender = true;

        ws.send(JSON.stringify({
            type: PACKET_TYPES.CREATE_SESSION,
            sessionId,
            encryptionKey
        }));
    }

    handleJoinSession(ws, data) {
        const session = this.sessions.get(data.sessionId);
        if (!session) {
            return this.sendError(ws, '会话不存在');
        }

        if (session.receiver) {
            return this.sendError(ws, '会话已满');
        }

        if (session.encryptionKey && data.encryptionKey !== session.encryptionKey) {
            return this.sendError(ws, '加密密钥错误');
        }

        session.receiver = ws;
        ws.sessionId = data.sessionId;
        ws.isSender = false;

        // 通知发送方接收者已加入
        session.sender.send(JSON.stringify({
            type: PACKET_TYPES.JOIN_SESSION,
            sessionId: data.sessionId
        }));

        // 发送文件列表给接收者
        ws.send(JSON.stringify({
            type: PACKET_TYPES.FILE_INFO,
            files: session.files
        }));
    }

    handleWebRTCSignal(ws, data) {
        const session = this.sessions.get(ws.sessionId);
        if (!session) {
            return this.sendError(ws, '会话不存在');
        }

        const target = ws.isSender ? session.receiver : session.sender;
        if (!target) {
            return this.sendError(ws, '目标用户未连接');
        }

        target.send(JSON.stringify(data));
    }

    handleFileInfo(ws, data) {
        const session = this.sessions.get(ws.sessionId);
        if (!session || !ws.isSender) {
            return this.sendError(ws, '无效的会话或权限');
        }

        session.files.push(data.file);
        
        if (session.receiver) {
            session.receiver.send(JSON.stringify({
                type: PACKET_TYPES.FILE_INFO,
                files: session.files
            }));
        }
    }

    handleDisconnect(ws) {
        if (ws.sessionId) {
            const session = this.sessions.get(ws.sessionId);
            if (session) {
                if (ws.isSender) {
                    if (session.receiver) {
                        session.receiver.send(JSON.stringify({
                            type: PACKET_TYPES.ERROR,
                            message: '发送方已断开连接'
                        }));
                    }
                } else {
                    session.sender.send(JSON.stringify({
                        type: PACKET_TYPES.ERROR,
                        message: '接收方已断开连接'
                    }));
                }
                this.sessions.delete(ws.sessionId);
            }
        }
    }

    sendError(ws, message) {
        ws.send(JSON.stringify({
            type: PACKET_TYPES.ERROR,
            message
        }));
    }
}

module.exports = SignalingServer; 