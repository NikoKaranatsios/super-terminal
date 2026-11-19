let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>262144)throw new Error('Request too large.');}
const response=await fetch('http://127.0.0.1:4100',{method:'POST',body:raw,signal:AbortSignal.timeout(45000)});
const text=await response.text();if(!response.ok){console.error(JSON.parse(text).error);process.exitCode=1;}else process.stdout.write(text);
