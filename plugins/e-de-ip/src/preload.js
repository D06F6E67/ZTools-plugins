const os = require('os');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { execFile } = require('child_process');

const SITES = [
    { id: 'baidu', name: '百度搜索', region: '境内网站', url: 'https://www.baidu.com' },
    { id: 'netease', name: '网易云', region: '境内网站', url: 'https://music.163.com' },
    { id: 'github', name: 'GitHub', region: '境外网站', url: 'https://github.com' },
    { id: 'google', name: 'Google', region: '境外网站', url: 'https://www.google.com' },
    { id: 'aliyun', name: '阿里云', region: '境内网站', url: 'https://www.aliyun.com' },
    { id: 'tencent', name: '腾讯云', region: '境内网站', url: 'https://cloud.tencent.com' },
    { id: 'chatgpt', name: 'ChatGPT', region: '境外网站', url: 'https://chatgpt.com' },
    { id: 'cursor', name: 'Cursor', region: '境外网站', url: 'https://cursor.com' }
];

const UA = 'e-de-ip/1.0.4 (ztools plugin; +https://github.com/DoneVirtue)';

const HK_DISTRICTS = [
    ['Central and Western', '中西区'],
    ['Wan Chai', '湾仔区'],
    ['Eastern', '东区'],
    ['Southern', '南区'],
    ['Yau Tsim Mong', '油尖旺区'],
    ['Sham Shui Po', '深水埗区'],
    ['Kowloon City', '九龙城区'],
    ['Wong Tai Sin', '黄大仙区'],
    ['Kwun Tong', '观塘区'],
    ['Kwai Tsing', '葵青区'],
    ['Tsuen Wan', '荃湾区'],
    ['Tuen Mun', '屯门区'],
    ['Yuen Long', '元朗区'],
    ['North', '北区'],
    ['Tai Po', '大埔区'],
    ['Sai Kung', '西贡区'],
    ['Sha Tin', '沙田区'],
    ['Islands', '离岛区']
];

const TRAD_MAP = {
    '區': '区',
    '圍': '围',
    '園': '园',
    '國': '国',
    '門': '门',
    '東': '东',
    '灣': '湾',
    '島': '岛',
    '觀': '观',
    '樂': '乐',
    '麗': '丽',
    '處': '处',
    '場': '场',
    '遊': '游',
    '業': '业',
    '廣': '广',
    '臺': '台',
    '裡': '里',
    '裏': '里',
    '陽': '阳',
    '龍': '龙',
    '鄉': '乡',
    '鎮': '镇',
    '縣': '县',
    '學': '学',
    '館': '馆',
    '廟': '庙',
    '橋': '桥',
    '點': '点',
    '號': '号',
    '顯': '显',
    '與': '与',
    '餘': '余',
    '術': '术',
    '頭': '头',
    '徑': '径',
    '埗': '埗'
};

const LOCAL_PROXY_PORTS = [
    [7890, 'http'], [7897, 'http'], [1087, 'http'], [6152, 'http'],
    [20171, 'http'], [2080, 'http'], [7892, 'http'], [9091, 'http'],
    [8888, 'http'], [8118, 'http'], [10809, 'http'], [12334, 'http'],
    [7891, 'socks'], [1080, 'socks'], [6153, 'socks'], [10808, 'socks']
];

const PUBLIC_IP_URLS = [
    'https://my.ip.cn',
    'https://api.ipgeolocation.io/getip',
    'http://ip.3322.net/',
    'https://ip.3322.net/',
    'http://members.3322.org/dyndns/getip',
    'https://ddns.oray.com/checkip',
    'https://whois.pconline.com.cn/ipJson.jsp?json=true',
    'https://myip.ipip.net'
];

const OVERSEAS_IP_URLS = [
    'https://api.ipgeolocation.io/getip',
    'https://ipv4.icanhazip.com',
    'https://api4.ipify.org',
    'https://v4.ident.me',
    'https://ifconfig.me/ip'
];

const geoCache = new Map();
const listeners = new Set();
const copyTimers = {};
let state = emptyState();
let overseasProxy = null;

function emptyState() {
    return {
        interfaces: [],
        selectedIface: 'auto',
        autoCopy: false,
        copiedKey: '',
        lan: { ip: '', iface: '', label: '' },
        public: { ip: '', geo: '', loading: true },
        overseas: { ip: '', geo: '', loading: true },
        location: { text: '', loading: true },
        sites: SITES.map((s) => ({...s, ms: null, status: 'loading' })),
        dns: [],
        dnsLoading: true,
        keys: { amap: '', qq: '', ipgeo: '' }
    };
}

function emit() {
    const snapshot = JSON.parse(JSON.stringify(state));
    listeners.forEach((fn) => {
        try { fn(snapshot); } catch (e) {}
    });
}

function getPref(key, fallback) {
    try {
        const value = ztools.dbStorage.getItem(key);
        return value == null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

function setPref(key, value) {
    try { ztools.dbStorage.setItem(key, value); } catch (e) {}
}

function loadKeys() {
    return {
        amap: String(getPref('keyAmap', '') || '').trim(),
        qq: String(getPref('keyQq', '') || '').trim(),
        ipgeo: String(getPref('keyIpgeo', '') || '').trim()
    };
}

function apiKeys() {
    return state.keys || loadKeys();
}

function listInterfaces() {
    const nets = os.networkInterfaces() || {};
    const list = [];
    Object.keys(nets).forEach((name) => {
        (nets[name] || []).forEach((net) => {
            const family = String(net.family);
            if (net.internal) return;
            if (family !== 'IPv4' && family !== '4') return;
            list.push({ name, address: net.address });
        });
    });
    return list;
}

function pickLan(interfaces, selectedIface) {
    if (!interfaces.length) return { ip: '', iface: '', label: '未检测到内网地址' };
    let chosen = interfaces[0];
    if (selectedIface && selectedIface !== 'auto') {
        chosen = interfaces.find((item) => item.name === selectedIface) || chosen;
    } else {
        chosen = interfaces.find((item) => /^(en0|eth0|wlan0|Wi-Fi)$/i.test(item.name)) || chosen;
    }
    return {
        ip: chosen.address,
        iface: chosen.name,
        label: chosen.name + ' / ' + chosen.address
    };
}

function parseProxyUrl(raw) {
    if (!raw) return null;
    try {
        const u = new URL(/:\/\//.test(raw) ? raw : 'http://' + raw);
        const proto = (u.protocol || 'http:').replace(':', '').toLowerCase();
        const type = proto.indexOf('socks') >= 0 ? 'socks' : 'http';
        const port = Number(u.port) || (type === 'socks' ? 1080 : 8080);
        if (!u.hostname || !port) return null;
        return { type, host: u.hostname, port };
    } catch (e) {
        return null;
    }
}

function parseScutilProxy(text) {
    const num = (key) => {
        const match = String(text || '').match(new RegExp(key + '\\s*:\\s*(\\d+)'));
        return match ? Number(match[1]) : 0;
    };
    const str = (key) => {
        const match = String(text || '').match(new RegExp(key + '\\s*:\\s*(\\S+)'));
        return match ? match[1] : '';
    };
    if (num('HTTPSEnable')) return { type: 'http', host: str('HTTPSProxy'), port: num('HTTPSPort') };
    if (num('HTTPEnable')) return { type: 'http', host: str('HTTPProxy'), port: num('HTTPPort') };
    if (num('SOCKSEnable')) return { type: 'socks', host: str('SOCKSProxy'), port: num('SOCKSPort') };
    return null;
}

function parseWinProxy(text) {
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(text)) return null;
    const match = text.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!match) return null;
    const raw = match[1].replace(/^https?=/, '');
    if (raw.indexOf('=') >= 0) {
        const http = raw.match(/https?=([^;]+)/i);
        return parseProxyUrl(http ? http[1] : raw);
    }
    return parseProxyUrl(raw);
}

function proxyKey(proxy) {
    return proxy.type + '://' + proxy.host + ':' + proxy.port;
}

function formatCurlProxy(proxy) {
    if (!proxy) return '';
    return (proxy.type === 'socks' ? 'socks5h://' : 'http://') + proxy.host + ':' + proxy.port;
}

function tcpOpen(host, port, timeout) {
    return new Promise((resolve) => {
        const sock = net.connect({ host, port, timeout: timeout || 150 });
        const done = (ok) => {
            sock.removeAllListeners();
            sock.destroy();
            resolve(ok);
        };
        sock.once('connect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
    });
}

async function detectProxyCandidates() {
    const list = [];
    const seen = new Set();
    const add = (proxy) => {
        if (!proxy || !proxy.host || !proxy.port) return;
        const key = proxyKey(proxy);
        if (seen.has(key)) return;
        seen.add(key);
        list.push(proxy);
    };

    const localOpen = await Promise.all(LOCAL_PROXY_PORTS.map(async (item) => {
        const open = await tcpOpen('127.0.0.1', item[0], 180);
        return open ? { type: item[1], host: '127.0.0.1', port: item[0] } : null;
    }));
    localOpen.filter(Boolean).forEach(add);

    add(parseProxyUrl(process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy));

    if (process.platform === 'darwin') {
        add(parseScutilProxy(await runCmd('scutil', ['--proxy'])));
    } else if (process.platform === 'win32') {
        add(parseWinProxy(await runCmd('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])));
    }
    return list;
}

function curlRequest(url, options = {}) {
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    const args = [
        '-sS', '-L', '--max-redirs', '3',
        '-m', String(Math.max(2, Math.ceil(timeout / 1000))),
        '-A', UA, '--ipv4', '-o', '-',
        '-w', '\n__MS__%{time_total}',
        '-H', 'Accept: */*'
    ];
    if (method === 'HEAD') args.push('-I');
    else if (method !== 'GET') args.push('-X', method);
    if (options.proxy) args.push('-x', formatCurlProxy(options.proxy));
    args.push(url);
    return new Promise((resolve, reject) => {
        execFile('curl', args, { timeout: timeout + 800, maxBuffer: 512 * 1024 }, (err, stdout) => {
            const text = String(stdout || '');
            if (err && !text) {
                reject(err);
                return;
            }
            const idx = text.lastIndexOf('\n__MS__');
            const body = idx >= 0 ? text.slice(0, idx) : text;
            const sec = idx >= 0 ? parseFloat(text.slice(idx + 7)) : 0;
            resolve({
                status: err ? 0 : 200,
                buffer: Buffer.from(body),
                body,
                ms: Math.max(1, Math.round((sec || 0) * 1000))
            });
        });
    });
}

function collectSocketResponse(stream, started, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const finish = () => {
            const buf = Buffer.concat(chunks);
            const split = buf.indexOf('\r\n\r\n');
            const head = split >= 0 ? buf.slice(0, split).toString('latin1') : '';
            const body = split >= 0 ? buf.slice(split + 4) : buf;
            const status = parseInt((head.split(' ')[1] || '0'), 10) || 0;
            const headers = {};
            head.split('\r\n').slice(1).forEach((line) => {
                const i = line.indexOf(':');
                if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
            });
            resolve({
                status,
                headers,
                buffer: body,
                body: body.toString('utf8'),
                ms: Date.now() - started
            });
        };
        stream.on('data', (c) => {
            chunks.push(c);
            size += c.length;
            if (size > (maxBytes || 512 * 1024)) stream.destroy();
        });
        stream.on('end', finish);
        stream.on('error', reject);
        stream.on('timeout', () => {
            stream.destroy();
            reject(new Error('timeout'));
        });
    });
}

function socksConnect(proxy, hostname, port, timeout) {
    return new Promise((resolve, reject) => {
        const sock = net.connect({ host: proxy.host, port: proxy.port, timeout });
        let step = 0;
        let buf = Buffer.alloc(0);
        const fail = (err) => {
            sock.destroy();
            reject(err);
        };
        sock.on('connect', () => sock.write(Buffer.from([0x05, 0x01, 0x00])));
        sock.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (step === 0) {
                if (buf.length < 2) return;
                if (buf[0] !== 5 || buf[1] !== 0) return fail(new Error('socks auth'));
                buf = buf.slice(2);
                step = 1;
                const hostBuf = Buffer.from(hostname);
                const req = Buffer.alloc(7 + hostBuf.length);
                req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3; req[4] = hostBuf.length;
                hostBuf.copy(req, 5);
                req.writeUInt16BE(port, 5 + hostBuf.length);
                sock.write(req);
                return;
            }
            if (buf.length < 5) return;
            if (buf[1] !== 0) return fail(new Error('socks fail'));
            const atyp = buf[3];
            const need = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? 7 + buf[4] : 0;
            if (!need || buf.length < need) return;
            sock.removeAllListeners('data');
            resolve(sock);
        });
        sock.on('error', reject);
        sock.on('timeout', () => fail(new Error('timeout')));
    });
}

function httpConnect(proxy, hostname, port, timeout) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: proxy.host,
            port: proxy.port,
            method: 'CONNECT',
            path: hostname + ':' + port,
            timeout,
            headers: { Host: hostname + ':' + port }
        });
        req.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                reject(new Error('proxy connect ' + res.statusCode));
                return;
            }
            resolve(socket);
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.end();
    });
}

function writeHttp(socket, parsed, method, options) {
    const lines = [
        method + ' ' + (parsed.pathname + parsed.search || '/') + ' HTTP/1.1',
        'Host: ' + parsed.hostname,
        'User-Agent: ' + UA,
        'Accept: */*',
        'Connection: close',
        '',
        ''
    ];
    socket.write(lines.join('\r\n'));
}

function requestViaNodeProxy(url, options, hops) {
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    const proxy = options.proxy;
    const parsed = new URL(url);
    const started = Date.now();
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const isHttps = parsed.protocol === 'https:';

    const send = async (socket) => {
        const stream = isHttps
            ? tls.connect({ socket, servername: parsed.hostname, timeout })
            : socket;
        if (stream.setTimeout) stream.setTimeout(timeout);
        if (isHttps) await new Promise((resolve, reject) => {
            stream.once('secureConnect', resolve);
            stream.once('error', reject);
        });
        writeHttp(stream, parsed, method, options);
        const res = await collectSocketResponse(stream, started);
        if (res.status >= 300 && res.status < 400 && res.headers.location && hops < 5) {
            stream.destroy();
            return request(new URL(res.headers.location, url).toString(), options, hops + 1);
        }
        return res;
    };

    if (!isHttps && proxy.type !== 'socks') {
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: proxy.host,
                port: proxy.port,
                method,
                path: url,
                timeout,
                headers: Object.assign({
                    Host: parsed.host,
                    'User-Agent': UA,
                    Accept: '*/*',
                    'Proxy-Connection': 'close'
                }, options.headers || {})
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
                    res.resume();
                    request(new URL(res.headers.location, url).toString(), options, hops + 1).then(resolve, reject);
                    return;
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({ status: res.statusCode || 0, buffer: buf, body: buf.toString('utf8'), ms: Date.now() - started });
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.on('error', reject);
            req.end();
        });
    }

    const opener = proxy.type === 'socks'
        ? socksConnect(proxy, parsed.hostname, port, timeout)
        : httpConnect(proxy, parsed.hostname, port, timeout);
    return opener.then(send);
}

function request(url, options = {}, hops = 0) {
    if (options.proxy) {
        return curlRequest(url, options).catch(() => requestViaNodeProxy(url, options, hops));
    }
    const timeout = options.timeout || 7000;
    const method = options.method || 'GET';
    return new Promise((resolve, reject) => {
        const go = (target) => {
            let parsed;
            try { parsed = new URL(target); } catch (e) {
                reject(e);
                return;
            }
            const lib = parsed.protocol === 'https:' ? https : http;
            const started = Date.now();
            const reqOpts = {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                timeout,
                headers: Object.assign({
                    'User-Agent': UA,
                    'Accept': '*/*'
                }, options.headers || {})
            };
            if (options.family) reqOpts.family = options.family;
            const req = lib.request(reqOpts, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
                    hops += 1;
                    res.resume();
                    go(new URL(res.headers.location, target).toString());
                    return;
                }
                const chunks = [];
                res.on('data', (c) => {
                    chunks.push(c);
                    const size = chunks.reduce((n, b) => n + b.length, 0);
                    if (size > 512 * 1024) res.destroy();
                });
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode || 0,
                        buffer: buf,
                        body: buf.toString('utf8'),
                        ms: Date.now() - started
                    });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('timeout'));
            });
            req.on('error', reject);
            req.end();
        };
        go(url);
    });
}

function decodeText(buffer, charset) {
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch (e) {
        return Buffer.from(buffer).toString('utf8');
    }
}

function extractIPv4(text) {
    const matches = String(text || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g) || [];
    for (let i = 0; i < matches.length; i++) {
        const parts = matches[i].split('.').map(Number);
        if (parts.some((n) => n > 255)) continue;
        if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) continue;
        if (parts[0] === 169 && parts[1] === 254) continue;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
        if (parts[0] === 192 && parts[1] === 168) continue;
        return matches[i];
    }
    return '';
}

function extractPublicIPv4(text) {
    const raw = String(text || '').replace(/^\ufeff/, '').trim();
    const fromJson = (obj) => {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
            obj.ip, obj.query, obj.cip, obj.origin, obj.address,
            obj.data && (obj.data.ip || obj.data.query)
        ];
        for (let i = 0; i < candidates.length; i++) {
            const ip = extractIPv4(String(candidates[i] || ''));
            if (ip) return ip;
        }
        return '';
    };
    try {
        const ip = fromJson(JSON.parse(raw));
        if (ip) return ip;
    } catch (e) {}
    const sohu = raw.match(/returnCitySN\s*=\s*(\{[\s\S]*?\})/);
    if (sohu) {
        try {
            const ip = fromJson(JSON.parse(sohu[1]));
            if (ip) return ip;
        } catch (e) {}
    }
    return extractIPv4(raw);
}

function extractIPv6(text) {
    const match = String(text || '').match(/\b((?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4})\b/);
    if (!match) return '';
    const ip = match[1];
    if (ip.indexOf('.') >= 0) return '';
    if (/^fe80:/i.test(ip) || /^::1$/.test(ip) || /^fc/i.test(ip) || /^fd/i.test(ip)) return '';
    return ip;
}

function isPrivateIp(ip) {
    const parts = String(ip || '').split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
        return /^fe80:/i.test(ip) || /^fc/i.test(ip) || /^fd/i.test(ip) || ip === '::1';
    }
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

async function fetchIPv4(urls, options = {}) {
    return new Promise((resolve) => {
        const list = urls || [];
        if (!list.length) {
            resolve('');
            return;
        }
        let left = list.length;
        let settled = false;
        const finish = (ip) => {
            if (settled) return;
            if (ip) {
                settled = true;
                resolve(ip);
            } else if (left <= 0) {
                settled = true;
                resolve('');
            }
        };
        list.forEach((url) => {
            request(url, {
                timeout: options.timeout || 4000,
                family: options.family || 4,
                proxy: options.proxy
            }).then((res) => {
                left -= 1;
                finish(extractPublicIPv4(res.body));
            }).catch(() => {
                left -= 1;
                finish('');
            });
        });
    });
}

async function fetchIPv6(urls) {
    return new Promise((resolve) => {
        const list = urls || [];
        if (!list.length) {
            resolve('');
            return;
        }
        let left = list.length;
        let settled = false;
        const finish = (ip) => {
            if (settled) return;
            if (ip) {
                settled = true;
                resolve(ip);
            } else if (left <= 0) {
                settled = true;
                resolve('');
            }
        };
        list.forEach((url) => {
            request(url, { timeout: 4000 }).then((res) => {
                left -= 1;
                finish(extractIPv6(res.body));
            }).catch(() => {
                left -= 1;
                finish('');
            });
        });
    });
}

function formatCnAdminLine(text) {
    const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    if (/移动|联通|电信|广电|铁通|鹏博士/.test(tokens[tokens.length - 1])) tokens.pop();
    return tokens.map((part, idx) => {
        if (/香港|澳门|台湾|特别行政区/.test(part) || /[省市县]$/.test(part)) return part;
        if (idx === 0 && /^(中国|China)$/i.test(part)) return '中国';
        if (idx === tokens.length - 1 && part.length <= 4 && !/[区市州]$/.test(part)) return part + '区';
        return addShi(part);
    }).join(' ');
}

async function fetchMyIpCn() {
    const res = await request('https://my.ip.cn', { timeout: 5000, family: 4 });
    const text = String(res.body || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/ip[：:]\s*(\S+)\s*归属地[：:]\s*(.+)$/i) || text.match(/ip[：:]\s*(\S+)/i);
    const rawIp = match ? match[1] : '';
    const addr = match && match[2] ? match[2].trim() : '';
    return {
        ip: extractPublicIPv4(rawIp || text) || extractIPv6(rawIp || text),
        cnLine: formatCnAdminLine(addr),
        addr
    };
}

async function lookupAmapRegeo(lon, lat) {
    if (lon == null || lat == null) return null;
    const res = await request(
        'https://www.amap.com/service/regeo?longitude=' + encodeURIComponent(lon) + '&latitude=' + encodeURIComponent(lat),
        { timeout: 5000, headers: { Referer: 'https://www.amap.com/' } }
    );
    const json = JSON.parse(res.body);
    const data = json && (json.data || json);
    if (!data || (data.code !== '1' && data.result !== 'true' && !data.province)) return null;
    const out = {
        country: data.country || '',
        province: data.province || '',
        city: data.city || '',
        district: data.district || '',
        township: data.township || '',
        pos: data.pos || '',
        desc: data.desc || '',
        formatted: compactJoin(String(data.desc || '').split(/[,，]/))
    };
    if (!out.province && !out.city && !out.district && !out.desc && !out.pos) return null;
    return out;
}

function randomId(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

function looksGarbled(text) {
    if (!text) return true;
    if (/[\uFFFD]/.test(text)) return true;
    const cjk = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjk >= 2) return false;
    return /[ÃÅÄÆÉÊÌÍÎÏÐÑÒÓÕÖØÙÚÛÜÝ]/.test(text);
}

function toSimplified(text) {
    return String(text || '').replace(/[區圍園國門東灣島觀樂麗處場遊業廣臺裡裏陽龍鄉鎮縣學館廟橋點號顯與餘術]/g, (ch) => TRAD_MAP[ch] || ch);
}

function flagEmoji(code) {
    const cc = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function addShi(name) {
    const text = String(name || '').trim();
    if (!text || /[市区县]$/.test(text) || /香港|澳门|台湾/.test(text)) return text;
    if (/^(北京|天津|上海|重庆)$/.test(text)) return text + '市';
    return text;
}

function shortIsp(info) {
    if (!info) return '';
    const as = String(info.as || '');
    const m = as.match(/^AS\d+\s+(.+)/);
    if (m) return m[1].replace(/\s+Mass Internet$/i, '').trim();
    const org = String(info.org || '').replace(/\s+Mass Internet$/i, '').trim();
    if (org && org.length < 48) return org;
    const isp = String(info.ispEn || info.isp || '').replace(/\s+Mass Internet$/i, '').trim();
    if (/HKT/i.test(isp)) return 'HKT Limited';
    if (/China Mobile/i.test(isp)) return 'China Mobile';
    if (/Google/i.test(isp)) return 'Google';
    return isp;
}

function hkDistrict(info) {
    if (!isHongKong(info)) return '';
    const blob = [info && info.region, info && info.regionEn, info && info.city, info && info.cityEn, info && info.district].join(' ');
    for (let i = 0; i < HK_DISTRICTS.length; i++) {
        if (new RegExp(HK_DISTRICTS[i][0], 'i').test(blob)) return HK_DISTRICTS[i][1];
    }
    const raw = toSimplified(info && (info.district || '') || '');
    if (/区$/.test(raw)) return raw;
    if (raw && !/[A-Za-z]/.test(raw) && !/[省市州县]$/.test(raw)) return raw + '区';
    return '';
}

function isHongKong(info) {
    if (!info) return false;
    const cc = String(info.countryCode || '').toUpperCase();
    return cc === 'HK' || /香港|Hong Kong/i.test(info.country || '');
}

function uniqJoin(parts, sep) {
    const seen = new Set();
    const out = [];
    parts.forEach((part) => {
        const text = String(part || '').replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        out.push(text);
    });
    return out.join(sep == null ? ' ' : sep);
}

function photonName(text) {
    const s = toSimplified(String(text || '').trim());
    if (!s) return '';
    const pair = s.match(/[\u4e00-\u9fff][\u4e00-\u9fff0-9\-·]*[\u4e00-\u9fff0-9]/);
    if (pair && pair[0].length >= 2) return pair[0];
    const start = s.match(/^[\u4e00-\u9fff]+/);
    if (start && start[0].length >= 2) return start[0];
    return s;
}

function preferLocalName(a, b) {
    const x = photonName(a);
    const y = photonName(b);
    const xc = /[\u4e00-\u9fff]/.test(x);
    const yc = /[\u4e00-\u9fff]/.test(y);
    if (xc && !yc) return x;
    if (yc && !xc) return y;
    if (x.length >= y.length) return x || y;
    return y || x;
}

function compactJoin(parts) {
    const tokens = [];
    (parts || []).forEach((raw) => {
        const text = photonName(raw);
        if (!text) return;
        if (tokens.some((item) => item === text)) return;
        if (tokens.some((item) => item.indexOf(text) >= 0 && item.length > text.length)) return;
        for (let i = tokens.length - 1; i >= 0; i--) {
            if (text.indexOf(tokens[i]) >= 0 && text.length > tokens[i].length) tokens.splice(i, 1);
        }
        tokens.push(text);
    });
    let out = '';
    tokens.forEach((text) => {
        if (!out) {
            out = text;
            return;
        }
        const bothCjk = /[\u4e00-\u9fff]$/.test(out) && /^[\u4e00-\u9fff]/.test(text);
        out += bothCjk ? text : ' ' + text;
    });
    return out;
}

function formatGeo(info, style) {
    if (!info) return '';
    if (style === 'dns') {
        if (info.dnsGeo) return info.dnsGeo;
        const country = info.countryEn || info.country || '';
        const city = info.cityEn || info.city || info.regionEn || info.region || '';
        const isp = shortIsp(info) || info.isp || '';
        return [country, city, isp].filter(Boolean).join(' ');
    }
    if (style === 'overseas') {
        const flag = flagEmoji(info.countryCode);
        const line = uniqJoin([
            info.countryEn || info.country,
            info.regionEn || info.region,
            info.cityEn || info.city,
            info.districtEn,
            shortIsp(info)
        ]);
        return (flag + line).trim();
    }
    if (style === 'public') {
        if (info.cnLine) return info.cnLine;
        return uniqJoin([
            info.country || '中国',
            addShi(info.region),
            addShi(info.city),
            info.district
        ]);
    }
    if (info.addr && /[\u4e00-\u9fff]/.test(info.addr) && !looksGarbled(info.addr)) {
        return info.addr.replace(/\s+/g, ' ').trim();
    }
    return uniqJoin([info.country, info.region, info.city, info.district]);
}

function formatLocation(info) {
    if (!info) return '';
    if (info.locationText) return info.locationText;
    if (isHongKong(info)) {
        const district = hkDistrict(info);
        const poi = toSimplified(info.landmark || '').replace(/市$/g, '');
        return compactJoin(['香港特别行政区', district, poi]);
    }
    return compactJoin([
        info.country,
        info.region,
        info.city,
        info.district,
        info.landmark
    ]);
}

function runCmd(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            resolve(err ? '' : String(stdout || ''));
        });
    });
}

function pushIp(list, ip) {
    if (!ip) return;
    const cleaned = String(ip).replace(/^\[|\]$/g, '').trim();
    if (!cleaned) return;
    if (cleaned === '127.0.0.1' || cleaned === '::1' || cleaned === '0.0.0.0') return;
    if (cleaned.indexOf('224.') === 0 || cleaned.indexOf('255.') === 0) return;
    if (/^fe80:/i.test(cleaned) || /^ff/i.test(cleaned)) return;
    const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned);
    const isV6 = cleaned.indexOf(':') >= 0;
    if (!isV4 && !isV6) return;
    list.push(cleaned);
}

function emptyInfo() {
    return {
        country: '',
        countryEn: '',
        countryCode: '',
        region: '',
        regionEn: '',
        city: '',
        cityEn: '',
        district: '',
        districtEn: '',
        isp: '',
        ispEn: '',
        org: '',
        as: '',
        lat: null,
        lon: null,
        addr: '',
        cnLine: '',
        landmark: '',
        locationText: '',
        dnsGeo: ''
    };
}

function mergeInfo(base, extra) {
    const out = Object.assign(emptyInfo(), base || {});
    if (!extra) return out;
    Object.keys(extra).forEach((key) => {
        const val = extra[key];
        if (val == null || val === '') return;
        if ((key === 'lat' || key === 'lon') && out[key] == null) out[key] = val;
        else if (!out[key]) out[key] = val;
    });
    return out;
}

async function lookupIpApi(ip, lang) {
    const fields = 'status,country,countryCode,regionName,city,district,isp,org,as,asname,lat,lon,query';
    const res = await request(
        'http://ip-api.com/json/' + encodeURIComponent(ip) + '?lang=' + encodeURIComponent(lang || 'zh-CN') + '&fields=' + fields, { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.status !== 'success') return null;
    const info = emptyInfo();
    info.countryCode = json.countryCode || '';
    info.as = json.as || '';
    info.org = json.org || '';
    info.lat = typeof json.lat === 'number' ? json.lat : null;
    info.lon = typeof json.lon === 'number' ? json.lon : null;
    if (lang === 'en') {
        info.countryEn = json.country || '';
        info.regionEn = json.regionName || '';
        info.cityEn = json.city || '';
        info.districtEn = json.district || '';
        info.ispEn = json.isp || '';
    } else {
        info.country = json.country || '';
        info.region = json.regionName || '';
        info.city = json.city || '';
        info.district = json.district || '';
        info.isp = json.isp || '';
        info.addr = [json.country, json.regionName, json.city].filter(Boolean).join(' ');
    }
    return info;
}

async function lookupCz88(ip) {
    const res = await request('https://www.cz88.net/api/cz88/ip/base?ip=' + encodeURIComponent(ip), { timeout: 5000 });
    const json = JSON.parse(res.body);
    const data = json && json.data;
    if (!data) return null;
    const info = emptyInfo();
    info.country = data.country || '';
    info.countryCode = data.countryCode || '';
    info.region = data.province || '';
    info.city = data.city || '';
    info.district = data.districts && data.districts !== '未知' ? data.districts : '';
    info.isp = data.isp || '';
    info.org = data.company || data.asn || '';
    if (data.locations && data.locations[0]) {
        info.lat = Number(data.locations[0].latitude);
        info.lon = Number(data.locations[0].longitude);
    }
    const country = info.country || '中国';
    const prov = addShi(info.region);
    const city = addShi(info.city);
    const dist = info.district;
    info.cnLine = uniqJoin([country, prov, city, dist]);
    return info;
}

async function lookupPconline(ip) {
    const res = await request('https://whois.pconline.com.cn/ipJson.jsp?json=true&ip=' + encodeURIComponent(ip), { timeout: 5000 });
    const raw = decodeText(res.buffer, 'gbk').replace(/^\ufeff/, '');
    const json = JSON.parse(raw);
    if (!json || (!json.addr && !json.ip)) return null;
    const info = emptyInfo();
    info.country = json.pro || '中国';
    info.region = json.city || '';
    info.city = json.region || json.city || '';
    info.isp = json.addr || '';
    info.addr = json.addr || '';
    return info;
}

function photonFeatureName(feature) {
    const props = feature && feature.properties;
    return photonName(props && (props.name || props.street));
}

function photonDistance(feature, lat, lon) {
    const coords = feature && feature.geometry && feature.geometry.coordinates;
    if (!coords) return 99;
    return Math.hypot(Number(coords[1]) - lat, Number(coords[0]) - lon);
}

async function lookupPhotonReverse(lat, lon) {
    if (lat == null || lon == null) return null;
    const res = await request(
        'https://photon.komoot.io/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    const props = json && json.features && json.features[0] && json.features[0].properties;
    if (!props) return null;
    return {
        name: photonName(props.name),
        street: photonName(props.street),
        housenumber: props.housenumber ? String(props.housenumber) : '',
        locality: photonName(props.locality),
        district: photonName(props.district),
        city: photonName(props.city),
        county: photonName(props.county),
        state: photonName(props.state),
        country: photonName(props.country)
    };
}

async function findNearbyLandmark(lat, lon, city) {
    if (lat == null || lon == null) return '';
    const cityName = photonName(String(city || '').replace(/市$/, ''));
    if (cityName && /[\u4e00-\u9fff]/.test(cityName)) {
        const q = cityName.replace(/特别行政区$/, '') + '公园';
        try {
            const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) +
                '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&limit=5';
            const res = await request(url, { timeout: 5000 });
            const list = (JSON.parse(res.body) || {}).features || [];
            let best = '';
            let bestD = 0.03;
            list.forEach((item) => {
                const d = photonDistance(item, lat, lon);
                const name = photonFeatureName(item);
                if (name && /公园|公園|Park/i.test(name) && d < bestD) {
                    bestD = d;
                    best = name;
                }
            });
            if (best) return toSimplified(best);
        } catch (e) {}
    }
    return '';
}

function amapText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.filter(Boolean).join('');
    return String(value).trim();
}

async function lookupAmapIp(ip) {
    const key = apiKeys().amap;
    if (!key || !ip) return null;
    const type = String(ip).indexOf(':') >= 0 ? '6' : '4';
    const res = await request(
        'https://restapi.amap.com/v5/ip/location?key=' + encodeURIComponent(key) + '&type=' + type + '&ip=' + encodeURIComponent(ip),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || String(json.status) !== '1') return null;
    const info = emptyInfo();
    info.country = amapText(json.country);
    info.region = amapText(json.province);
    info.city = amapText(json.city) || info.region;
    info.district = amapText(json.district);
    info.isp = amapText(json.isp);
    const loc = amapText(json.location).split(',');
    if (loc.length === 2) {
        info.lon = Number(loc[0]);
        info.lat = Number(loc[1]);
    }
    info.cnLine = uniqJoin([info.country, addShi(info.region), addShi(info.city), info.district]);
    return info;
}

async function lookupAmapRegeoKey(lon, lat) {
    const key = apiKeys().amap;
    if (!key || lon == null || lat == null) return null;
    const res = await request(
        'https://restapi.amap.com/v3/geocode/regeo?key=' + encodeURIComponent(key) +
        '&location=' + encodeURIComponent(lon + ',' + lat) + '&extensions=all&radius=500',
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || String(json.status) !== '1' || !json.regeocode) return null;
    const ac = json.regeocode.addressComponent || {};
    const pois = json.regeocode.pois || [];
    const park = pois.find((p) => /公园|公園|Park/i.test((p && (p.name || p.type)) || '')) || pois[0] || {};
    return {
        country: amapText(ac.country),
        province: amapText(ac.province),
        city: amapText(ac.city),
        district: amapText(ac.district),
        township: amapText(ac.township),
        formatted: amapText(json.regeocode.formatted_address),
        poi: amapText(park.name)
    };
}

async function lookupQqIp(ip) {
    const key = apiKeys().qq;
    if (!key || !ip) return null;
    const res = await request(
        'https://apis.map.qq.com/ws/location/v1/ip?ip=' + encodeURIComponent(ip) + '&key=' + encodeURIComponent(key),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.status !== 0 || !json.result) return null;
    const ad = json.result.ad_info || {};
    const loc = json.result.location || {};
    const info = emptyInfo();
    info.country = ad.nation || '';
    info.region = ad.province || '';
    info.city = ad.city || ad.province || '';
    info.district = ad.district || '';
    info.lat = typeof loc.lat === 'number' ? loc.lat : null;
    info.lon = typeof loc.lng === 'number' ? loc.lng : null;
    info.cnLine = uniqJoin([info.country, addShi(info.region), addShi(info.city), info.district]);
    return info;
}

async function lookupQqRegeo(lat, lon) {
    const key = apiKeys().qq;
    if (!key || lat == null || lon == null) return null;
    const res = await request(
        'https://apis.map.qq.com/ws/geocoder/v1/?location=' + encodeURIComponent(lat + ',' + lon) +
        '&key=' + encodeURIComponent(key) + '&get_poi=1',
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.status !== 0 || !json.result) return null;
    const ac = json.result.address_component || {};
    const pois = json.result.pois || [];
    const park = pois.find((p) => /公园|公園|Park/i.test((p && (p.title || p.category)) || '')) || pois[0] || {};
    const rec = json.result.formatted_addresses && json.result.formatted_addresses.recommend;
    return {
        province: ac.province || ac.nation || '',
        city: ac.city || '',
        district: ac.district || '',
        formatted: rec || json.result.address || '',
        poi: park.title || ''
    };
}

async function lookupIpGeoIo(ip) {
    const key = apiKeys().ipgeo;
    if (!key || !ip) return null;
    const res = await request(
        'https://api.ipgeolocation.io/ipgeo?apiKey=' + encodeURIComponent(key) + '&ip=' + encodeURIComponent(ip),
        { timeout: 5000 }
    );
    const json = JSON.parse(res.body);
    if (!json || json.message || !json.country_name) return null;
    const info = emptyInfo();
    info.countryEn = json.country_name || '';
    info.countryCode = json.country_code2 || json.country_code || '';
    info.regionEn = json.state_prov || '';
    info.cityEn = json.city || '';
    info.districtEn = json.district || '';
    info.ispEn = json.isp || '';
    info.org = json.organization || json.isp || '';
    info.lat = json.latitude != null ? Number(json.latitude) : null;
    info.lon = json.longitude != null ? Number(json.longitude) : null;
    if (json.country_name && /China|中国/i.test(json.country_name)) {
        info.country = '中国';
    }
    return info;
}

function pickLonger() {
    let best = '';
    let bestKey = '';
    for (let i = 0; i < arguments.length; i++) {
        const raw = String(arguments[i] || '').replace(/[,，]/g, ' ').replace(/\s+/g, ' ').trim();
        const key = raw.replace(/\s+/g, '');
        if (key.length > bestKey.length) {
            bestKey = key;
            best = raw;
        }
    }
    return best;
}

function buildLocationText(amap, qq, photon, info, landmark) {
    const country = preferLocalName((amap && amap.country) || (info && info.country), photon && photon.country);
    const province = preferLocalName(
        (amap && amap.province) || (qq && qq.province) || (info && info.region),
        photon && photon.state
    );
    const city = preferLocalName(
        (amap && amap.city) || (qq && qq.city) || (info && info.city),
        photon && photon.city
    );
    const hk = /香港/.test(province || '') || isHongKong(info);
    const district = preferLocalName(
        (amap && amap.district) || (qq && qq.district) || (hk ? hkDistrict(info) : '') || (info && info.district),
        photon && photon.district
    );
    const township = preferLocalName(amap && amap.township, photon && photon.locality);
    const street = (photon && photon.street) || '';
    const house = photon && photon.housenumber
        ? photon.housenumber + (/[号號]$/.test(photon.housenumber) ? '' : '号')
        : '';
    const poi = toSimplified((amap && amap.poi) || (qq && qq.poi) || landmark || (photon && photon.name) || '').replace(/市$/g, '');
    const formatted = pickLonger(
        amap && amap.formatted,
        qq && qq.formatted,
        compactJoin(String((amap && amap.desc) || '').split(/[,，]/))
    );
    const built = compactJoin([
        hk || (province && country && province.indexOf(country) >= 0) ? '' : country,
        hk && !/特别行政区/.test(province || '') ? '香港特别行政区' : province,
        city,
        district,
        township,
        street,
        house,
        poi
    ]);
    return pickLonger(built, formatted) || built;
}

async function lookupGeo(ip, options) {
    if (!ip) return null;
    const opts = options || {};
    const cacheKey = ip + ':' + (opts.rich ? 'rich' : 'basic') + ':' + apiKeys().amap + apiKeys().qq + apiKeys().ipgeo;
    if (geoCache.has(cacheKey)) return geoCache.get(cacheKey);
    const pending = (async() => {
        const rich = !!opts.rich;
        const tasks = [
            lookupIpApi(ip, 'zh-CN'),
            rich ? lookupIpApi(ip, 'en') : Promise.resolve(null),
            rich ? lookupCz88(ip) : Promise.resolve(null),
            lookupPconline(ip),
            rich ? lookupAmapIp(ip) : Promise.resolve(null),
            rich ? lookupQqIp(ip) : Promise.resolve(null),
            rich ? lookupIpGeoIo(ip) : Promise.resolve(null)
        ];
        const [zh, en, cz, pc, amapIp, qqIp, ipgeo] = await Promise.all(tasks.map((p) => p.catch(() => null)));
        let info = mergeInfo(mergeInfo(amapIp, qqIp), zh);
        info = mergeInfo(info, cz);
        info = mergeInfo(info, pc);
        info = mergeInfo(info, ipgeo);
        info = mergeInfo(info, en);
        if (!info.country && !info.countryEn) return null;
        if (rich && info.lat != null && info.lon != null) {
            const [landmark, amapWeb, amapKey, qqKey, photon] = await Promise.all([
                findNearbyLandmark(info.lat, info.lon, info.city || info.district || info.cityEn).catch(() => ''),
                lookupAmapRegeo(info.lon, info.lat).catch(() => null),
                lookupAmapRegeoKey(info.lon, info.lat).catch(() => null),
                lookupQqRegeo(info.lat, info.lon).catch(() => null),
                lookupPhotonReverse(info.lat, info.lon).catch(() => null)
            ]);
            info.landmark = (amapKey && amapKey.poi) || (qqKey && qqKey.poi) || landmark || (photon && (photon.name || photon.street)) || '';
            const amap = amapKey || (amapWeb ? {
                country: amapWeb.country || '',
                province: amapWeb.province,
                city: amapWeb.city,
                district: amapWeb.district,
                township: amapWeb.township || '',
                formatted: amapWeb.formatted || '',
                desc: amapWeb.desc || '',
                poi: info.landmark
            } : null);
            info.locationText = buildLocationText(amap, qqKey, photon, info, info.landmark);
        }
        return info;
    })();
    geoCache.set(cacheKey, pending);
    return pending;
}

async function collectSystemDns() {
    const found = [];
    (dns.getServers() || []).forEach((ip) => pushIp(found, ip));
    if (process.platform === 'darwin') {
        const scutil = await runCmd('scutil', ['--dns']);
        scutil.split('\n').forEach((line) => {
            const match = line.match(/nameserver\[\d+\]\s*:\s*(\S+)/i);
            if (match) pushIp(found, match[1]);
        });
        const ifaces = listInterfaces();
        for (let i = 0; i < ifaces.length; i++) {
            const packet = await runCmd('ipconfig', ['getpacket', ifaces[i].name]);
            const match = packet.match(/domain_name_server[^\n]*\{([^}]+)\}/i);
            if (match) {
                match[1].split(/[\s,]+/).forEach((ip) => pushIp(found, ip));
            }
        }
    } else if (process.platform === 'win32') {
        const out = await runCmd('ipconfig', ['/all']);
        let inDns = false;
        out.split(/\r?\n/).forEach((line) => {
            if (/DNS Servers/i.test(line)) inDns = true;
            else if (inDns && /^\s+\S/.test(line) === false && line.trim()) inDns = /DNS/i.test(line);
            if (inDns) {
                const match = line.match(/(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)/);
                if (match) pushIp(found, match[1]);
            }
        });
    } else {
        try {
            const fs = require('fs');
            const text = fs.readFileSync('/etc/resolv.conf', 'utf8');
            text.split('\n').forEach((line) => {
                const match = line.match(/^nameserver\s+(\S+)/);
                if (match) pushIp(found, match[1]);
            });
        } catch (e) {}
    }
    return found;
}

async function fetchOneEdns() {
    const host = randomId(32);
    const res = await request('https://' + host + '.edns.ip-api.com/json', { timeout: 5000 });
    let json = null;
    try { json = JSON.parse(res.body); } catch (e) {}
    if (!json || !json.dns) {
        const href = String(res.body || '').match(/https?:\/\/[a-z0-9]+\.edns\.ip-api\.com\/json/i);
        if (!href) return null;
        json = JSON.parse((await request(href[0], { timeout: 5000 })).body);
    }
    if (!json || !json.dns || !json.dns.ip) return null;
    return { ip: json.dns.ip, geo: json.dns.geo || '' };
}

async function collectEdnsDns() {
    const batches = [0, 1];
    const rows = [];
    for (let b = 0; b < batches.length; b++) {
        const part = await Promise.all(Array.from({ length: 4 }, () => fetchOneEdns().catch(() => null)));
        part.filter(Boolean).forEach((row) => rows.push(row));
    }
    return rows;
}

async function fetchSurfsharkDns() {
    const res = await request('https://' + randomId(12) + '.ipv4.surfsharkdns.com', { timeout: 5000 });
    const json = JSON.parse(res.body);
    const rows = [];
    Object.keys(json || {}).forEach((key) => {
        const row = json[key];
        if (!row) return;
        const ip = row.IP || key;
        const geo = [row.Country, row.City, row.ISP].filter(Boolean).join(' ');
        rows.push({ ip, geo });
    });
    return rows;
}

async function collectSurfsharkDns() {
    const part = await Promise.all(Array.from({ length: 8 }, () => fetchSurfsharkDns().catch(() => [])));
    const rows = [];
    part.forEach((arr) => arr.forEach((row) => rows.push(row)));
    return rows;
}

function dnsLookup(host, timeout) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const timer = setTimeout(finish, timeout || 4000);
        dns.resolve4(host, () => {
            clearTimeout(timer);
            finish();
        });
    });
}

async function collectBashDnsLeak() {
    const idRes = await request('https://bash.ws/id', { timeout: 5000 });
    const id = String(idRes.body || '').trim();
    if (!id || /[^a-z0-9]/i.test(id)) return [];
    await Promise.all(Array.from({ length: 12 }, (_, i) => {
        const host = (i + 1) + '.' + id + '.bash.ws';
        return Promise.race([
            request('https://' + host + '/', { timeout: 4000 }).catch(() => null),
            dnsLookup(host, 4000)
        ]);
    }));
    const test = await request('https://bash.ws/dnsleak/test/' + encodeURIComponent(id) + '?json', { timeout: 8000 });
    let arr = [];
    try { arr = JSON.parse(test.body); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter((row) => row && row.type === 'dns' && row.ip).map((row) => ({
        ip: row.ip,
        geo: [row.country_name, row.asn].filter(Boolean).join(' ')
    }));
}

async function collectDnsServers() {
    const [edns, surfshark, leak, system] = await Promise.all([
        collectEdnsDns().catch(() => []),
        collectSurfsharkDns().catch(() => []),
        collectBashDnsLeak().catch(() => []),
        collectSystemDns().catch(() => [])
    ]);
    const rows = [];
    const seen = new Set();
    const add = (ip, geo) => {
        if (!ip || seen.has(ip) || isPrivateIp(ip)) return;
        seen.add(ip);
        rows.push({ ip, geo: geo || '' });
    };
    edns.forEach((row) => add(row.ip, row.geo));
    surfshark.forEach((row) => add(row.ip, row.geo));
    leak.forEach((row) => add(row.ip, row.geo));
    if (!rows.length) {
        system.forEach((ip) => add(ip, ''));
    }
    return rows.slice(0, 40);
}

async function measureSite(site) {
    const proxy = site.region === '境外网站' ? overseasProxy : null;
    const tryOnce = async(method) => {
        const res = await request(site.url, { method, timeout: 6000, proxy: proxy || undefined });
        return res.ms;
    };
    try {
        return await tryOnce('HEAD');
    } catch (e) {
        try {
            return await tryOnce('GET');
        } catch (err) {
            return null;
        }
    }
}

function copyText(text) {
    if (!text) return false;
    try {
        if (typeof ztools.copyText === 'function') {
            ztools.copyText(String(text));
            return true;
        }
    } catch (e) {}
    try {
        ztools.clipboard.writeContent({ type: 'text', content: String(text) }, false);
        return true;
    } catch (e) {
        return false;
    }
}

function markCopied(key) {
    state.copiedKey = key;
    emit();
    if (copyTimers[key]) clearTimeout(copyTimers[key]);
    copyTimers[key] = setTimeout(() => {
        if (state.copiedKey === key) {
            state.copiedKey = '';
            emit();
        }
    }, 1800);
}

function applyLan() {
    state.lan = pickLan(state.interfaces, state.selectedIface);
}

function fetchFirstOverseas(proxies, getDomestic) {
    const list = [null].concat(proxies || []);
    return new Promise((resolve) => {
        if (!list.length) {
            resolve(null);
            return;
        }
        let left = list.length;
        let settled = false;
        const finish = (row) => {
            if (settled) return;
            if (row && row.ip) {
                settled = true;
                resolve(row);
                return;
            }
            if (left <= 0) {
                settled = true;
                resolve(null);
            }
        };
        list.forEach((proxy) => {
            fetchIPv4(OVERSEAS_IP_URLS, {
                family: 4,
                timeout: 4000,
                proxy: proxy || undefined
            }).then((ip) => {
                left -= 1;
                if (!ip) {
                    finish(null);
                    return;
                }
                const domestic = getDomestic();
                if (domestic && ip === domestic) {
                    finish(null);
                    return;
                }
                if (!domestic && !proxy) {
                    finish(null);
                    return;
                }
                finish({ ip, proxy });
            }).catch(() => {
                left -= 1;
                finish(null);
            });
        });
    });
}

async function fillNetworkGeo(myIp, ipv6) {
    const [publicGeo, overseasGeo] = await Promise.all([
        lookupGeo(state.public.ip, { rich: true }),
        lookupGeo(state.overseas.ip, { rich: true })
    ]);
    if (!state.public.geo) state.public.geo = formatGeo(publicGeo, 'public') || '';
    if (myIp && myIp.cnLine) state.public.geo = myIp.cnLine;
    if (ipv6 && state.public.ip && ipv6 !== state.public.ip && String(state.public.ip).indexOf(':') < 0) {
        if (state.public.geo.indexOf('IPv6 ') < 0) {
            state.public.geo = (state.public.geo ? state.public.geo + ' · ' : '') + 'IPv6 ' + ipv6;
        }
    }
    state.overseas.geo = formatGeo(overseasGeo, 'overseas') || '';
    const locSource = overseasGeo || publicGeo;
    state.location.text = formatLocation(locSource) || formatGeo(locSource) || '';
    state.location.loading = false;
    emit();
}

async function loadNetwork(proxies) {
    state.public.loading = true;
    state.overseas.loading = true;
    state.location.loading = true;
    state.public.ip = '';
    state.public.geo = '';
    state.overseas.ip = '';
    state.overseas.geo = '';
    state.location.text = '';
    emit();

    const myIpPromise = fetchMyIpCn().catch(() => null);
    const publicPromise = fetchIPv4(PUBLIC_IP_URLS, { family: 4, timeout: 4000 });
    const ipv6Promise = fetchIPv6([
        'https://myip.ipip.net',
        'https://6.ipw.cn/',
        'https://api64.ipify.org'
    ]);
    const overseasPromise = fetchFirstOverseas(proxies, () => state.public.ip);

    myIpPromise.then((info) => {
        if (!info || !info.ip || state.public.ip) return;
        state.public.ip = info.ip;
        state.public.loading = false;
        if (info.cnLine) state.public.geo = info.cnLine;
        emit();
    }).catch(() => {});

    publicPromise.then((ip) => {
        if (!ip || state.public.ip) return;
        state.public.ip = ip;
        state.public.loading = false;
        emit();
    }).catch(() => {});

    overseasPromise.then((hit) => {
        if (hit && hit.ip && hit.ip !== state.public.ip) {
            state.overseas.ip = hit.ip;
            if (hit.proxy) overseasProxy = hit.proxy;
        }
        state.overseas.loading = false;
        emit();
    }).catch(() => {
        state.overseas.loading = false;
        emit();
    });

    const myIp = await myIpPromise;
    if (!state.public.ip) {
        const publicIp = await publicPromise.catch(() => '');
        state.public.ip = publicIp || '';
        state.public.loading = false;
        emit();
    } else {
        state.public.loading = false;
        if (myIp && myIp.cnLine && !state.public.geo) state.public.geo = myIp.cnLine;
        emit();
    }

    const hit = await overseasPromise.catch(() => null);
    if (hit && hit.ip && hit.ip !== state.public.ip && !state.overseas.ip) {
        state.overseas.ip = hit.ip;
        if (hit.proxy) overseasProxy = hit.proxy;
    }
    state.overseas.loading = false;
    emit();

    const ipv6 = await ipv6Promise.catch(() => '');
    fillNetworkGeo(myIp, ipv6).catch(() => {
        state.location.loading = false;
        emit();
    });
}

async function loadSites() {
    await Promise.all(SITES.map(async(site, index) => {
        state.sites[index].status = 'loading';
        emit();
        const ms = await measureSite(site);
        state.sites[index].ms = ms;
        state.sites[index].status = ms == null ? 'timeout' : 'ok';
        emit();
    }));
}

async function loadDns() {
    state.dnsLoading = true;
    emit();
    const servers = await collectDnsServers();
    const rows = await Promise.all(servers.map(async(row) => {
        if (row.geo) return { ip: row.ip, geo: row.geo };
        const geo = await lookupGeo(row.ip);
        return { ip: row.ip, geo: formatGeo(geo, 'dns') || '未知' };
    }));
    state.dns = rows;
    state.dnsLoading = false;
    emit();
}

async function refresh(full) {
    state.interfaces = listInterfaces();
    applyLan();
    emit();
    if (state.autoCopy && state.lan.ip) {
        if (copyText(state.lan.ip)) markCopied('lan');
    }
    if (full === false) return;
    const proxies = await detectProxyCandidates();
    overseasProxy = proxies[0] || null;
    await Promise.all([loadNetwork(proxies), loadSites(), loadDns()]);
}

window.ipConfig = {
    onUpdate(fn) {
        listeners.add(fn);
        fn(JSON.parse(JSON.stringify(state)));
        return () => listeners.delete(fn);
    },
    getState() {
        return JSON.parse(JSON.stringify(state));
    },
    start() {
        state.selectedIface = getPref('iface', 'auto') || 'auto';
        state.autoCopy = getPref('autoCopyOn', false) === true;
        state.keys = loadKeys();
        return refresh(true);
    },
    refresh() {
        return refresh(true);
    },
    setInterface(name) {
        state.selectedIface = name || 'auto';
        setPref('iface', state.selectedIface);
        applyLan();
        emit();
        if (state.autoCopy && state.lan.ip) {
            if (copyText(state.lan.ip)) markCopied('lan');
        }
    },
    setAutoCopy(enabled) {
        state.autoCopy = !!enabled;
        setPref('autoCopyOn', state.autoCopy);
        emit();
        if (state.autoCopy && state.lan.ip) {
            if (copyText(state.lan.ip)) markCopied('lan');
        }
    },
    setKeys(keys) {
        const next = {
            amap: String((keys && keys.amap) || '').trim(),
            qq: String((keys && keys.qq) || '').trim(),
            ipgeo: String((keys && keys.ipgeo) || '').trim()
        };
        state.keys = next;
        setPref('keyAmap', next.amap);
        setPref('keyQq', next.qq);
        setPref('keyIpgeo', next.ipgeo);
        geoCache.clear();
        emit();
        return refresh(true);
    },
    copy(text, key) {
        const ok = copyText(text);
        if (ok) markCopied(key || text);
        return ok;
    }
};