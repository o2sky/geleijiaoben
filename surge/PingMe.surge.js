/**
 * @name PingMe 抓包入库 + 自动签到/视频奖励（Surge版）
 * @author 怎么肥事（原作者）；整理适配：Claude
 * @date 2026-08-19
 *
 * ⚠️ 说明：
 * 本脚本只保留 PingMe 相关功能（其余App的Cookie抓取已移除，只留 PingMe）：
 *   - http-request 命中 queryBalanceAndBonus → 抓包入库（写入 pingme_accounts_v1）
 *   - cron 定时触发                          → 自动签到 + 领视频奖励
 *
 * ============================ Surge 配置 ============================
 *
 * [Script]
 * PingMe抓包 = type=http-request,pattern=^https:\/\/api\.pingmeapp\.net\/app\/queryBalanceAndBonus,script-path=https://raw.githubusercontent.com/o2sky/geleijiaoben/refs/heads/main/surge/PingMe.surge.js,requires-body=false,timeout=60,tag=PingMe抓包
 * PingMe签到 = type=cron,cronexp="30 8,20 * * *",script-path=https://raw.githubusercontent.com/o2sky/geleijiaoben/refs/heads/main/surge/PingMe.surge.js,timeout=300,tag=PingMe签到
 *
 * [MITM]
 * hostname = %APPEND% api.pingmeapp.net
 *
 * ======================================================================
 *
 * 使用说明：
 * 1. script-path 换成你自己托管此文件后的 raw 地址（两条规则都指向同一个文件，
 *    脚本内部会根据有没有 $request 自动判断走"抓包"还是"签到"）。
 * 2. 先打开 PingMe App 触发一次请求完成"抓包入库"，再手动运行一次 PingMe签到 脚本验证签到逻辑。
 * 3. PingMe 账号数据存储在 $persistentStore 的 key：pingme_accounts_v1（数组结构，
 *    带指纹去重、别名、UA随机化种子），可在 Surge 的"持久化存储"里查看/清空。
 * 4. 【重要】签到流程里每个账号要领 MAX_VIDEO(默认5) 次视频奖励，每次间隔 VIDEO_DELAY
 *    (默认8秒)，单账号光是这部分就要 30+ 秒，多账号顺序执行会更久。cron 的 timeout
 *    务必设置得比脚本内部 CRON_TIME_BUDGET_MS（默认280秒）大，比如 timeout=300，
 *    否则会被 Surge 强制杀掉、拿不到任何签到结果通知（[Script Timeout]）。
 *    如果账号多、时间还是不够，可以调小 MAX_VIDEO 或把多个账号拆到多个 cron 时间点跑。
 */

////////////////////////////////////////////////////////////////////////////
// ============================ 公共工具函数 ============================
////////////////////////////////////////////////////////////////////////////

function normalizeHeaderNameMap(headers) {
    const out = {};
    Object.keys(headers || {}).forEach(k => out[k] = headers[k]);
    return out;
}

function parseRawQuery(url) {
    const query = (url.split('?')[1] || '').split('#')[0];
    const rawMap = {};
    query.split('&').forEach(pair => {
        if (!pair) return;
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        rawMap[k] = v;
    });
    return rawMap;
}

////////////////////////////////////////////////////////////////////////////
// ==================== PingMe：MD5（签名用） ====================
// （来自 PingMeSignin.multi.surge.js，未做修改）
////////////////////////////////////////////////////////////////////////////

function MD5(string) {
    function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function AddUnsigned(lX, lY) {
        const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
        const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
        if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        return lResult ^ lX8 ^ lY8;
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return x ^ y ^ z; }
    function I(x, y, z) { return y ^ (x | (~z)); }
    function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function ConvertToWordArray(str) {
        const lMessageLength = str.length;
        const lNumberOfWords_temp1 = lMessageLength + 8;
        const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
        const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
        const lWordArray = Array(lNumberOfWords - 1).fill(0);
        let lBytePosition = 0, lByteCount = 0;
        while (lByteCount < lMessageLength) {
            const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] |= str.charCodeAt(lByteCount) << lBytePosition;
            lByteCount++;
        }
        const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] |= 0x80 << lBytePosition;
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    }
    function WordToHex(lValue) {
        let WordToHexValue = '';
        for (let lCount = 0; lCount <= 3; lCount++) {
            const lByte = (lValue >>> (lCount * 8)) & 255;
            const WordToHexValue_temp = '0' + lByte.toString(16);
            WordToHexValue += WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
        }
        return WordToHexValue;
    }
    const x = ConvertToWordArray(string);
    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
    const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
    for (let k = 0; k < x.length; k += 16) {
        const AA = a, BB = b, CC = c, DD = d;
        a = FF(a,b,c,d,x[k+0],S11,0xD76AA478); d = FF(d,a,b,c,x[k+1],S12,0xE8C7B756); c = FF(c,d,a,b,x[k+2],S13,0x242070DB); b = FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);
        a = FF(a,b,c,d,x[k+4],S11,0xF57C0FAF); d = FF(d,a,b,c,x[k+5],S12,0x4787C62A); c = FF(c,d,a,b,x[k+6],S13,0xA8304613); b = FF(b,c,d,a,x[k+7],S14,0xFD469501);
        a = FF(a,b,c,d,x[k+8],S11,0x698098D8); d = FF(d,a,b,c,x[k+9],S12,0x8B44F7AF); c = FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1); b = FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
        a = FF(a,b,c,d,x[k+12],S11,0x6B901122); d = FF(d,a,b,c,x[k+13],S12,0xFD987193); c = FF(c,d,a,b,x[k+14],S13,0xA679438E); b = FF(b,c,d,a,x[k+15],S14,0x49B40821);
        a = GG(a,b,c,d,x[k+1],S21,0xF61E2562); d = GG(d,a,b,c,x[k+6],S22,0xC040B340); c = GG(c,d,a,b,x[k+11],S23,0x265E5A51); b = GG(b,c,d,a,x[k+0],S24,0xE9B6C7AA);
        a = GG(a,b,c,d,x[k+5],S21,0xD62F105D); d = GG(d,a,b,c,x[k+10],S22,0x02441453); c = GG(c,d,a,b,x[k+15],S23,0xD8A1E681); b = GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);
        a = GG(a,b,c,d,x[k+9],S21,0x21E1CDE6); d = GG(d,a,b,c,x[k+14],S22,0xC33707D6); c = GG(c,d,a,b,x[k+3],S23,0xF4D50D87); b = GG(b,c,d,a,x[k+8],S24,0x455A14ED);
        a = GG(a,b,c,d,x[k+13],S21,0xA9E3E905); d = GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8); c = GG(c,d,a,b,x[k+7],S23,0x676F02D9); b = GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
        a = HH(a,b,c,d,x[k+5],S31,0xFFFA3942); d = HH(d,a,b,c,x[k+8],S32,0x8771F681); c = HH(c,d,a,b,x[k+11],S33,0x6D9D6122); b = HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
        a = HH(a,b,c,d,x[k+1],S31,0xA4BEEA44); d = HH(d,a,b,c,x[k+4],S32,0x4BDECFA9); c = HH(c,d,a,b,x[k+7],S33,0xF6BB4B60); b = HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
        a = HH(a,b,c,d,x[k+13],S31,0x289B7EC6); d = HH(d,a,b,c,x[k+0],S32,0xEAA127FA); c = HH(c,d,a,b,x[k+3],S33,0xD4EF3085); b = HH(b,c,d,a,x[k+6],S34,0x04881D05);
        a = HH(a,b,c,d,x[k+9],S31,0xD9D4D039); d = HH(d,a,b,c,x[k+12],S32,0xE6DB99E5); c = HH(c,d,a,b,x[k+15],S33,0x1FA27CF8); b = HH(b,c,d,a,x[k+2],S34,0xC4AC5665);
        a = II(a,b,c,d,x[k+0],S41,0xF4292244); d = II(d,a,b,c,x[k+7],S42,0x432AFF97); c = II(c,d,a,b,x[k+14],S43,0xAB9423A7); b = II(b,c,d,a,x[k+5],S44,0xFC93A039);
        a = II(a,b,c,d,x[k+12],S41,0x655B59C3); d = II(d,a,b,c,x[k+3],S42,0x8F0CCC92); c = II(c,d,a,b,x[k+10],S43,0xFFEFF47D); b = II(b,c,d,a,x[k+1],S44,0x85845DD1);
        a = II(a,b,c,d,x[k+8],S41,0x6FA87E4F); d = II(d,a,b,c,x[k+15],S42,0xFE2CE6E0); c = II(c,d,a,b,x[k+6],S43,0xA3014314); b = II(b,c,d,a,x[k+13],S44,0x4E0811A1);
        a = II(a,b,c,d,x[k+4],S41,0xF7537E82); d = II(d,a,b,c,x[k+11],S42,0xBD3AF235); c = II(c,d,a,b,x[k+2],S43,0x2AD7D2BB); b = II(b,c,d,a,x[k+9],S44,0xEB86D391);
        a = AddUnsigned(a,AA); b = AddUnsigned(b,BB); c = AddUnsigned(c,CC); d = AddUnsigned(d,DD);
    }
    return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
}

////////////////////////////////////////////////////////////////////////////
// ==================== PingMe：配置 + 业务逻辑（来自 PingMeSignin） ====================
////////////////////////////////////////////////////////////////////////////

const PINGME_HOST = 'api.pingmeapp.net';
const scriptName = 'PingMe';
const storeKey = 'pingme_accounts_v1';
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const MAX_VIDEO = 5;
const VIDEO_DELAY = 8000;
const ACCOUNT_GAP = 3500;
// cron 的 [Script] 配置里 timeout 建议设置成 300 或更高（视频奖励环节本身就需要
// MAX_VIDEO * VIDEO_DELAY 秒左右）。这里再加一层内部时间预算保护：一旦跑的时间
// 接近这个预算，就提前收尾发通知，而不是被外层 timeout 直接杀掉、什么反馈都没有。
// 建议 CRON_TIME_BUDGET_MS 比 [Script] 里配置的 timeout（单位秒）小 15~20 秒。
const CRON_TIME_BUDGET_MS = 280000;
const IOS_VERSIONS = ['17.5.1','17.6.1','17.4.1','17.2.1','16.7.8','17.6','17.3.1','18.0.1','17.1.2','16.6.1'];
const IOS_SCALES = ['2.00','3.00','3.00','2.00','3.00'];
const IPHONE_MODELS = ['iPhone14,3','iPhone13,3','iPhone15,3','iPhone16,1','iPhone14,7','iPhone13,2','iPhone15,2','iPhone12,1'];
const CFN_VERS = ['1410.0.3','1494.0.7','1568.100.1','1209.1','1474.0.4','1568.200.2'];
const DARWIN_VERS = ['22.6.0','23.5.0','23.6.0','24.0.0','22.4.0'];

function getUTCSignDate() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function fingerprintOf(paramsRaw) {
    const drop = { sign:1, signDate:1, timestamp:1, ts:1, nonce:1, random:1, reqTime:1, reqId:1, requestId:1 };
    const base = Object.keys(paramsRaw || {}).filter(k => !drop[k]).sort().map(k => `${k}=${paramsRaw[k]}`).join('&');
    return MD5(base).slice(0, 12);
}

function loadStore() {
    const raw = $persistentStore.read(storeKey);
    if (!raw) return { version: 1, accounts: {}, order: [] };
    try {
        const obj = JSON.parse(raw);
        if (!obj.accounts) obj.accounts = {};
        if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.accounts);
        return obj;
    } catch (e) {
        return { version: 1, accounts: {}, order: [] };
    }
}

function saveStore(store) {
    $persistentStore.write(JSON.stringify(store), storeKey);
}

function pickItem(arr, seed) { return arr[seed % arr.length]; }

function buildUA(baseUA, seed) {
    const iosVer = pickItem(IOS_VERSIONS, seed);
    const scale = pickItem(IOS_SCALES, seed + 1);
    const model = pickItem(IPHONE_MODELS, seed + 2);
    const cfn = pickItem(CFN_VERS, seed + 3);
    const darwin = pickItem(DARWIN_VERS, seed + 4);
    if (baseUA && typeof baseUA === 'string') {
        let ua = baseUA;
        let changed = false;
        if (/iOS \d+(\.\d+){0,2}/.test(ua)) { ua = ua.replace(/iOS \d+(\.\d+){0,2}/, `iOS ${iosVer}`); changed = true; }
        if (/Scale\/\d+(\.\d+)?/.test(ua)) { ua = ua.replace(/Scale\/\d+(\.\d+)?/, `Scale/${scale}`); changed = true; }
        if (/iPhone\d+,\d+/.test(ua)) { ua = ua.replace(/iPhone\d+,\d+/, model); changed = true; }
        if (/CFNetwork\/[\d.]+/.test(ua)) { ua = ua.replace(/CFNetwork\/[\d.]+/, `CFNetwork/${cfn}`); changed = true; }
        if (/Darwin\/[\d.]+/.test(ua)) { ua = ua.replace(/Darwin\/[\d.]+/, `Darwin/${darwin}`); changed = true; }
        if (changed) return ua;
    }
    return `PingMe/1.0.0 (${model}; iOS ${iosVer}; Scale/${scale}) CFNetwork/${cfn} Darwin/${darwin}`;
}

function buildSignedParamsRaw(capture, overrideDeviceId) {
    const params = {};
    Object.keys(capture.paramsRaw || {}).forEach(k => {
        if (k !== 'sign' && k !== 'signDate') params[k] = capture.paramsRaw[k];
    });
    if (overrideDeviceId && params.uniquedeviceid) {
        params.uniquedeviceid = overrideDeviceId;
    }
    params.signDate = getUTCSignDate();
    const signBase = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    params.sign = MD5(signBase + SECRET);
    return params;
}

function buildUrl(path, capture, overrideDeviceId) {
    const params = buildSignedParamsRaw(capture, overrideDeviceId);
    const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
    return `https://${PINGME_HOST}/app/${path}?${qs}`;
}

function randHex(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.toUpperCase();
}

function genFakeDeviceId() {
    return `${randHex(8)}-${randHex(4)}-${randHex(4)}-${randHex(4)}-${randHex(12)}PingMeIOS`;
}

function cloneHeaders(headers) {
    const out = {};
    Object.keys(headers || {}).forEach(k => out[k] = headers[k]);
    return out;
}

function buildHeaders(capture, ua) {
    const headers = cloneHeaders(capture.headers || {});
    delete headers['Content-Length']; delete headers['content-length'];
    delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme'];
    headers['Host'] = PINGME_HOST;
    headers['Accept'] = headers['Accept'] || 'application/json';
    Object.keys(headers).forEach(k => {
        const lk = k.toLowerCase();
        if (lk === 'user-agent' || lk === 'connection' || lk === 'proxy-connection' || lk === 'keep-alive') delete headers[k];
    });
    headers['User-Agent'] = ua;
    headers['Connection'] = 'close';
    return headers;
}

function getEmail(acc) {
    if (acc && acc.email) return acc.email;
    const raw = acc && acc.capture && acc.capture.paramsRaw ? (acc.capture.paramsRaw.email || '') : '';
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

function pingmeNotify(title, body) {
    console.log(`【${scriptName} 通知】${title}\n${body}`);
    $notification.post(scriptName, title, body);
}

function isDeregistered(msg) {
    return typeof msg === 'string' && msg.indexOf('已被注销') !== -1;
}

// 判断账号是不是"真实抓到的"账号，而不是测试触发写进去的空壳数据
function isValidAccount(acc) {
    const p = acc && acc.capture && acc.capture.paramsRaw;
    return !!(p && (p.sign || p.uniquedeviceid));
}

function removeAccounts(store, ids) {
    const removed = [];
    ids.forEach(id => {
        if (store.accounts[id]) {
            const em = getEmail(store.accounts[id]);
            removed.push((store.accounts[id].alias || id) + (em ? `(${em})` : ''));
            delete store.accounts[id];
        }
        const pos = store.order.indexOf(id);
        if (pos !== -1) store.order.splice(pos, 1);
    });
    return removed;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpFetch(opts) {
    return new Promise((resolve, reject) => {
        // Surge $httpClient 的 timeout 单位是"秒"，不是毫秒！之前误用15000（=15000秒≈4小时），
        // 相当于没设超时保护。这里改成 15（秒），单次请求卡住会在15秒内报错走重试逻辑，
        // 而不是一直空等到脚本被外层强杀。
        $httpClient.get({ timeout: 15, ...opts }, (error, response, body) => {
            if (error) { reject({ error: String(error) }); return; }
            resolve({ status: response && response.status, headers: response && response.headers, body });
        });
    });
}

function runAccount(acc, index, total, deadlineAt) {
    const email = getEmail(acc);
    const tag = `[账号${index+1}/${total} ${acc.alias || acc.id}]`;
    const ua = buildUA(acc.baseUA, acc.uaSeed);
    const headers = buildHeaders(acc.capture, ua);
    const fakeDeviceId = genFakeDeviceId();
    const msgs = [`${tag}${email ? `\n📧 ${email}` : ''}`];
    const flag = { deregistered: false };

    function fetchApi(path, useFakeId) {
        const overrideId = useFakeId ? fakeDeviceId : null;
        const attempt = (n) => httpFetch({ url: buildUrl(path, acc.capture, overrideId), method: 'GET', headers })
            .catch(err => {
                const m = err && (err.error || String(err));
                if (n < 3 && /SSL|SSLSessionState|timeout|timed out|reset|connection|network|stream closed|closed|EOF/i.test(m || '')) {
                    return sleep(1500).then(() => attempt(n + 1));
                }
                throw err;
            });
        return attempt(1);
    }

    function doVideoLoop(count) {
        let i = 0;
        function next() {
            if (i >= count) return Promise.resolve();
            if (Date.now() >= deadlineAt) {
                msgs.push(`⏭ 时间预算不足，跳过剩余 ${count - i} 个视频奖励`);
                return Promise.resolve();
            }
            return new Promise(resolve => {
                setTimeout(() => {
                    i++;
                    fetchApi('videoBonus', true).then(res => {
                        try {
                            const d = JSON.parse(res.body);
                            if (d.retcode === 0) {
                                msgs.push(`🎬 视频${i}：+${d.result?.bonus || '?'} Coins`);
                                resolve(next());
                            } else {
                                msgs.push(`⏸ 视频${i}：${d.retmsg}`);
                                resolve();
                            }
                        } catch (e) {
                            msgs.push(`❌ 视频${i}：解析失败`);
                            resolve();
                        }
                    }).catch(err => {
                        msgs.push(`❌ 视频${i}：${err.error || '请求失败'}`);
                        resolve();
                    });
                }, i === 0 ? 1500 : VIDEO_DELAY);
            });
        }
        return next();
    }

    return fetchApi('queryBalanceAndBonus').then(res => {
        console.log(`${tag} 查询余额响应：${res && res.body}`);
        try {
            const d = JSON.parse(res.body);
            if (d.retcode === 0) msgs.push(`💰 余额：${d.result.balance} Coins`);
            else {
                msgs.push(`⚠️ 查询：${d.retmsg}`);
                if (isDeregistered(d.retmsg)) flag.deregistered = true;
            }
        } catch (e) { msgs.push('❌ 查询：解析失败'); }
        if (flag.deregistered) return null;
        return fetchApi('checkIn');
    }).then(res => {
        if (flag.deregistered || !res) return null;
        try {
            const d = JSON.parse(res.body);
            if (d.retcode === 0) msgs.push(`✅ 签到：${(d.result?.bonusHint || d.retmsg || '').replace(/\n/g, ' ')}`);
            else {
                msgs.push(`⚠️ 签到：${d.retmsg}`);
                if (isDeregistered(d.retmsg)) flag.deregistered = true;
            }
        } catch (e) { msgs.push('❌ 签到：解析失败'); }
        if (flag.deregistered) return null;
        return doVideoLoop(MAX_VIDEO);
    }).then(() => {
        if (flag.deregistered) {
            msgs.push('🗑 该账号已注销，将从存储中移除');
            return null;
        }
        return fetchApi('queryBalanceAndBonus');
    }).then(res => {
        if (res) {
            try {
                const d = JSON.parse(res.body);
                if (d.retcode === 0) msgs.push(`💰 最新余额：${d.result.balance} Coins`);
            } catch (e) {}
        }
        return { text: msgs.join('\n'), deregistered: flag.deregistered };
    }).catch(err => {
        msgs.push(`❌ 异常：${err.error || String(err)}`);
        return { text: msgs.join('\n'), deregistered: false };
    });
}

// ---- PingMe 抓包入库分支：http-request 命中 queryBalanceAndBonus 时调用 ----
function runPingMeCapture() {
    // Surge 脚本面板手动点"运行"测试时，会发一个假请求（通常是 http://www.apple.com/）
    // 来触发脚本，而不是真实的 PingMe 流量。这里做校验，避免把空数据当账号存进去。
    const url = $request.url || '';
    const paramsRaw = parseRawQuery(url);
    const headersMap = normalizeHeaderNameMap($request.headers || {});

    const isRealPingMeRequest = url.includes(PINGME_HOST) && (paramsRaw.sign || paramsRaw.uniquedeviceid);
    if (!isRealPingMeRequest) {
        console.log(`【${scriptName}】忽略非真实请求（可能是手动测试触发）：${url}`);
        pingmeNotify('⚠️ 未捕获到有效账号', '这次触发不是真实的 PingMe 请求（可能是手动点了"运行"测试），已忽略，不会入库。\n请打开 PingMe App 触发一次真实请求再试。');
        $done({});
        return;
    }
    let baseUA = '';
    Object.keys(headersMap).forEach(k => { if (k.toLowerCase() === 'user-agent') baseUA = headersMap[k]; });

    const store = loadStore();
    const fp = fingerprintOf(paramsRaw);
    const now = Date.now();
    const existed = !!store.accounts[fp];
    const uaSeed = existed ? store.accounts[fp].uaSeed : store.order.length;
    const alias = existed ? store.accounts[fp].alias : `账号${store.order.length + 1}`;
    let email = '';
    try { email = decodeURIComponent(paramsRaw.email || ''); } catch (e) { email = paramsRaw.email || ''; }

    store.accounts[fp] = {
        id: fp,
        alias,
        email,
        uaSeed,
        baseUA,
        capture: { url: $request.url, paramsRaw, headers: headersMap },
        createdAt: existed ? store.accounts[fp].createdAt : now,
        updatedAt: now
    };
    if (!existed) store.order.push(fp);
    saveStore(store);

    const total = store.order.length;
    pingmeNotify(existed ? '🔄 账号参数已更新' : '✅ 新账号已入库', `${alias}（id:${fp}）${email ? `\n📧 ${email}` : ''}\n当前账号总数：${total}`);
    console.log(`【${scriptName}】${existed ? 'update' : 'add'} account ${fp}\n${JSON.stringify(store.accounts[fp], null, 2)}`);
    $done({});
}

// ---- PingMe 定时签到分支：cron 触发（无 $request）时调用 ----
function runPingMeCron() {
    console.log(`【${scriptName}】cron 签到开始`);
    const store = loadStore();

    // 自愈：清掉之前手动测试触发写进去的无效空壳账号
    const invalidIds = store.order.filter(id => store.accounts[id] && !isValidAccount(store.accounts[id]));
    let purgedNote = '';
    if (invalidIds.length) {
        const purged = removeAccounts(store, invalidIds);
        saveStore(store);
        purgedNote = `\n🧹 已清理无效账号：${purged.join('、')}`;
        console.log(`【${scriptName}】清理无效账号：${invalidIds.join(',')}`);
    }

    const ids = store.order.filter(id => store.accounts[id]);
    if (!ids.length) {
        pingmeNotify('⚠️ 未抓到任何账号', '请先打开 PingMe 触发抓包' + purgedNote);
        $done();
        return;
    }
    const total = ids.length;
    const results = [];
    const deadIds = [];
    const cronDeadlineAt = Date.now() + CRON_TIME_BUDGET_MS;
    let chain = Promise.resolve();
    ids.forEach((id, idx) => {
        chain = chain.then(() => {
            if (Date.now() >= cronDeadlineAt) {
                results.push(`[账号${idx+1}/${total} ${store.accounts[id].alias || id}]\n⏭ 时间预算不足，本轮跳过`);
                return null;
            }
            return runAccount(store.accounts[id], idx, total, cronDeadlineAt);
        })
            .then(r => {
                if (r) {
                    results.push(r.text);
                    if (r.deregistered) deadIds.push(id);
                }
            })
            .then(() => idx < ids.length - 1 ? sleep(ACCOUNT_GAP) : null);
    });
    chain.then(() => {
        let extra = '';
        if (deadIds.length) {
            const freshStore = loadStore();
            const removed = removeAccounts(freshStore, deadIds);
            saveStore(freshStore);
            if (removed.length) extra = `\n———\n🗑 已移除注销账号：${removed.join('、')}（剩余${freshStore.order.length}个）`;
        }
        pingmeNotify(`🎉 全部完成 (${total}个账号)`, results.join('\n———\n') + extra + purgedNote);
        $done();
    }).catch(err => {
        pingmeNotify('❌ 任务异常', results.join('\n———\n') + '\n' + (err.error || String(err)));
        $done();
    });
}

////////////////////////////////////////////////////////////////////////////
// ============================ 入口：分流逻辑 ============================
////////////////////////////////////////////////////////////////////////////

if (typeof $request !== 'undefined' && $request) {
    // 有 $request：http-request 触发，走 PingMe 抓包入库
    runPingMeCapture();
} else {
    // 没有 $request：cron 定时触发，走 PingMe 自动签到
    runPingMeCron();
}
