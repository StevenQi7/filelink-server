import { NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/redis';
import { emitToSession } from '../../../../../lib/socket';

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const { deviceId, status, progress, error } = body;

    if (!sessionId || !deviceId || !status) {
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

    // 向其他设备广播传输状态更新
    emitToSession(sessionId, 'transfer_update', {
      type: 'transfer_update',
      status,
      progress,
      error,
      from: deviceId,
      timestamp: Date.now()
    });

    return NextResponse.json({
      status: 'updated'
    });
  } catch (error) {
    console.error('传输状态更新失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 