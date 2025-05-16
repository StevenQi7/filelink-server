import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

export const SESSION_EXPIRE_TIME = 1800; // 30分钟

export async function createSession(code: string, deviceInfo: any): Promise<string> {
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

export async function getSession(sessionId: string): Promise<any | null> {
  const session = await redis.get(`session:${sessionId}`);
  return session ? JSON.parse(session) : null;
}

export async function getSessionByCode(code: string): Promise<any | null> {
  const sessionId = await redis.get(`code:${code}`);
  if (!sessionId) return null;
  return getSession(sessionId);
}

export async function updateSession(sessionId: string, updates: any): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  const updatedSession = { ...session, ...updates };
  await redis.set(`session:${sessionId}`, JSON.stringify(updatedSession), 'EX', SESSION_EXPIRE_TIME);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  await redis.del(`session:${sessionId}`);
  await redis.del(`code:${session.code}`);
}

export default redis; 