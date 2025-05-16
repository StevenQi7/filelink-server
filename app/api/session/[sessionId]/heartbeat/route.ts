import { NextResponse } from 'next/server';
import { getSession, updateSession, SESSION_EXPIRE_TIME } from '../../../../../lib/redis';
import type { NextRequest } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { deviceId } = body;

    if (!sessionId || !deviceId) {
      return NextResponse.json(
        { error: '无效的请求参数' },
        { status: 400 }
      );
    }

    const session = await getSession(sessionId);
    
    if (!session) {
      return NextResponse.json(
        { error: '会话不存在或已过期', code: 1001 },
        { status: 404 }
      );
    }

    const isValidDevice = session.creator.id === deviceId || 
                          (session.receiver && session.receiver.id === deviceId);
    
    if (!isValidDevice) {
      return NextResponse.json(
        { error: '设备ID验证失败', code: 1004 },
        { status: 403 }
      );
    }

    // 更新会话过期时间
    const expiresAt = Date.now() + SESSION_EXPIRE_TIME * 1000;
    await updateSession(sessionId, { 
      lastActiveAt: Date.now(),
      expiresAt
    });

    return NextResponse.json({
      status: 'active',
      expiresAt
    });
  } catch (error) {
    console.error('会话心跳更新失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 