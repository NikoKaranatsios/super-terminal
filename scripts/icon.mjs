import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

// Draw our simple terminal mark directly; no downloaded artwork or personal data.
export function makeIcon() {
  const size = 1024, pixels = Buffer.alloc((size * 4 + 1) * size);
  const line = (x,y,ax,ay,bx,by) => {
    const t = Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
    return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay));
  };
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const dx=Math.max(0,Math.abs(x-512)-285),dy=Math.max(0,Math.abs(y-512)-285);
    const edge=Math.hypot(dx,dy)-175;
    const alpha=Math.max(0,Math.min(1,1-edge));
    const border=edge>-5;
    const mark=Math.min(line(x,y,305,354,478,507),line(x,y,478,507,305,660),line(x,y,545,660,736,660));
    const color=mark<30?[181,229,210]:border?[66,104,89]:[23+Math.round((1024-y)/120),35+Math.round((1024-y)/95),33+Math.round((1024-y)/110)];
    const p=y*(size*4+1)+1+x*4;
    pixels[p]=color[0];pixels[p+1]=color[1];pixels[p+2]=color[2];pixels[p+3]=Math.round(alpha*255);
  }
  const crc = value => { let c=0xffffffff;for(const byte of value){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0; };
  const chunk=(type,data)=>{const typeBytes=Buffer.from(type);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);typeBytes.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([typeBytes,data])),data.length+8);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  fs.mkdirSync('build-assets',{recursive:true});
  const png=path.resolve('build-assets/icon.png');
  fs.writeFileSync(png,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
  if(process.platform!=='darwin') return png;
  const set=path.resolve('build-assets/icon.iconset');fs.mkdirSync(set,{recursive:true});
  for(const s of [16,32,128,256,512]) for(const scale of [1,2])execFileSync('/usr/bin/sips',['-z',String(s*scale),String(s*scale),png,'--out',path.join(set,`icon_${s}x${s}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
  const icns=path.resolve('build-assets/icon.icns');execFileSync('/usr/bin/iconutil',['-c','icns',set,'-o',icns]);return icns;
}
