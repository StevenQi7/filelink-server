import { WebSocketServer } from "ws";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CPKT_LOGOUT = -1
const CPKT_LOGIN = 0
const CPKT_OFFER = 1
const CPKT_ANSWER = 2
const CPKT_CANDIDATE = 3
const CPKT_RELAY = 4
const CPKT_SWITCH_TO_FALLBACK = 5
const CPKT_SWITCH_TO_FALLBACK_ACK = 6
const CPKT_P2P_FAILED = 7

const SPKT_OFFER = 11
const SPKT_ANSWER = 12
const SPKT_CANDIDATE = 13
const SPKT_RELAY = 14
const SPKT_SWITCH_TO_FALLBACK = 15
const SPKT_SWITCH_TO_FALLBACK_ACK = 16
const SPKT_P2P_FAILED = 17
const SPKT_RELAY_BUDGET = 99

const DEFAULT_PACKET_BUDGET = 256

const textEnc = new TextEncoder()
const textDec = new TextDecoder()

const encodeString = (str) => {
    return textEnc.encode(str)
}

const decodeString = (arr) => {
    return textDec.decode(arr)
}

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

const wss = new WebSocketServer({
    host: "0.0.0.0",
    port: 8001,
}, () => {
    console.log("WebSocket server is listening on ws://0.0.0.0:8001");
});

const sessions = new Map();
const relayBuffers = new Map(); // 存储中继数据
const RELAY_CHUNK_SIZE = 16384; // 16KB 的块大小

// 添加中继相关的消息类型
const SPKT_RELAY_READY = 20;    // 中继就绪
const SPKT_RELAY_DATA = 21;     // 中继数据
const SPKT_RELAY_COMPLETE = 22; // 中继完成
const SPKT_RELAY_ERROR = 23;    // 中继错误

// 添加中继相关的客户端消息类型
const CPKT_RELAY_REQUEST = 30;  // 请求中继
const CPKT_RELAY_ACCEPT = 31;   // 接受中继
const CPKT_RELAY_REJECT = 32;   // 拒绝中继

const generateSessionId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const deleteSession = sessionId => {
    console.log("Deleting session:", sessionId);
    sessions.delete(sessionId);
}

wss.on("connection", conn => {
    console.log("New connection established");

    conn.on("message", (data, isBinary) => {
        try {
            if (!isBinary) {
                handleTextMessage(conn, data);
            } else {
                handleBinaryData(conn, data);
            }
        } catch (err) {
            console.error(err);
            conn.close();
        }
    });

    conn.on("close", () => {
        console.log("Connection closed");
        if (conn._session?.ids) {
            for (let id of conn._session.ids) {
                deleteSession(id);
            }
        } else {
            console.log("Connection closed, but no session ids were found to delete");
        }
    });
});

wss.on("error", e => {
    console.error(e);
});

const closeConnWithReason = (conn, reason) => {
    console.log("Closing conn: " + reason)
    conn.close()
}

const constructPacketBudgetPacket = (targetId, sessionId, packetBudget) => {
    const packet = new Uint8Array(1 + 36 + 36 + 4)
    const packetDataView = new DataView(packet.buffer)
    packetDataView.setInt8(0, SPKT_RELAY_BUDGET)

    packet.set(encodeString(targetId), 1)
    packet.set(encodeString(sessionId), 1 + 36)
    packetDataView.setInt32(1 + 36 + 36, packetBudget)
    return packet
}

function handleBinaryData(conn, _data) {
    const packet = new Uint8Array(_data)
    const packetDataView = new DataView(packet.buffer)
    const packetId = packetDataView.getInt8(0)

    if (packetId == CPKT_RELAY) {
        const targetId = decodeString(packet.subarray(1, 1 + 36))
        const callerId = decodeString(packet.subarray(1 + 36, 1 + 36 + 36))

        if (!conn._relay_packets) {
            conn._relay_packets = 1
        }
        else {
            conn._relay_packets += 1
        }

        let recipientConn;
        if ((recipientConn = sessions.get(targetId))) {
            // if(recipientConn.bufferedAmount > 100_000_000) {    // 100MB
            //     console.log("High bufferedAmount:", recipientConn.bufferedAmount)
            // }
            if (conn._relay_packets % (DEFAULT_PACKET_BUDGET / 4) == 0) {
                const sendPacketBudget = () => {
                    console.log("Finally sending packet budget:", DEFAULT_PACKET_BUDGET)
                    conn.send(constructPacketBudgetPacket(callerId, targetId, DEFAULT_PACKET_BUDGET))
                }

                const waitingFunction = async () => {
                    if (recipientConn.bufferedAmount > 500_000_000) {
                        console.log("recipientConn bufferedAmount > 500_000_000:", recipientConn.bufferedAmount, " - Terminating connection!")
                        closeConnWithReason(recipientConn, "The sender is ignoring packet budget, they are sending packets too fast!")
                        closeConnWithReason(conn, "Ignoring packet budget, you are sending packets too fast!")
                        return
                    }
                    console.log("recipientConn bufferedAmount > 100_000_000:", recipientConn.bufferedAmount, " - Waiting for better conditions before sending packet budget.")
                    while (recipientConn.bufferedAmount > 100_000_000) {
                        await new Promise(resolve => setTimeout(resolve, 500))
                    }
                    sendPacketBudget()
                }

                if (recipientConn.bufferedAmount > 100_000_000) {
                    waitingFunction()
                }
                else {
                    sendPacketBudget()
                }
            }

            packetDataView.setInt8(0, SPKT_RELAY)   // Change to server packet type before sending back
            recipientConn.send(packet)
        }
        else {
            return closeConnWithReason(conn, "[CPKT_RELAY] Specified targetId does not exist", targetId)
        }
    }
    else {
        console.warn("[handleBinaryData] Unknown packetId:", packetId)
    }
}

/**
 * @param {WebSocket} conn
 */
function handleTextMessage(conn, message) {
    if (message == ".") return   // Keepalive

    let data;
    try {
        data = JSON.parse(message);
    } catch (e) {
        console.error("Invalid json: ", message);
        return conn.close();
    }

    if (data.type == CPKT_LOGIN) { // login
        console.log("Login requested with session ", data.id)
        if (!data.id) return closeConnWithReason(conn, "[login] Didn't specify id");
        if (typeof data.id !== "string" || data.id.length != 6) return closeConnWithReason(conn, "[login] Invalid ID " + data.id);
        
        // 如果是接收方加入，检查目标会话是否存在
        if (data.targetId) {
            const targetSession = sessions.get(data.targetId);
            if (!targetSession) {
                return closeConnWithReason(conn, "[login] Target session not found " + data.targetId);
            }
        } else if (sessions.has(data.id)) {
            // 如果是发送方创建会话，检查 ID 是否已被占用
            return closeConnWithReason(conn, "[login] Session ID already taken " + data.id);
        }

        if (conn._session === undefined) {
            conn._session = {}
            console.log("_session doesn't exist yet, adding first session ", data.id)
            conn._session.ids = [data.id]
        } else {
            console.log("_session list exists, adding session ", data.id)
            conn._session.ids.push(data.id)
        }

        sessions.set(data.id, conn);

        // 如果是接收方加入，通知发送方
        if (data.targetId) {
            const targetSession = sessions.get(data.targetId);
            if (targetSession) {
                targetSession.send(JSON.stringify({
                    type: SPKT_OFFER,
                    targetId: data.targetId,
                    callerId: data.id,
                    ready: true,
                    offer: null  // 添加 offer 字段，初始为 null
                }));
            }
        }

        return conn.send(JSON.stringify({ targetId: data.id, success: true, type: data.type }));
    }

    if (!conn._session) return conn.close();

    if (data.type == CPKT_OFFER) { // offer
        console.log("收到 offer 请求:", data);
        if (!data.offer) return closeConnWithReason(conn, "[offer] Didn't specify offer");
        if (!data.callerId) return closeConnWithReason(conn, "[offer] Didn't specify callerId");
        if (!sessions.get(data.callerId)) return closeConnWithReason(conn, "[offer] Specified callerId does not exist");

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            console.log("转发 offer 到接收方:", data.recipientId);
            recipientConn.send(JSON.stringify({
                type: SPKT_OFFER,
                targetId: data.recipientId,
                callerId: data.callerId,
                offer: data.offer
            }));
            return conn.send(JSON.stringify({
                targetId: data.callerId,
                success: true,
                type: data.type
            }));
        } else {
            console.log("[CPKT_OFFER] recipient did not exist:", data.recipientId);
            return conn.send(JSON.stringify({
                targetId: data.callerId,
                success: false,
                type: data.type,
                msg: "Quick Share could not be found. Do not close the browser window before the transfer is complete."
            }));
        }
    } else if (data.type == CPKT_ANSWER) { // answer
        // console.log("answer", conn._session.id + " -> " + data.recipientId, data);
        if (!data.answer) return closeConnWithReason(conn, "[answer] Didn't specify answer");

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            recipientConn.send(JSON.stringify({
                type: SPKT_ANSWER, // answer type
                targetId: data.recipientId,
                answer: data.answer,
                currentUserCanFallback: data.currentUserCanFallback
            }));
            return conn.send(JSON.stringify({
                targetId: data.sessionId, success: true, type: data.type,
            }));
        } else {
            console.log("[CPKT_ANSWER] recipient does not exist:", data.recipientId)
            return conn.send(JSON.stringify({
                targetId: data.sessionId, success: false, type: data.type,
                msg: "recipient does not exist",
            }));
        }
    } else if (data.type == CPKT_CANDIDATE) { // candidate
        // console.log("candidate", conn._session.id + " -> " + data.recipientId, data);
        if (!data.candidate) return closeConnWithReason(conn, "[candidate] Didn't specify candidate");
        if (!data.callerId) return closeConnWithReason(conn, "[candidate] Didn't specify callerId");
        if (!sessions.get(data.callerId)) return closeConnWithReason(conn, "[candidate] Specified callerId does not exist")

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            recipientConn.send(JSON.stringify({
                type: SPKT_CANDIDATE, // answer type
                targetId: data.recipientId,
                candidate: data.candidate,
                callerId: data.callerId
            }));

            // TODO: Track who the connections can start a binary relay session with
            // to prevent anyone from creating infinite sessions

            // conn._session.hasTriedP2PWith = recipientConn
            // recipientConn._session.hasTriedP2PWith = conn

            return conn.send(JSON.stringify({
                targetId: data.callerId, success: true, type: data.type,
            }));
        } else {
            console.log("[CPKT_CANDIDATE] recipient does not exist!")
            return conn.send(JSON.stringify({
                targetId: data.callerId, success: false, type: data.type,
                msg: "recipient does not exist",
            }));
        }
    } else if (data.type == CPKT_LOGOUT) { // logout
        if (!data.sessionId) return closeConnWithReason(conn, "[CPKT_LOGOUT] Didn't specify sessionId")
        if (!conn._session.ids.find(o => o === data.sessionId))
            return closeConnWithReason(conn, "[CPKT_LOGOUT] Tried to logout id not owned by them");

        console.log("[CPKT_LOGOUT]", data.sessionId);
        deleteSession(data.sessionId)
    } else if (data.type == CPKT_SWITCH_TO_FALLBACK) {
        if (!data.callerId) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK] Didn't specify callerId")
        if (!data.recipientId) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK] Didn't specify recipientId")
        if (!sessions.get(data.callerId)) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK] Specified callerId does not exist")

        console.log("[CPKT_SWITCH_TO_FALLBACK] Request from:", data.callerId, "to", data.recipientId)

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            const newRtcSessionId = generateSessionId()

            recipientConn.send(JSON.stringify({
                type: SPKT_SWITCH_TO_FALLBACK,
                targetId: data.recipientId,
                callerId: data.callerId,
                newRtcSessionId
            }));

            return conn.send(JSON.stringify({
                targetId: data.callerId, success: true, type: data.type,
            }));
        } else {
            console.log("[CPKT_SWITCH_TO_FALLBACK] recipient does not exist!")
            return conn.send(JSON.stringify({
                targetId: data.callerId, success: false, type: data.type,
                msg: "recipient does not exist",
            }));
        }
    } else if (data.type == CPKT_SWITCH_TO_FALLBACK_ACK) {
        if (!data.callerId) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK_ACK] Didn't specify callerId")
        if (!data.recipientId) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK_ACK] Didn't specify recipientId")
        if (!sessions.get(data.callerId)) return closeConnWithReason(conn, "[CPKT_SWITCH_TO_FALLBACK_ACK] Specified callerId does not exist")

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            recipientConn.send(JSON.stringify({
                type: SPKT_SWITCH_TO_FALLBACK_ACK,
                targetId: data.recipientId,
                callerId: data.callerId,
                success: data.success
            }));

            return conn.send(JSON.stringify({
                targetId: data.callerId, success: true, type: data.type,
            }));
        } else {
            console.log("[CPKT_SWITCH_TO_FALLBACK_ACK] recipient does not exist!")
            return conn.send(JSON.stringify({
                targetId: data.callerId, success: false, type: data.type,
                msg: "recipient does not exist",
            }));
        }

    } else if (data.type == CPKT_P2P_FAILED) {
        if (!data.callerId) return closeConnWithReason(conn, "[CPKT_P2P_FAILED] Didn't specify callerId")
        if (!data.recipientId) return closeConnWithReason(conn, "[CPKT_P2P_FAILED] Didn't specify recipientId")
        if (!sessions.get(data.callerId)) return closeConnWithReason(conn, "[CPKT_P2P_FAILED] Specified callerId does not exist")

        let recipientConn;
        if ((recipientConn = sessions.get(data.recipientId))) {
            recipientConn.send(JSON.stringify({
                type: SPKT_P2P_FAILED,
                targetId: data.recipientId,
                callerId: data.callerId
            }));

            return conn.send(JSON.stringify({
                targetId: data.callerId, success: true, type: data.type,
            }));
        } else {
            console.log("[CPKT_P2P_FAILED] recipient does not exist!")
            return conn.send(JSON.stringify({
                targetId: data.callerId, success: false, type: data.type,
                msg: "recipient does not exist",
            }));
        }
    } else if (data.type === CPKT_RELAY_REQUEST) {
        handleRelayRequest(conn, data);
        return;
    } else if (data.type === CPKT_RELAY_ACCEPT || data.type === CPKT_RELAY_REJECT) {
        handleRelayResponse(conn, data);
        return;
    } else if (data.type === SPKT_RELAY_DATA) {
        handleRelayData(conn, data);
        return;
    }
}

// 处理中继请求
function handleRelayRequest(conn, data) {
    const { callerId, recipientId, fileInfo } = data;
    const targetSession = sessions.get(recipientId);
    
    if (!targetSession) {
        conn.send(JSON.stringify({
            type: SPKT_RELAY_ERROR,
            msg: '接收方不存在'
        }));
        return;
    }

    // 通知接收方有中继请求
    targetSession.send(JSON.stringify({
        type: SPKT_RELAY_READY,
        callerId,
        fileInfo
    }));

    // 创建中继缓冲区
    relayBuffers.set(callerId, {
        recipientId,
        buffer: [],
        fileInfo,
        totalSize: 0
    });
}

// 处理中继响应
function handleRelayResponse(conn, data) {
    const { callerId, recipientId, accept } = data;
    const senderSession = sessions.get(callerId);
    
    if (!senderSession) {
        conn.send(JSON.stringify({
            type: SPKT_RELAY_ERROR,
            msg: '发送方不存在'
        }));
        return;
    }

    if (accept) {
        // 通知发送方可以开始传输
        senderSession.send(JSON.stringify({
            type: SPKT_RELAY_READY,
            recipientId
        }));
    } else {
        // 通知发送方被拒绝
        senderSession.send(JSON.stringify({
            type: SPKT_RELAY_ERROR,
            msg: '接收方拒绝接收文件'
        }));
        // 清理中继缓冲区
        relayBuffers.delete(callerId);
    }
}

// 处理中继数据
function handleRelayData(conn, data) {
    const { callerId, recipientId, chunk, isLast } = data;
    const targetSession = sessions.get(recipientId);
    
    if (!targetSession) {
        conn.send(JSON.stringify({
            type: SPKT_RELAY_ERROR,
            msg: '接收方不存在'
        }));
        return;
    }

    // 转发数据块
    targetSession.send(JSON.stringify({
        type: SPKT_RELAY_DATA,
        callerId,
        chunk,
        isLast
    }));

    if (isLast) {
        // 通知接收方传输完成
        targetSession.send(JSON.stringify({
            type: SPKT_RELAY_COMPLETE,
            callerId
        }));
        // 清理中继缓冲区
        relayBuffers.delete(callerId);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`HTTP server is listening on http://localhost:${PORT}`);
});
