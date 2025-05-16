import { NextResponse } from 'next/server';
import { getSessionByCode, updateSession } from '../../../../lib/redis';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, deviceInfo } = body;

    if (!code || code.length !== 6 || !deviceInfo || !deviceInfo.id) {
      return NextResponse.json(
        { error: '无效的请求参数' },
        { status: 400 }
      );
    }

    const session = await getSessionByCode(code);
    
    if (!session) {
      return NextResponse.json(
        { error: '会话不存在或已过期', code: 1001 },
        { status: 404 }
      );
    }

    // 更新会话状态
    const updates = {
      receiver: deviceInfo,
      status: 'joined',
      updatedAt: Date.now()
    };
    
    await updateSession(session.id, updates);

    return NextResponse.json({
      sessionId: session.id,
      status: 'joined',
      peerInfo: {
        id: session.creator.id,
        name: session.creator.name,
        platform: session.creator.platform
      }
    });
  } catch (error) {
    console.error('加入会话失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 