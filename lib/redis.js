const Redis = require('ioredis');

// 使用Upstash提供的Redis URL
const redis = new Redis("rediss://default:AYqPAAIjcDE3YjBhNDRjYzI0MTg0NjE3OTdiNzYzYTU0NWRmZDg1M3AxMA@loving-kingfish-35471.upstash.io:6379");

// 连接成功事件
redis.on('connect', () => {
  console.log('成功连接到Upstash Redis服务');
});

// 连接错误事件
redis.on('error', (err) => {
  console.error('Redis连接错误:', err);
});

const SESSION_EXPIRE_TIME = 1800; // 30分钟

async function createSession(code, deviceInfo) {
  const sessionId = Math.random().toString(36).substring(2, 15);
  const session = {
    id: sessionId,
    code,
    creator: deviceInfo,
    status: 'created',
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRE_TIME * 1000,
  };

  await redis.set(`session:${sessionId}`, JSON.stringify(session), 'EX', SESSION_EXPIRE_TIME);
  await redis.set(`code:${code}`, sessionId, 'EX', SESSION_EXPIRE_TIME);

  return sessionId;
}

async function getSession(sessionId) {
  const session = await redis.get(`session:${sessionId}`);
  return session ? JSON.parse(session) : null;
}

async function getSessionByCode(code) {
  const sessionId = await redis.get(`code:${code}`);
  if (!sessionId) return null;
  return getSession(sessionId);
}

async function updateSession(sessionId, updates) {
  const session = await getSession(sessionId);
  if (!session) return;

  const updatedSession = { ...session, ...updates };
  await redis.set(`session:${sessionId}`, JSON.stringify(updatedSession), 'EX', SESSION_EXPIRE_TIME);
}

async function deleteSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return;

  await redis.del(`session:${sessionId}`);
  await redis.del(`code:${session.code}`);
}

// 存储会话成员信息在Redis中
async function storeSessionMember(sessionId, socketId, memberInfo) {
  const key = `session_members:${sessionId}`;
  await redis.hset(key, socketId, JSON.stringify(memberInfo));
  await redis.expire(key, SESSION_EXPIRE_TIME);
}

// 获取会话成员信息
async function getSessionMembers(sessionId) {
  const key = `session_members:${sessionId}`;
  const membersObj = await redis.hgetall(key);
  
  if (!membersObj || Object.keys(membersObj).length === 0) {
    return new Map();
  }
  
  const members = new Map();
  for (const [socketId, memberInfoStr] of Object.entries(membersObj)) {
    members.set(socketId, JSON.parse(memberInfoStr));
  }
  
  return members;
}

// 移除会话成员
async function removeSessionMember(sessionId, socketId) {
  const key = `session_members:${sessionId}`;
  await redis.hdel(key, socketId);
  
  // 检查是否还有成员
  const remainingMembers = await redis.hgetall(key);
  if (!remainingMembers || Object.keys(remainingMembers).length === 0) {
    // 如果没有成员了，删除整个哈希
    await redis.del(key);
    return true; // 返回true表示会话已空
  }
  
  return false; // 返回false表示会话仍有成员
}

module.exports = { 
  redis, 
  SESSION_EXPIRE_TIME, 
  createSession, 
  getSession, 
  getSessionByCode, 
  updateSession, 
  deleteSession,
  storeSessionMember,
  getSessionMembers,
  removeSessionMember
}; 