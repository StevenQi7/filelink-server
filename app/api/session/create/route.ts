import { NextResponse } from 'next/server';
import { createSession } from '../../../../lib/redis';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, deviceInfo, expiresIn = 1800 } = body;

    if (!code || code.length !== 6 || !deviceInfo || !deviceInfo.id) {
      return NextResponse.json(
        { error: '无效的请求参数' },
        { status: 400 }
      );
    }

    const sessionId = await createSession(code, deviceInfo);

    return NextResponse.json({
      sessionId,
      status: 'created',
      expiresAt: Date.now() + expiresIn * 1000
    });
  } catch (error) {
    console.error('创建会话失败:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
} 