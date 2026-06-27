function login() {
    


    
}



export function loginSellerspriteAndGetCookie() {
    const cookie = String(process.env.SELLERSPRITE_COOKIE || '').trim();
    if (!cookie) {
        throw new Error('未配置 SELLERSPRITE_COOKIE，请在 .env 中设置卖家精灵登录 Cookie');
    }
    return cookie;
}
