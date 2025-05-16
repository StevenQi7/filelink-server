import { NextResponse } from 'next/server';

export function middleware(request) {
  return NextResponse.next();
}

// 添加路由匹配
export const config = {
  matcher: [
    '/api/:path*',
  ],
}; 