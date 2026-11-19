import {fileURLToPath} from 'node:url';
import {buildSandboxImage} from '../server/sandbox-image.mjs';
console.log('Building the isolated agent runtime.');
try{console.log(await buildSandboxImage(fileURLToPath(new URL('..',import.meta.url))));}
catch(error){console.error(error.message);process.exitCode=1;}
