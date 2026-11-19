import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import {pathToFileURL} from 'node:url';

// Only globally routable IPv4 addresses. DNS is resolved once and the socket is
// pinned to the validated result, including CONNECT and redirect follow-ups.
export function publicAddress(ip){
  if(net.isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);
}
export async function destination(host,port,domains,lookup=dns.lookup){
  if(!domains.has(host.toLowerCase())||![80,443].includes(Number(port)))throw new Error('Destination is outside the team’s network allowance.');
  const rows=await lookup(host,{all:true,family:4});if(!rows.length||rows.some(row=>!publicAddress(row.address)))throw new Error('Private or reserved destination blocked.');
  return rows[0].address;
}
export function createProxy(domains){
  const server=http.createServer(async(req,res)=>{
    try{const url=new URL(req.url);if(url.protocol!=='http:'||url.username||url.password)throw new Error('HTTP proxy URL required.');
      const ip=await destination(url.hostname,url.port||80,domains);
      const headers={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
      const upstream=http.request({host:ip,port:url.port||80,path:url.pathname+url.search,method:req.method,headers,timeout:30000},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
    }catch(error){res.writeHead(403);res.end(error.message);}
  });
  server.on('connect',async(req,client,head)=>{
    try{const url=new URL('https://'+req.url);if(url.username||url.password||url.pathname!=='/')throw new Error('Invalid tunnel.');const ip=await destination(url.hostname,url.port||443,domains);
      const upstream=net.connect(Number(url.port||443),ip,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
      upstream.setTimeout(120000,()=>upstream.destroy());client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
    }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createProxy(new Set(JSON.parse(process.env.ST_ALLOWED_DOMAINS||'[]'))).listen(8080,'0.0.0.0');
