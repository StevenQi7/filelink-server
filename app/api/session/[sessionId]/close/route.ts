import { NextResponse } from 'next/server';
import { getSession, deleteSession } from '../../../../../lib/redis';
import { emitToSession } from '../../../../../lib/socket';
import type { NextRequest } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { deviceId, reason = '用户主动关闭' } = body;

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

    // 向会话中的所有成员广播会话关闭消息
    emitToSession(sessionId, 'session_update', {
      type: 'session_update',
      status: 'closed',
      reason,
      timestamp: Date.now()
    });

    // 删除会话
    await deleteSession(sessionId);

    return NextResponse.json({
      status: 'closed'
    });
  } catch (error) {
    console.error('关闭会话失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 