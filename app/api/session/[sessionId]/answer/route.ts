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
    const { deviceId, sdp } = body;

    if (!sessionId || !deviceId || !sdp) {
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

    // 发送 SDP 应答给对方
    emitToSession(sessionId, 'sdp', {
      type: 'sdp',
      subtype: 'answer',
      sdp,
      from: deviceId
    });

    return NextResponse.json({
      status: 'delivered'
    });
  } catch (error) {
    console.error('发送 SDP 应答失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 